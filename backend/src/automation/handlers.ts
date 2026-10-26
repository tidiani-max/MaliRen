import fs from 'node:fs/promises'
import path from 'node:path'
import { and, eq, inArray, isNotNull, isNull, lt, lte, gte, sql } from 'drizzle-orm'
import type { AppContext } from '../context'
import { emailLog, events, jobs, media, news, notifications, pages, publications, reports, sessions, submissions } from '../db/schema'
import { SYSTEM, audit } from '../services/audit'
import { sendEmail } from '../services/mailer'
import { notifyUsers, staffRecipients } from '../services/notifications'
import { buildSummary, summaryToText } from '../services/reports'
import { automationSchedules } from '../db/schema'

export interface RunOpts { dryRun?: boolean; now?: Date }
type Handler = (ctx: AppContext, payload: Record<string, unknown>, opts: RunOpts) => Promise<Record<string, unknown>>

const day = (d: Date) => d.toISOString().slice(0, 10)
const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : d)
const adminUrl = (ctx: AppContext, p: string) => `${ctx.env.PUBLIC_SITE_URL.replace(/\/$/, '')}/admin/${p}`

async function getConfig(ctx: AppContext, name: string): Promise<Record<string, unknown>> {
  const [row] = await ctx.db.select().from(automationSchedules).where(eq(automationSchedules.name, name))
  return (row?.config ?? {}) as Record<string, unknown>
}

/** Sends one e-mail per recipient; returns false when at least one failed so the job retries (sent ones are skipped by dedupe). */
async function emailAll(ctx: AppContext, emails: string[], subject: string, text: string, keyBase: string) {
  let failed = 0, sent = 0
  for (const to of emails) {
    const r = await sendEmail(ctx, { to, subject, text, dedupeKey: `${keyBase}:${to}` })
    if (r === 'failed') failed++
    else if (r !== 'skipped') sent++
  }
  return { sent, failed }
}

export const handlers: Record<string, Handler> = {
  /** Triggered by the public contact form. */
  async notify_new_submission(ctx, payload) {
    const [sub] = await ctx.db.select().from(submissions).where(eq(submissions.id, String(payload.submissionId)))
    if (!sub) return { skipped: 'submission no longer exists' }
    const { userIds, emails, cfg } = await staffRecipients(ctx.db, ctx.env)
    if (!cfg.notifyOnContact) return { skipped: 'notifyOnContact disabled' }
    const inApp = await notifyUsers(ctx.db, userIds, { type: 'submission.new', title: `Nouvelle demande : ${sub.subject}`, body: `${sub.name} <${sub.email}>`, link: '/admin/submissions', dedupeKey: `sub-new:${sub.id}` })
    const text = `Nouvelle demande reçue via le formulaire de contact MaliREN\n\nDe : ${sub.name} <${sub.email}>\nObjet : ${sub.subject}\n\n${sub.message.slice(0, 1500)}\n\nTraiter : ${adminUrl(ctx, 'submissions')}`
    const r = await emailAll(ctx, emails, `[MaliREN] Nouvelle demande : ${sub.subject}`.slice(0, 200), text, `sub-new:${sub.id}`)
    if (r.failed) throw new Error(`${r.failed} e-mail(s) failed`)
    return { inApp, emailsSent: r.sent, recipients: emails.length }
  },

  async 'automation:publish_scheduled'(ctx, _p, { dryRun, now = new Date() }) {
    const out: Record<string, number> = {}
    for (const [name, t] of Object.entries({ news, events, publications, pages })) {
      const due = await ctx.db.select({ id: t.id, publishAt: t.publishAt }).from(t).where(and(eq(t.status, 'scheduled'), lte(t.publishAt, now)))
      out[name] = due.length
      if (dryRun) continue
      for (const row of due) {
        const [u] = await ctx.db.update(t).set({ status: 'published', publishedAt: row.publishAt ?? now, updatedAt: now }).where(and(eq(t.id, row.id), eq(t.status, 'scheduled'))).returning({ id: t.id })
        if (u) await audit(ctx.db, SYSTEM, 'status.published', name, row.id, 'Published automatically (scheduled)', { scheduled: true })
      }
    }
    return { dryRun: !!dryRun, published: out }
  },

  async 'automation:unhandled_submission_reminder'(ctx, _p, { dryRun, now = new Date() }) {
    const cfg = await getConfig(ctx, 'unhandled_submission_reminder')
    const after = new Date(now.getTime() - num(cfg.afterHours, 48) * 3600_000)
    const cool = new Date(now.getTime() - num(cfg.cooldownHours, 24) * 3600_000)
    const due = await ctx.db.select().from(submissions).where(and(
      sql`((${submissions.status} = 'new' and ${submissions.createdAt} <= ${after}) or (${submissions.status} = 'in_progress' and ${submissions.followUpAt} <= ${now}))`,
      lt(submissions.reminderCount, num(cfg.maxReminders, 3)),
      sql`(${submissions.lastReminderAt} is null or ${submissions.lastReminderAt} <= ${cool})`,
    )).orderBy(submissions.createdAt).limit(50)
    if (!due.length) return { dryRun: !!dryRun, overdue: 0 }
    const { userIds, emails } = await staffRecipients(ctx.db, ctx.env)
    const lines = due.slice(0, 20).map((s) => `• ${s.subject}  ${s.name} (${s.status === 'new' ? 'nouvelle' : 'suivi dû'}, reçue le ${day(s.createdAt)})`)
    const text = `${due.length} demande(s) en attente de traitement :\n\n${lines.join('\n')}${due.length > 20 ? `\n… et ${due.length - 20} autre(s)` : ''}\n\nOuvrir : ${adminUrl(ctx, 'submissions')}`
    if (dryRun) return { dryRun: true, overdue: due.length, wouldNotifyUsers: userIds.length, wouldEmail: emails, preview: text }
    const key = `reminder-submissions:${day(now)}`
    await notifyUsers(ctx.db, userIds, { type: 'submission.reminder', title: `${due.length} demande(s) à traiter`, body: lines[0], link: '/admin/submissions', dedupeKey: key })
    const r = await emailAll(ctx, emails, `[MaliREN] ${due.length} demande(s) en attente`, text, key)
    if (r.failed) throw new Error(`${r.failed} e-mail(s) failed`)
    await ctx.db.update(submissions).set({ reminderCount: sql`${submissions.reminderCount} + 1`, lastReminderAt: now }).where(inArray(submissions.id, due.map((s) => s.id)))
    return { overdue: due.length, emailsSent: r.sent, recipients: emails.length }
  },

  async 'automation:upcoming_reminder'(ctx, _p, { dryRun, now = new Date() }) {
    const cfg = await getConfig(ctx, 'upcoming_reminder')
    const evUntil = new Date(now.getTime() + num(cfg.eventDaysAhead, 7) * 86_400_000)
    const pubUntil = new Date(now.getTime() + num(cfg.publicationHoursAhead, 48) * 3600_000)
    const evs = await ctx.db.select().from(events).where(and(eq(events.status, 'published'), isNull(events.reminderSentAt), gte(events.startsAt, now), lte(events.startsAt, evUntil)))
    const scheduled = [
      ...(await ctx.db.select({ id: news.id, title: news.titleFr, at: news.publishAt }).from(news).where(and(eq(news.status, 'scheduled'), isNull(news.reminderSentAt), lte(news.publishAt, pubUntil)))).map((r) => ({ ...r, kind: 'news' as const })),
      ...(await ctx.db.select({ id: publications.id, title: publications.titleFr, at: publications.publishAt }).from(publications).where(and(eq(publications.status, 'scheduled'), isNull(publications.reminderSentAt), lte(publications.publishAt, pubUntil)))).map((r) => ({ ...r, kind: 'publications' as const })),
    ]
    if (!evs.length && !scheduled.length) return { dryRun: !!dryRun, events: 0, scheduledContent: 0 }
    const lines = [
      ...evs.map((e) => `• Événement : ${e.titleFr}  ${e.dateLabel || day(e.startsAt)}`),
      ...scheduled.map((s) => `• Publication programmée (${s.kind}) : ${s.title}  ${s.at ? s.at.toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : ''}`),
    ]
    const text = `À venir prochainement :\n\n${lines.join('\n')}\n\nAdministration : ${adminUrl(ctx, 'dashboard')}`
    const { userIds, emails } = await staffRecipients(ctx.db, ctx.env)
    if (dryRun) return { dryRun: true, events: evs.length, scheduledContent: scheduled.length, wouldEmail: emails, preview: text }
    const key = `upcoming:${day(now)}`
    await notifyUsers(ctx.db, userIds, { type: 'upcoming', title: `${lines.length} échéance(s) à venir`, body: lines[0], link: '/admin/dashboard', dedupeKey: key })
    const r = await emailAll(ctx, emails, `[MaliREN] ${lines.length} échéance(s) à venir`, text, key)
    if (r.failed) throw new Error(`${r.failed} e-mail(s) failed`)
    if (evs.length) await ctx.db.update(events).set({ reminderSentAt: now }).where(inArray(events.id, evs.map((e) => e.id)))
    for (const [kind, t] of [['news', news], ['publications', publications]] as const) {
      const ids = scheduled.filter((s) => s.kind === kind).map((s) => s.id)
      if (ids.length) await ctx.db.update(t).set({ reminderSentAt: now }).where(inArray(t.id, ids))
    }
    return { events: evs.length, scheduledContent: scheduled.length, emailsSent: r.sent }
  },

  async 'automation:digest'(ctx, _p, { dryRun, now = new Date() }) {
    const cfg = await getConfig(ctx, 'digest')
    const daily = cfg.frequency === 'daily'
    const from = new Date(now.getTime() - (daily ? 1 : 7) * 86_400_000)
    const summary = await buildSummary(ctx.db, from, now)
    const title = `${daily ? 'Digest quotidien' : 'Digest hebdomadaire'} MaliREN  ${day(now)}`
    const text = summaryToText(title, summary)
    const { emails } = await staffRecipients(ctx.db, ctx.env)
    if (dryRun) return { dryRun: true, wouldEmail: emails, preview: text }
    const [existing] = await ctx.db.select({ id: reports.id }).from(reports).where(and(eq(reports.type, 'digest'), eq(reports.title, title)))
    if (!existing) await ctx.db.insert(reports).values({ type: 'digest', title, periodStart: from, periodEnd: now, data: summary })
    const r = await emailAll(ctx, emails, `[MaliREN] ${title}`, text, `digest:${day(now)}:${daily ? 'd' : 'w'}`)
    if (r.failed) throw new Error(`${r.failed} e-mail(s) failed`)
    return { reportCreated: !existing, emailsSent: r.sent }
  },

  async 'automation:cleanup'(ctx, _p, { dryRun, now = new Date() }) {
    const cfg = await getConfig(ctx, 'cleanup')
    const retention = new Date(now.getTime() - num(cfg.jobRetentionDays, 30) * 86_400_000)
    const expiredMedia = await ctx.db.select().from(media).where(and(isNotNull(media.expiresAt), lte(media.expiresAt, now)))
    const oldSessions = sql`${sessions.expiresAt} < ${new Date(now.getTime() - 86_400_000)}`
    const [sessCount] = (await ctx.db.execute(sql`select count(*)::int as n from sessions where expires_at < ${new Date(now.getTime() - 86_400_000)}`)).rows as { n: number }[]
    if (dryRun) return { dryRun: true, expiredUploads: expiredMedia.length, expiredSessions: sessCount.n }
    const root = path.resolve(ctx.env.UPLOAD_DIR)
    for (const m of expiredMedia) {
      const p = path.resolve(root, m.storageKey)
      if (p.startsWith(root + path.sep)) await fs.rm(p, { force: true })
    }
    if (expiredMedia.length) await ctx.db.delete(media).where(inArray(media.id, expiredMedia.map((m) => m.id)))
    await ctx.db.delete(sessions).where(oldSessions)
    const j = await ctx.db.delete(jobs).where(and(inArray(jobs.status, ['succeeded', 'dead']), lt(jobs.finishedAt, retention))).returning({ id: jobs.id })
    const n = await ctx.db.delete(notifications).where(and(isNotNull(notifications.readAt), lt(notifications.readAt, new Date(now.getTime() - 90 * 86_400_000)))).returning({ id: notifications.id })
    await ctx.db.delete(emailLog).where(lt(emailLog.createdAt, new Date(now.getTime() - 180 * 86_400_000)))
    return { expiredUploads: expiredMedia.length, expiredSessions: sessCount.n, oldJobs: j.length, oldNotifications: n.length }
  },
}

export const AUTOMATION_NAMES = ['publish_scheduled', 'unhandled_submission_reminder', 'upcoming_reminder', 'digest', 'cleanup'] as const
export type AutomationName = (typeof AUTOMATION_NAMES)[number]
