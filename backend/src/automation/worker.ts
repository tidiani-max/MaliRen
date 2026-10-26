import { and, eq, lte } from 'drizzle-orm'
import type { AppContext } from '../context'
import { automationSchedules } from '../db/schema'
import { claimNext, completeJob, enqueue, failJob, recoverStuck } from '../services/jobs'
import { handlers } from './handlers'
import { computeNextRun, ensureSchedules } from './schedules'

/** Turn due schedules into jobs. The dedupe key (name + planned time) makes this idempotent across processes and restarts. */
export async function schedulerTick(ctx: AppContext, now = new Date()) {
  const due = await ctx.db.select().from(automationSchedules).where(and(eq(automationSchedules.enabled, true), lte(automationSchedules.nextRunAt, now)))
  let queued = 0
  for (const s of due) {
    const job = await enqueue(ctx.db, `automation:${s.name}`, { schedule: s.name }, { dedupeKey: `${s.name}:${s.nextRunAt.toISOString()}`, maxAttempts: 4 })
    if (job) queued++
    // Advance from "now": if the worker was down for days we run once, not once per missed slot.
    await ctx.db.update(automationSchedules).set({ lastRunAt: now, nextRunAt: computeNextRun(s as never, now) }).where(and(eq(automationSchedules.name, s.name), eq(automationSchedules.nextRunAt, s.nextRunAt)))
  }
  return queued
}

export async function runDueJobs(ctx: AppContext, max = 50) {
  let done = 0
  for (; done < max; done++) {
    const job = await claimNext(ctx.db)
    if (!job) break
    const h = handlers[job.type]
    try {
      if (!h) throw new Error(`No handler for job type ${job.type}`)
      const result = await h(ctx, (job.payload ?? {}) as Record<string, unknown>, {})
      await completeJob(ctx.db, job.id, result)
      ctx.logger.info({ job: job.type, result }, 'job succeeded')
    } catch (err) {
      await failJob(ctx.db, job, err)
      ctx.logger.warn({ job: job.type, attempt: job.attempts, err: err instanceof Error ? err.message : err }, 'job failed')
    }
  }
  return done
}

export function startWorker(ctx: AppContext) {
  let stopped = false
  let timer: NodeJS.Timeout | undefined
  const tick = async () => {
    try {
      await recoverStuck(ctx.db)
      if (ctx.env.AUTOMATIONS_ENABLED) await schedulerTick(ctx)
      await runDueJobs(ctx)
    } catch (err) {
      ctx.logger.error({ err }, 'worker tick failed')
    }
    if (!stopped) timer = setTimeout(tick, ctx.env.WORKER_POLL_SECONDS * 1000)
  }
  ensureSchedules(ctx.db).then(tick).catch((err) => ctx.logger.error({ err }, 'worker start failed'))
  ctx.logger.info({ pollSeconds: ctx.env.WORKER_POLL_SECONDS, automations: ctx.env.AUTOMATIONS_ENABLED }, 'worker started')
  return () => { stopped = true; if (timer) clearTimeout(timer) }
}
