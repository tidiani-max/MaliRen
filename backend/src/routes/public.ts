import rateLimit from 'express-rate-limit'
import { and, asc, desc, eq, gte, ilike, lte, or, sql, type SQL } from 'drizzle-orm'
import { z } from 'zod'
import type { AppContext } from '../context'
import { events, institutions, news, pages, publications, submissions } from '../db/schema'
import { notFound, tooMany } from '../lib/errors'
import { sha256 } from '../lib/crypto'
import { likeTerm } from '../lib/http'
import { cleanText } from '../lib/text'
import { createRouter, Created } from '../openapi/registry'
import { audit, SYSTEM } from '../services/audit'
import { enqueue } from '../services/jobs'
import { getSetting } from '../services/settings'

const published = (t: { status: never; publishedAt: never }) => and(eq(t.status, 'published' as never), lte(t.publishedAt, new Date()))
const internal = ['createdBy', 'updatedBy', 'reminderSentAt', 'publishAt'] as const
function strip<T extends Record<string, unknown>>(row: T) {
  const out: Record<string, unknown> = { ...row }
  for (const k of internal) delete out[k]
  return out
}

const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const listQ = z.object({ q: z.string().trim().max(100).optional(), limit: z.coerce.number().int().min(1).max(100).default(50) })

export const contactSchema = z.object({
  name: z.string().min(2).max(120).transform(cleanText).pipe(z.string().min(2)),
  email: z.string().trim().toLowerCase().email().max(254),
  subject: z.string().max(200).transform(cleanText).optional(),
  message: z.string().min(5).max(5000).transform(cleanText).pipe(z.string().min(5)),
  consent: z.literal(true, { error: 'Consent is required' }),
  locale: z.enum(['fr', 'en']).default('fr'),
  /** Honeypot: real users never see or fill this field. */
  website: z.string().max(200).optional(),
})

export function publicRoutes(ctx: AppContext) {
  const { router, route } = createRouter(ctx, '/public', 'Public')
  const db = ctx.db
  const contactLimiter = rateLimit({
    windowMs: ctx.env.CONTACT_RATE_LIMIT_WINDOW_MIN * 60_000,
    limit: ctx.env.CONTACT_RATE_LIMIT_MAX,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (_req, _res, next) => next(tooMany('Too many messages sent from this address. Please try again later.')),
  })

  route({ method: 'get', path: '/site', auth: 'public', summary: 'Public site settings (contacts, network info)', handler: async () => getSetting(db, 'site') })

  route({
    method: 'get', path: '/pages/:slug', auth: 'public', summary: 'Published page by slug', params: z.object({ slug: z.string().max(80) }),
    handler: async ({ params }) => {
      const [row] = await db.select().from(pages).where(and(eq(pages.slug, params.slug), published(pages as never)))
      if (!row) throw notFound('Page')
      return strip(row)
    },
  })

  route({
    method: 'get', path: '/news', auth: 'public', summary: 'Published news, newest first', query: listQ,
    handler: async ({ query }) => {
      const conds: SQL[] = [published(news as never)!]
      if (query.q) conds.push(or(ilike(news.titleFr, likeTerm(query.q)), ilike(news.titleEn, likeTerm(query.q)), ilike(news.excerptFr, likeTerm(query.q)))!)
      const rows = await db.select().from(news).where(and(...conds)).orderBy(desc(news.publishedAt)).limit(query.limit)
      return { items: rows.map(strip) }
    },
  })
  route({
    method: 'get', path: '/news/:ref', auth: 'public', summary: 'One published news item (by slug or id)', params: z.object({ ref: z.string().max(100) }),
    handler: async ({ params }) => {
      const [row] = await db.select().from(news).where(and(published(news as never), uuidRe.test(params.ref) ? eq(news.id, params.ref) : eq(news.slug, params.ref)))
      if (!row) throw notFound('News item')
      return strip(row)
    },
  })

  route({
    method: 'get', path: '/events', auth: 'public', summary: 'Published events split into upcoming (soonest first) and past (latest first)', query: listQ,
    handler: async ({ query }) => {
      const now = new Date()
      const base = published(events as never)!
      const endOrStart = sql`coalesce(${events.endsAt}, ${events.startsAt})`
      const [upcoming, past] = await Promise.all([
        db.select().from(events).where(and(base, sql`${endOrStart} >= ${now}`)).orderBy(asc(events.startsAt)).limit(query.limit),
        db.select().from(events).where(and(base, sql`${endOrStart} < ${now}`)).orderBy(desc(events.startsAt)).limit(query.limit),
      ])
      return { upcoming: upcoming.map(strip), past: past.map(strip) }
    },
  })

  route({
    method: 'get', path: '/publications', auth: 'public', summary: 'Published publications', query: listQ,
    handler: async ({ query }) => {
      const conds: SQL[] = [published(publications as never)!]
      if (query.q) conds.push(or(ilike(publications.titleFr, likeTerm(query.q)), ilike(publications.titleEn, likeTerm(query.q)))!)
      const rows = await db.select().from(publications).where(and(...conds)).orderBy(desc(publications.publishedAt)).limit(query.limit)
      return { items: rows.map(strip) }
    },
  })
  route({
    method: 'get', path: '/publications/:ref', auth: 'public', summary: 'One published publication', params: z.object({ ref: z.string().max(100) }),
    handler: async ({ params }) => {
      const [row] = await db.select().from(publications).where(and(published(publications as never), uuidRe.test(params.ref) ? eq(publications.id, params.ref) : eq(publications.slug, params.ref)))
      if (!row) throw notFound('Publication')
      return strip(row)
    },
  })

  route({
    method: 'get', path: '/institutions', auth: 'public', summary: 'Active member institutions, pilot sites and partners',
    query: z.object({ kind: z.enum(['pilot', 'member', 'partner']).optional() }),
    handler: async ({ query }) => {
      const conds: SQL[] = [eq(institutions.status, 'active')]
      if (query.kind) conds.push(eq(institutions.kind, query.kind))
      const rows = await db.select().from(institutions).where(and(...conds)).orderBy(asc(institutions.sortOrder), asc(institutions.name))
      return { items: rows.map(strip) }
    },
  })
  route({
    method: 'get', path: '/institutions/:ref', auth: 'public', summary: 'One active institution', params: z.object({ ref: z.string().max(100) }),
    handler: async ({ params }) => {
      const [row] = await db.select().from(institutions).where(and(eq(institutions.status, 'active'), uuidRe.test(params.ref) ? eq(institutions.id, params.ref) : eq(institutions.slug, params.ref)))
      if (!row) throw notFound('Institution')
      return strip(row)
    },
  })

  route({
    method: 'get', path: '/search', auth: 'public', summary: 'Search published news, events, publications and institutions',
    query: z.object({ q: z.string().trim().min(2).max(100) }),
    handler: async ({ query }) => {
      const term = likeTerm(query.q)
      const [n, e, p, i] = await Promise.all([
        db.select().from(news).where(and(published(news as never), or(ilike(news.titleFr, term), ilike(news.titleEn, term), ilike(news.excerptFr, term), ilike(news.bodyFr, term)))).limit(10),
        db.select().from(events).where(and(published(events as never), or(ilike(events.titleFr, term), ilike(events.titleEn, term), ilike(events.descriptionFr, term)))).limit(10),
        db.select().from(publications).where(and(published(publications as never), or(ilike(publications.titleFr, term), ilike(publications.titleEn, term), ilike(publications.summaryFr, term)))).limit(10),
        db.select().from(institutions).where(and(eq(institutions.status, 'active'), or(ilike(institutions.name, term), ilike(institutions.descriptionFr, term)))).limit(10),
      ])
      return {
        results: [
          ...n.map((r) => ({ type: 'news', slug: r.slug, category: r.category, titleFr: r.titleFr, titleEn: r.titleEn, textFr: r.excerptFr, textEn: r.excerptEn })),
          ...e.map((r) => ({ type: 'events', slug: r.slug, category: 'Événement', titleFr: r.titleFr, titleEn: r.titleEn, textFr: r.descriptionFr, textEn: r.descriptionEn })),
          ...p.map((r) => ({ type: 'publications', slug: r.slug, category: r.category, titleFr: r.titleFr, titleEn: r.titleEn, textFr: r.summaryFr, textEn: r.summaryEn })),
          ...i.map((r) => ({ type: 'institutions', slug: r.slug, category: 'Institution', titleFr: r.name, titleEn: r.name, textFr: r.descriptionFr, textEn: r.descriptionEn })),
        ],
      }
    },
  })

  route({
    method: 'post', path: '/contact', auth: 'public', summary: 'Submit the public contact form', middleware: [contactLimiter], body: contactSchema,
    handler: async ({ req, body }) => {
      // Bots filling the hidden field get a normal-looking success and nothing is stored.
      if (body.website) return new Created({ ok: true })
      const ipHash = sha256(`maliren:${req.ip ?? ''}`).slice(0, 16)
      const subject = body.subject || (body.locale === 'en' ? 'General request' : 'Demande générale')
      // Idempotency: an identical message from the same address in the last 10 minutes is not stored twice.
      const [dup] = await db.select({ id: submissions.id }).from(submissions).where(and(eq(submissions.email, body.email), eq(submissions.message, body.message), gte(submissions.createdAt, new Date(Date.now() - 10 * 60_000)))).limit(1)
      if (dup) return new Created({ ok: true, id: dup.id })
      const [row] = await db.insert(submissions).values({ name: body.name, email: body.email, subject, message: body.message, locale: body.locale, consent: true, ipHash }).returning({ id: submissions.id })
      await audit(db, SYSTEM, 'submission.received', 'submission', row.id, `New contact request from ${body.name}`, undefined, req)
      await enqueue(db, 'notify_new_submission', { submissionId: row.id }, { dedupeKey: `submission-new:${row.id}` })
      return new Created({ ok: true, id: row.id })
    },
  })

  return router
}
