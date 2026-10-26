import { and, asc, desc, eq, gte, ilike, lte, or, sql, type SQL } from 'drizzle-orm'
import { z } from 'zod'
import { AUTOMATION_NAMES, handlers } from '../automation/handlers'
import { DEFAULT_SCHEDULES, computeNextRun } from '../automation/schedules'
import type { AppContext } from '../context'
import { auditLog, automationSchedules, emailLog, events, institutions, jobs, news, notifications, pages, publications, reports, submissions } from '../db/schema'
import { badRequest, notFound } from '../lib/errors'
import { idParam, likeTerm, offset, paged } from '../lib/http'
import { toCsv } from '../lib/text'
import { createRouter, Created, RAW } from '../openapi/registry'
import { audit } from '../services/audit'
import { buildSummary } from '../services/reports'
import { SETTING_SCHEMAS, getSetting, putSetting } from '../services/settings'

const dateRange = z.object({ from: z.coerce.date().optional(), to: z.coerce.date().optional() })

export function adminMiscRoutes(ctx: AppContext) {
  const { router, route } = createRouter(ctx, '/admin', 'Admin · Dashboard, reports & operations')
  const db = ctx.db
  const A = (u: { id: string; email: string }) => ({ id: u.id, label: u.email })

  /* ---------------------------------------------------------------- dashboard */
  route({
    method: 'get', path: '/dashboard', auth: 'content:read', summary: 'Dashboard metrics computed from live data',
    handler: async ({ user }) => {
      const now = new Date()
      const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5, 1))
      const counts = async (status: 'published' | 'draft') => {
        let total = 0
        for (const t of [news, events, publications, pages]) {
          const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(t).where(eq(t.status, status))
          total += r.n
        }
        return total
      }
      const monthSql = (tbl: string) => sql.raw(`select to_char(date_trunc('month', published_at), 'YYYY-MM') as m, count(*)::int as n from ${tbl} where published_at >= '${since.toISOString()}' group by 1`)
      const [published, drafts, [upcoming], [newSubs], monthly, recentSubmissions, recentNews, recentEvents, recentPubs, [{ n: unread }]] = await Promise.all([
        counts('published'),
        counts('draft'),
        db.select({ n: sql<number>`count(*)::int` }).from(events).where(and(eq(events.status, 'published'), gte(sql`coalesce(${events.endsAt}, ${events.startsAt})`, now))),
        db.select({ n: sql<number>`count(*)::int` }).from(submissions).where(eq(submissions.status, 'new')),
        Promise.all([db.execute(monthSql('news')), db.execute(monthSql('events')), db.execute(monthSql('publications'))]),
        db.select({ id: submissions.id, name: submissions.name, subject: submissions.subject, status: submissions.status, createdAt: submissions.createdAt }).from(submissions).orderBy(desc(submissions.createdAt)).limit(5),
        db.select({ id: news.id, title: news.titleFr, status: news.status, updatedAt: news.updatedAt }).from(news).orderBy(desc(news.updatedAt)).limit(5),
        db.select({ id: events.id, title: events.titleFr, status: events.status, updatedAt: events.updatedAt }).from(events).orderBy(desc(events.updatedAt)).limit(5),
        db.select({ id: publications.id, title: publications.titleFr, status: publications.status, updatedAt: publications.updatedAt }).from(publications).orderBy(desc(publications.updatedAt)).limit(5),
        db.select({ n: sql<number>`count(*)::int` }).from(notifications).where(and(eq(notifications.userId, user.id), sql`${notifications.readAt} is null`)),
      ])
      const months: { month: string; published: number }[] = []
      for (let i = 0; i < 6; i++) {
        const d = new Date(Date.UTC(since.getUTCFullYear(), since.getUTCMonth() + i, 1))
        const key = d.toISOString().slice(0, 7)
        const n = monthly.reduce((acc, r) => acc + ((r.rows as { m: string; n: number }[]).find((x) => x.m === key)?.n ?? 0), 0)
        months.push({ month: key, published: n })
      }
      const recentContent = [
        ...recentNews.map((r) => ({ ...r, type: 'news' })), ...recentEvents.map((r) => ({ ...r, type: 'events' })), ...recentPubs.map((r) => ({ ...r, type: 'publications' })),
      ].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()).slice(0, 6)
      return { metrics: { published, drafts, upcomingEvents: upcoming.n, newSubmissions: newSubs.n, unreadNotifications: unread }, publicationActivity: months, recentSubmissions, recentContent }
    },
  })

  /* ---------------------------------------------------------------- reports */
  route({
    method: 'get', path: '/reports/summary', auth: 'reports:read', summary: 'Summary statistics for a period (default: last 30 days)', query: dateRange,
    handler: async ({ query }) => {
      const to = query.to ?? new Date()
      const from = query.from ?? new Date(to.getTime() - 30 * 86_400_000)
      if (from >= to) throw badRequest('"from" must be before "to"')
      return buildSummary(db, from, to)
    },
  })

  const datasets: Record<string, () => Promise<{ headers: string[]; rows: unknown[][] }>> = {
    submissions: async () => ({ headers: ['ID', 'Date', 'Nom', 'Email', 'Objet', 'Message', 'Statut', 'Langue', 'Assigné à', 'Suivi prévu', 'Traitée le'], rows: (await db.select().from(submissions).orderBy(desc(submissions.createdAt))).map((s) => [s.id, s.createdAt, s.name, s.email, s.subject, s.message, s.status, s.locale, s.assignedTo ?? '', s.followUpAt ?? '', s.handledAt ?? '']) }),
    news: async () => ({ headers: ['ID', 'Titre (FR)', 'Titre (EN)', 'Catégorie', 'Statut', 'Publié le', 'Mis à jour'], rows: (await db.select().from(news).orderBy(desc(news.createdAt))).map((r) => [r.id, r.titleFr, r.titleEn, r.category, r.status, r.publishedAt ?? '', r.updatedAt]) }),
    events: async () => ({ headers: ['ID', 'Titre (FR)', 'Date', 'Lieu', 'Statut', 'Mis à jour'], rows: (await db.select().from(events).orderBy(desc(events.startsAt))).map((r) => [r.id, r.titleFr, r.dateLabel || r.startsAt, r.location, r.status, r.updatedAt]) }),
    publications: async () => ({ headers: ['ID', 'Titre (FR)', 'Catégorie', 'Statut', 'Publié le', 'Mis à jour'], rows: (await db.select().from(publications).orderBy(desc(publications.createdAt))).map((r) => [r.id, r.titleFr, r.category, r.status, r.publishedAt ?? '', r.updatedAt]) }),
    institutions: async () => ({ headers: ['ID', 'Nom', 'Type', 'Statut', 'Ville', 'Site web'], rows: (await db.select().from(institutions).orderBy(asc(institutions.name))).map((r) => [r.id, r.name, r.kind, r.status, r.city, r.websiteUrl]) }),
    audit: async () => ({ headers: ['Date', 'Acteur', 'Action', 'Entité', 'ID entité', 'Résumé', 'IP'], rows: (await db.select().from(auditLog).orderBy(desc(auditLog.createdAt)).limit(10000)).map((r) => [r.createdAt, r.actorLabel, r.action, r.entity, r.entityId ?? '', r.summary, r.ip ?? '']) }),
  }
  route({
    method: 'get', path: '/reports/export/:dataset', auth: 'reports:read', summary: 'Download a dataset as CSV (submissions, news, events, publications, institutions, audit)',
    params: z.object({ dataset: z.enum(['submissions', 'news', 'events', 'publications', 'institutions', 'audit']) }),
    handler: async ({ req, res, user, params }) => {
      if (params.dataset === 'audit' && user.role !== 'admin' && user.role !== 'super_admin') throw badRequest('The audit export is limited to administrators')
      const { headers, rows } = await datasets[params.dataset]()
      await audit(db, A(user), 'export', 'report', params.dataset, `Exported ${params.dataset} (${rows.length} rows)`, undefined, req)
      res.setHeader('Content-Type', 'text/csv; charset=utf-8')
      res.setHeader('Content-Disposition', `attachment; filename="maliren-${params.dataset}-${new Date().toISOString().slice(0, 10)}.csv"`)
      res.send(toCsv(headers, rows))
      return RAW
    },
  })

  route({
    method: 'get', path: '/reports/digests', auth: 'reports:read', summary: 'Saved digest / report snapshots',
    handler: async () => ({ items: await db.select().from(reports).orderBy(desc(reports.createdAt)).limit(30) }),
  })
  route({
    method: 'post', path: '/reports/digests', auth: 'reports:generate', summary: 'Generate and save a report snapshot now',
    body: z.object({ days: z.coerce.number().int().min(1).max(365).default(7) }),
    handler: async ({ req, user, body }) => {
      const to = new Date()
      const from = new Date(to.getTime() - body.days * 86_400_000)
      const data = await buildSummary(db, from, to)
      const [row] = await db.insert(reports).values({ type: 'manual', title: `Rapport (${body.days} j)  ${to.toISOString().slice(0, 10)}`, periodStart: from, periodEnd: to, data, createdBy: user.id }).returning()
      await audit(db, A(user), 'create', 'report', row.id, 'Generated report snapshot', undefined, req)
      return new Created(row)
    },
  })

  /* ---------------------------------------------------------------- activity (audit + operations inspector) */
  route({
    method: 'get', path: '/activity/audit', auth: 'audit:read', summary: 'Audit log (filter by entity, action, actor text, dates)',
    query: z.object({ page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(30), q: z.string().trim().max(100).optional(), entity: z.string().max(40).optional(), action: z.string().max(60).optional() }).extend(dateRange.shape),
    handler: async ({ query }) => {
      const c: SQL[] = []
      if (query.entity) c.push(eq(auditLog.entity, query.entity))
      if (query.action) c.push(ilike(auditLog.action, likeTerm(query.action)))
      if (query.from) c.push(gte(auditLog.createdAt, query.from))
      if (query.to) c.push(lte(auditLog.createdAt, query.to))
      if (query.q) c.push(or(ilike(auditLog.actorLabel, likeTerm(query.q)), ilike(auditLog.summary, likeTerm(query.q)))!)
      const where = c.length ? and(...c) : undefined
      const [items, [{ n }]] = await Promise.all([
        db.select().from(auditLog).where(where).orderBy(desc(auditLog.createdAt)).limit(query.pageSize).offset(offset(query.page, query.pageSize)),
        db.select({ n: sql<number>`count(*)::int` }).from(auditLog).where(where),
      ])
      return paged(items, n, query.page, query.pageSize)
    },
  })
  const pg = z.object({ page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(30) })
  route({
    method: 'get', path: '/activity/jobs', auth: 'automation:read', summary: 'Recent background jobs',
    query: pg.extend({ status: z.enum(['queued', 'running', 'succeeded', 'failed', 'dead']).optional() }),
    handler: async ({ query }) => {
      const where = query.status ? eq(jobs.status, query.status) : undefined
      const [items, [{ n }]] = await Promise.all([
        db.select().from(jobs).where(where).orderBy(desc(jobs.createdAt)).limit(query.pageSize).offset(offset(query.page, query.pageSize)),
        db.select({ n: sql<number>`count(*)::int` }).from(jobs).where(where),
      ])
      return paged(items, n, query.page, query.pageSize)
    },
  })
  route({
    method: 'get', path: '/activity/emails', auth: 'automation:read', summary: 'Outgoing e-mail log (sent, logged in dev mode, failed)', query: pg,
    handler: async ({ query }) => {
      const [items, [{ n }]] = await Promise.all([
        db.select().from(emailLog).orderBy(desc(emailLog.createdAt)).limit(query.pageSize).offset(offset(query.page, query.pageSize)),
        db.select({ n: sql<number>`count(*)::int` }).from(emailLog),
      ])
      return { ...paged(items, n, query.page, query.pageSize), mailMode: ctx.env.MAIL_MODE }
    },
  })

  /* ---------------------------------------------------------------- settings */
  route({
    method: 'get', path: '/settings', auth: 'settings:read', summary: 'All persisted settings',
    handler: async () => ({ site: await getSetting(db, 'site'), notifications: await getSetting(db, 'notifications'), mailMode: ctx.env.MAIL_MODE }),
  })
  route({
    method: 'put', path: '/settings/:key', auth: 'settings:write', summary: 'Replace a settings group (site | notifications)',
    params: z.object({ key: z.enum(['site', 'notifications']) }), body: z.record(z.string(), z.unknown()),
    handler: async ({ req, user, params, body }) => {
      const parsed = SETTING_SCHEMAS[params.key].safeParse(body)
      if (!parsed.success) throw badRequest('Invalid settings', parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })))
      const before = await getSetting(db, params.key)
      await putSetting(db, params.key, parsed.data, user.id)
      await audit(db, A(user), 'update', 'settings', params.key, `Updated ${params.key} settings`, { before, after: parsed.data }, req)
      return parsed.data
    },
  })

  /* ---------------------------------------------------------------- integrations (placeholders, no fake connectivity) */
  route({
    method: 'get', path: '/integrations', auth: 'settings:read', summary: 'Operational integrations  placeholders only, none are connected',
    handler: async () => ({
      note: 'Aucune intégration n’est connectée. Ces entrées sont des emplacements de configuration : aucune donnée n’est simulée tant que des identifiants et une API réels n’ont pas été fournis.',
      items: [
        { key: 'eduid', label: 'EduID / fédération d’identité', status: 'not_configured' },
        { key: 'eduroam', label: 'eduroam', status: 'not_configured' },
        { key: 'zoom', label: 'Zoom (visioconférence WACREN)', status: 'not_configured' },
        { key: 'noc-monitoring', label: 'Supervision NOC', status: 'not_configured' },
        { key: 'dns-ntp', label: 'DNS / NTP', status: 'not_configured' },
      ],
    }),
  })

  /* ---------------------------------------------------------------- automation control */
  route({
    method: 'get', path: '/automation', auth: 'automation:read', summary: 'Automation schedules and their status',
    handler: async () => {
      const meta = Object.fromEntries(DEFAULT_SCHEDULES.map((d) => [d.name, d]))
      const order = DEFAULT_SCHEDULES.map((d) => d.name)
      const rows = (await db.select().from(automationSchedules)).sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name))
      return { globalEnabled: ctx.env.AUTOMATIONS_ENABLED, mailMode: ctx.env.MAIL_MODE, items: rows.map((r) => ({ ...r, label: meta[r.name]?.label ?? r.name, description: meta[r.name]?.description ?? '' })) }
    },
  })
  route({
    method: 'patch', path: '/automation/:name', auth: 'automation:manage', summary: 'Enable/disable or reschedule an automation',
    params: z.object({ name: z.enum(AUTOMATION_NAMES) }),
    body: z.object({
      enabled: z.boolean(), kind: z.enum(['interval', 'daily', 'weekly']),
      intervalMinutes: z.number().int().min(1).max(10080), atHour: z.number().int().min(0).max(23), atMinute: z.number().int().min(0).max(59), weekday: z.number().int().min(0).max(6),
      config: z.record(z.string(), z.union([z.number().min(0).max(100000), z.string().max(40), z.boolean()])),
    }).partial(),
    handler: async ({ req, user, params, body }) => {
      const [cur] = await db.select().from(automationSchedules).where(eq(automationSchedules.name, params.name))
      if (!cur) throw notFound('Automation')
      const merged = { ...cur, ...body, config: { ...(cur.config as object), ...(body.config ?? {}) } }
      const [row] = await db.update(automationSchedules).set({ ...merged, nextRunAt: computeNextRun(merged as never, new Date()), updatedAt: new Date() }).where(eq(automationSchedules.name, params.name)).returning()
      await audit(db, A(user), 'update', 'automation', params.name, `Updated automation ${params.name}`, { changes: body }, req)
      return row
    },
  })
  route({
    method: 'post', path: '/automation/:name/run', auth: 'automation:manage', summary: 'Run an automation now (dryRun=true changes nothing and returns a preview)',
    params: z.object({ name: z.enum(AUTOMATION_NAMES) }), body: z.object({ dryRun: z.boolean().default(true), now: z.coerce.date().optional() }),
    handler: async ({ req, user, params, body }) => {
      const result = await handlers[`automation:${params.name}`](ctx, {}, { dryRun: body.dryRun, now: body.now })
      await audit(db, A(user), body.dryRun ? 'automation.dry_run' : 'automation.run', 'automation', params.name, `${body.dryRun ? 'Dry-run' : 'Manual run'} of ${params.name}`, { result }, req)
      return { dryRun: body.dryRun, result }
    },
  })
  route({
    method: 'post', path: '/automation/jobs/:id/retry', auth: 'automation:manage', summary: 'Re-queue a failed or dead job', params: idParam,
    handler: async ({ req, user, params }) => {
      const [row] = await db.update(jobs).set({ status: 'queued', runAt: new Date(), attempts: 0, lastError: null, finishedAt: null }).where(and(eq(jobs.id, params.id), sql`${jobs.status} in ('failed','dead')`)).returning()
      if (!row) throw notFound('Failed job')
      await audit(db, A(user), 'automation.retry', 'job', params.id, `Re-queued job ${row.type}`, undefined, req)
      return row
    },
  })

  return router
}
