import fs from 'node:fs/promises'
import path from 'node:path'
import request from 'supertest'
import { eq } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../src/app'
import { handlers } from '../src/automation/handlers'
import { computeNextRun } from '../src/automation/schedules'
import { runDueJobs, schedulerTick } from '../src/automation/worker'
import { auditLog, automationSchedules, emailLog, events, jobs, media, news, reports, sessions, submissions } from '../src/db/schema'
import { enqueue } from '../src/services/jobs'
import { API, PNG, actor, fakeMailer, makeCtx, mkUser, resetDb } from './helpers'

const ctx = makeCtx()
let mailer = fakeMailer()
ctx.mailer = mailer
const app = createApp(ctx)
beforeEach(async () => { await resetDb(ctx); mailer = fakeMailer(); ctx.mailer = mailer })
afterAll(async () => { await ctx.pool.end(); await fs.rm(ctx.env.UPLOAD_DIR, { recursive: true, force: true }) })

const H = 3600_000
const run = (name: string, opts: { dryRun?: boolean; now?: Date } = {}) => handlers[`automation:${name}`](ctx, {}, opts)
const mkSub = (over: Partial<typeof submissions.$inferInsert> = {}) =>
  ctx.db.insert(submissions).values({ name: 'Awa', email: 'awa@example.org', subject: 'Besoin', message: 'Message de test', consent: true, ...over }).returning().then((r) => r[0])

describe('schedule computation', () => {
  it('computes interval, daily and weekly next runs (UTC)', () => {
    const from = new Date('2026-03-04T10:30:00Z') // a Wednesday
    expect(computeNextRun({ kind: 'interval', intervalMinutes: 15 }, from).toISOString()).toBe('2026-03-04T10:45:00.000Z')
    expect(computeNextRun({ kind: 'daily', atHour: 8, atMinute: 0 }, from).toISOString()).toBe('2026-03-05T08:00:00.000Z')
    expect(computeNextRun({ kind: 'daily', atHour: 23, atMinute: 0 }, from).toISOString()).toBe('2026-03-04T23:00:00.000Z')
    expect(computeNextRun({ kind: 'weekly', weekday: 1, atHour: 7, atMinute: 0 }, from).toISOString()).toBe('2026-03-09T07:00:00.000Z')
    expect(computeNextRun({ kind: 'weekly', weekday: 3, atHour: 7, atMinute: 0 }, from).toISOString()).toBe('2026-03-11T07:00:00.000Z')
  })
})

describe('scheduler & queue', () => {
  it('enqueues a due schedule exactly once and advances it; disabled schedules never run', async () => {
    const past = new Date(Date.now() - 5 * 60_000)
    await ctx.db.update(automationSchedules).set({ nextRunAt: past })
    await ctx.db.update(automationSchedules).set({ enabled: false }).where(eq(automationSchedules.name, 'cleanup'))
    const queued = await schedulerTick(ctx)
    expect(queued).toBe(3) // 5 schedules minus digest (disabled by default) minus cleanup (disabled here)
    expect(await schedulerTick(ctx)).toBe(0) // nothing is due any more → no duplicates
    const types = (await ctx.db.select().from(jobs)).map((j) => j.type).sort()
    expect(types).not.toContain('automation:cleanup')
    expect(types).not.toContain('automation:digest')
    const [s] = await ctx.db.select().from(automationSchedules).where(eq(automationSchedules.name, 'publish_scheduled'))
    expect(s.nextRunAt.getTime()).toBeGreaterThan(Date.now())
  })

  it('runs once (not once per missed slot) after downtime', async () => {
    await ctx.db.update(automationSchedules).set({ nextRunAt: new Date(Date.now() - 10 * 86_400_000) }).where(eq(automationSchedules.name, 'publish_scheduled'))
    await schedulerTick(ctx); await schedulerTick(ctx); await schedulerTick(ctx)
    expect((await ctx.db.select().from(jobs)).filter((j) => j.type === 'automation:publish_scheduled')).toHaveLength(1)
  })

  it('enqueue with the same dedupe key is a no-op', async () => {
    expect(await enqueue(ctx.db, 'x', {}, { dedupeKey: 'k' })).toBeTruthy()
    expect(await enqueue(ctx.db, 'x', {}, { dedupeKey: 'k' })).toBeNull()
    expect(await ctx.db.select().from(jobs)).toHaveLength(1)
  })

  it('retries failed jobs with exponential backoff, never re-sends to recipients already mailed, then succeeds', async () => {
    await mkUser(ctx, 'admin', 'a@test.local'); await mkUser(ctx, 'editor', 'b@test.local')
    mailer = fakeMailer(1); ctx.mailer = mailer // first send fails
    const sub = await mkSub()
    await enqueue(ctx.db, 'notify_new_submission', { submissionId: sub.id }, { dedupeKey: `submission-new:${sub.id}` })
    await runDueJobs(ctx)
    let [job] = await ctx.db.select().from(jobs)
    expect(job.status).toBe('queued')
    expect(job.attempts).toBe(1)
    expect(job.lastError).toMatch(/failed/)
    expect(job.runAt.getTime()).toBeGreaterThan(Date.now() + 20_000) // backoff
    expect(await runDueJobs(ctx)).toBe(0) // not due yet
    await ctx.db.update(jobs).set({ runAt: new Date() })
    await runDueJobs(ctx)
    ;[job] = await ctx.db.select().from(jobs)
    expect(job.status).toBe('succeeded')
    expect(mailer.sent.map((m) => m.to).sort()).toEqual(['a@test.local', 'b@test.local']) // two e-mails total, no duplicates
    expect((await ctx.db.select().from(emailLog)).every((e) => e.status === 'sent')).toBe(true)
  })

  it('marks a job dead after max attempts and an admin can re-queue it', async () => {
    await mkUser(ctx, 'admin', 'a@test.local')
    mailer = fakeMailer(99); ctx.mailer = mailer
    const sub = await mkSub()
    await enqueue(ctx.db, 'notify_new_submission', { submissionId: sub.id }, { dedupeKey: 'dead-1', maxAttempts: 2 })
    await runDueJobs(ctx)
    await ctx.db.update(jobs).set({ runAt: new Date() })
    await runDueJobs(ctx)
    const [job] = await ctx.db.select().from(jobs)
    expect(job.status).toBe('dead')
    expect(job.attempts).toBe(2)
    const sa = await actor(ctx, app, 'super_admin')
    const retry = await request(app).post(`${API}/admin/automation/jobs/${job.id}/retry`).set(sa.h)
    expect(retry.status).toBe(200)
    expect(retry.body.status).toBe('queued')
    const list = await request(app).get(`${API}/admin/activity/jobs?status=queued`).set(sa.h)
    expect(list.body.total).toBe(1)
  })

  it('unknown job types fail instead of being silently dropped', async () => {
    await enqueue(ctx.db, 'does_not_exist', {}, { maxAttempts: 1 })
    await runDueJobs(ctx)
    const [job] = await ctx.db.select().from(jobs)
    expect(job.status).toBe('dead')
    expect(job.lastError).toMatch(/No handler/)
  })
})

describe('scheduled publication', () => {
  it('publishes due scheduled items, leaves future ones, and logs the system actor', async () => {
    const mk = (t: string, at: Date) => ctx.db.insert(news).values({ slug: t, titleFr: t, status: 'scheduled', publishAt: at }).returning().then((r) => r[0])
    const due = await mk('due', new Date(Date.now() - H)); const later = await mk('later', new Date(Date.now() + H))
    const dry = await run('publish_scheduled', { dryRun: true })
    expect(dry.published).toMatchObject({ news: 1 })
    expect((await ctx.db.select().from(news).where(eq(news.id, due.id)))[0].status).toBe('scheduled')
    await run('publish_scheduled')
    const [d] = await ctx.db.select().from(news).where(eq(news.id, due.id))
    expect(d.status).toBe('published')
    expect(d.publishedAt?.getTime()).toBe(due.publishAt!.getTime())
    expect((await ctx.db.select().from(news).where(eq(news.id, later.id)))[0].status).toBe('scheduled')
    const logs = await ctx.db.select().from(auditLog).where(eq(auditLog.entityId, due.id))
    expect(logs[0]).toMatchObject({ actorLabel: 'system', action: 'status.published' })
    const pub = await request(app).get(`${API}/public/news/due`)
    expect(pub.status).toBe(200)
  })
})

describe('unhandled submission reminders (anti-spam)', () => {
  const now = new Date()
  it('sends ONE summary e-mail per recipient for overdue requests only', async () => {
    await mkUser(ctx, 'admin', 'a@test.local'); await mkUser(ctx, 'editor', 'b@test.local')
    await mkSub({ createdAt: new Date(now.getTime() - 72 * H), subject: 'Ancienne 1' })
    await mkSub({ createdAt: new Date(now.getTime() - 50 * H), subject: 'Ancienne 2' })
    await mkSub({ createdAt: new Date(now.getTime() - 1 * H), subject: 'Récente' })
    await mkSub({ createdAt: new Date(now.getTime() - 99 * H), status: 'handled', subject: 'Déjà traitée' })
    const r = await run('unhandled_submission_reminder', { now })
    expect(r).toMatchObject({ overdue: 2, emailsSent: 2 })
    expect(mailer.sent).toHaveLength(2) // 2 recipients, 1 mail each  not 1 per submission
    expect(mailer.sent[0].text).toContain('Ancienne 1')
    expect(mailer.sent[0].text).toContain('Ancienne 2')
    expect(mailer.sent[0].text).not.toContain('Récente')
    expect(mailer.sent[0].text).not.toContain('Déjà traitée')
  })

  it('does not repeat within the cooldown or on the same day, and caps the total number of reminders', async () => {
    await mkUser(ctx, 'admin', 'a@test.local')
    const sub = await mkSub({ createdAt: new Date(now.getTime() - 72 * H) })
    await run('unhandled_submission_reminder', { now })
    expect(mailer.sent).toHaveLength(1)
    await run('unhandled_submission_reminder', { now }) // immediately again (e.g. job double-fired)
    await run('unhandled_submission_reminder', { now: new Date(now.getTime() + 2 * H) }) // within 24h cooldown
    expect(mailer.sent).toHaveLength(1)
    await run('unhandled_submission_reminder', { now: new Date(now.getTime() + 25 * H) })
    expect(mailer.sent).toHaveLength(2)
    await run('unhandled_submission_reminder', { now: new Date(now.getTime() + 50 * H) })
    expect(mailer.sent).toHaveLength(3)
    await run('unhandled_submission_reminder', { now: new Date(now.getTime() + 75 * H) }) // maxReminders (3) reached
    await run('unhandled_submission_reminder', { now: new Date(now.getTime() + 99 * H) })
    expect(mailer.sent).toHaveLength(3)
    expect((await ctx.db.select().from(submissions).where(eq(submissions.id, sub.id)))[0].reminderCount).toBe(3)
  })

  it('stops reminding once the request is handled', async () => {
    await mkUser(ctx, 'admin', 'a@test.local')
    const sub = await mkSub({ createdAt: new Date(now.getTime() - 72 * H) })
    await ctx.db.update(submissions).set({ status: 'handled', handledAt: now }).where(eq(submissions.id, sub.id))
    await run('unhandled_submission_reminder', { now })
    expect(mailer.sent).toHaveLength(0)
  })

  it('also reminds about in-progress requests whose follow-up date has passed', async () => {
    await mkUser(ctx, 'admin', 'a@test.local')
    await mkSub({ status: 'in_progress', followUpAt: new Date(now.getTime() - H), subject: 'Suivi dû' })
    const r = await run('unhandled_submission_reminder', { now })
    expect(r.overdue).toBe(1)
    expect(mailer.sent[0].text).toContain('suivi dû')
  })

  it('dry-run reports what would happen and changes nothing', async () => {
    await mkUser(ctx, 'admin', 'a@test.local')
    const sub = await mkSub({ createdAt: new Date(now.getTime() - 72 * H) })
    const r = await run('unhandled_submission_reminder', { now, dryRun: true })
    expect(r).toMatchObject({ dryRun: true, overdue: 1, wouldEmail: ['a@test.local'] })
    expect(String(r.preview)).toContain('Besoin')
    expect(mailer.sent).toHaveLength(0)
    expect(await ctx.db.select().from(emailLog)).toHaveLength(0)
    expect((await ctx.db.select().from(submissions).where(eq(submissions.id, sub.id)))[0].reminderCount).toBe(0)
  })

  it('admin API: dry-run, manual run with simulated time, and disabling/rescheduling', async () => {
    const sa = await actor(ctx, app, 'super_admin')
    await mkSub({ createdAt: new Date(now.getTime() - 72 * H) })
    const dry = await request(app).post(`${API}/admin/automation/unhandled_submission_reminder/run`).set(sa.h).send({ dryRun: true })
    expect(dry.body).toMatchObject({ dryRun: true, result: { overdue: 1 } })
    expect(mailer.sent).toHaveLength(0)
    const real = await request(app).post(`${API}/admin/automation/unhandled_submission_reminder/run`).set(sa.h).send({ dryRun: false })
    expect(real.body.result.emailsSent).toBeGreaterThan(0)
    const off = await request(app).patch(`${API}/admin/automation/unhandled_submission_reminder`).set(sa.h).send({ enabled: false, config: { afterHours: 1 } })
    expect(off.body).toMatchObject({ enabled: false, config: { afterHours: 1, cooldownHours: 24, maxReminders: 3 } })
    const list = await request(app).get(`${API}/admin/automation`).set(sa.h)
    expect(list.body.items).toHaveLength(5)
    expect(list.body.items.find((i: { name: string }) => i.name === 'digest').enabled).toBe(false) // digest is opt-in
    expect((await request(app).post(`${API}/admin/automation/nope/run`).set(sa.h).send({})).status).toBe(400)
    expect((await request(app).get(`${API}/admin/activity/audit?entity=automation`).set(sa.h)).body.total).toBeGreaterThanOrEqual(3)
  })
})

describe('upcoming reminders, digest and cleanup', () => {
  const now = new Date()
  it('reminds once about published events starting soon and ignores far/past/draft ones', async () => {
    await mkUser(ctx, 'admin', 'a@test.local')
    const ev = (slug: string, days: number, status: 'published' | 'draft' = 'published') =>
      ctx.db.insert(events).values({ slug, titleFr: slug, status, startsAt: new Date(now.getTime() + days * 86_400_000), publishedAt: now }).returning().then((r) => r[0])
    const soon = await ev('soon', 3); await ev('far', 30); await ev('past', -3); await ev('draft', 2, 'draft')
    const r = await run('upcoming_reminder', { now })
    expect(r).toMatchObject({ events: 1 })
    expect(mailer.sent).toHaveLength(1)
    expect(mailer.sent[0].text).toContain('soon')
    expect(mailer.sent[0].text).not.toContain('far')
    expect((await ctx.db.select().from(events).where(eq(events.id, soon.id)))[0].reminderSentAt).toBeTruthy()
    expect(await run('upcoming_reminder', { now: new Date(now.getTime() + H) })).toMatchObject({ events: 0 })
    expect(mailer.sent).toHaveLength(1)
  })

  it('digest saves a report and e-mails once per day; dry-run sends nothing', async () => {
    const now = new Date(Date.now() + 60_000) // after the submission below is created
    await mkUser(ctx, 'admin', 'a@test.local')
    await mkSub()
    expect(await run('digest', { now, dryRun: true })).toMatchObject({ dryRun: true, wouldEmail: ['a@test.local'] })
    expect(await ctx.db.select().from(reports)).toHaveLength(0)
    await run('digest', { now })
    await run('digest', { now: new Date(now.getTime() + H) })
    expect(await ctx.db.select().from(reports)).toHaveLength(1)
    expect(mailer.sent).toHaveLength(1)
    const [rep] = await ctx.db.select().from(reports)
    expect((rep.data as { submissions: { total: number } }).submissions.total).toBe(1)
    const sa = await actor(ctx, app, 'super_admin')
    expect((await request(app).get(`${API}/admin/reports/digests`).set(sa.h)).body.items).toHaveLength(1)
    const gen = await request(app).post(`${API}/admin/reports/digests`).set(sa.h).send({ days: 30 })
    expect(gen.status).toBe(201)
  })

  it('cleanup removes expired temp uploads (row + file), old sessions and old jobs, and keeps live data', async () => {
    const a = await actor(ctx, app, 'editor')
    const up = (temp: boolean) => request(app).post(`${API}/admin/media`).set(a.h).field('temporary', String(temp)).attach('file', PNG, 'a.png')
    const tmp = (await up(true)).body; const keep = (await up(false)).body
    await ctx.db.update(media).set({ expiresAt: new Date(now.getTime() - H) }).where(eq(media.id, tmp.id))
    await ctx.db.insert(sessions).values({ userId: a.user.id, tokenHash: 'old', familyId: '00000000-0000-4000-8000-000000000001', expiresAt: new Date(now.getTime() - 3 * 86_400_000) })
    await ctx.db.insert(jobs).values({ type: 'x', status: 'succeeded', finishedAt: new Date(now.getTime() - 60 * 86_400_000) })
    expect(await run('cleanup', { now, dryRun: true })).toMatchObject({ dryRun: true, expiredUploads: 1, expiredSessions: 1 })
    expect(await ctx.db.select().from(media)).toHaveLength(2)
    expect(await run('cleanup', { now })).toMatchObject({ expiredUploads: 1, expiredSessions: 1, oldJobs: 1 })
    const rest = await ctx.db.select().from(media)
    expect(rest.map((m) => m.id)).toEqual([keep.id])
    await expect(fs.access(path.resolve(ctx.env.UPLOAD_DIR, tmp.storageKey))).rejects.toThrow()
    await fs.access(path.resolve(ctx.env.UPLOAD_DIR, keep.storageKey))
    expect((await request(app).get(`${API}/auth/me`).set(a.h)).status).toBe(200) // live session untouched
  })
})
