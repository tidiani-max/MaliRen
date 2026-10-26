import { and, eq, lt, lte, sql } from 'drizzle-orm'
import type { Db } from '../db/client'
import { jobs } from '../db/schema'

export type JobRow = typeof jobs.$inferSelect

/** Enqueue is idempotent when a dedupeKey is given. Returns null when an equivalent job already exists. */
export async function enqueue(
  db: Db,
  type: string,
  payload: Record<string, unknown> = {},
  opts: { dedupeKey?: string; runAt?: Date; maxAttempts?: number } = {},
): Promise<JobRow | null> {
  const [row] = await db
    .insert(jobs)
    .values({ type, payload, dedupeKey: opts.dedupeKey ?? null, runAt: opts.runAt ?? new Date(), maxAttempts: opts.maxAttempts ?? 5 })
    .onConflictDoNothing({ target: jobs.dedupeKey })
    .returning()
  return row ?? null
}

/** Atomically claim one due job (multiple workers are safe thanks to SKIP LOCKED). */
export async function claimNext(db: Db): Promise<JobRow | null> {
  const res = await db.execute(sql`
    UPDATE jobs SET status = 'running', locked_at = now(), attempts = attempts + 1
    WHERE id = (SELECT id FROM jobs WHERE status = 'queued' AND run_at <= now() ORDER BY run_at, created_at FOR UPDATE SKIP LOCKED LIMIT 1)
    RETURNING id, type, payload, status, run_at AS "runAt", attempts, max_attempts AS "maxAttempts", last_error AS "lastError", result, dedupe_key AS "dedupeKey", locked_at AS "lockedAt", created_at AS "createdAt", finished_at AS "finishedAt"`)
  return (res.rows[0] as JobRow | undefined) ?? null
}

export const backoffMs = (attempts: number) => Math.min(30_000 * 2 ** (attempts - 1), 60 * 60_000)

export async function completeJob(db: Db, id: string, result: unknown) {
  await db.update(jobs).set({ status: 'succeeded', result: result as object, finishedAt: new Date(), lockedAt: null, lastError: null }).where(eq(jobs.id, id))
}

/** Retry with exponential backoff until maxAttempts, then mark dead. */
export async function failJob(db: Db, job: JobRow, err: unknown) {
  const msg = (err instanceof Error ? err.message : String(err)).slice(0, 1000)
  const dead = job.attempts >= job.maxAttempts
  await db
    .update(jobs)
    .set(
      dead
        ? { status: 'dead', lastError: msg, finishedAt: new Date(), lockedAt: null }
        : { status: 'queued', lastError: msg, runAt: new Date(Date.now() + backoffMs(job.attempts)), lockedAt: null },
    )
    .where(eq(jobs.id, job.id))
}

/** Re-queue jobs whose worker died while running them. */
export async function recoverStuck(db: Db, olderThanMinutes = 10) {
  const cutoff = new Date(Date.now() - olderThanMinutes * 60_000)
  const rows = await db.update(jobs).set({ status: 'queued', lockedAt: null }).where(and(eq(jobs.status, 'running'), lt(jobs.lockedAt, cutoff))).returning({ id: jobs.id })
  return rows.length
}

export async function countDue(db: Db) {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(jobs).where(and(eq(jobs.status, 'queued'), lte(jobs.runAt, new Date())))
  return r.n
}
