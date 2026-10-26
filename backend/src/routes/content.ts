import { and, asc, desc, eq, ilike, or, sql, type SQL } from 'drizzle-orm'
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core'
import { z, type ZodType } from 'zod'
import type { AppContext } from '../context'
import { events, institutions, news, pages, publications, type ContentStatus } from '../db/schema'
import { conflict, badRequest, notFound } from '../lib/errors'
import { idParam, likeTerm, offset, paged, pageQuery } from '../lib/http'
import { cleanText, slugify } from '../lib/text'
import { createRouter, Created } from '../openapi/registry'
import { audit, diff } from '../services/audit'

const s = (max: number) => z.string().max(max).transform(cleanText)
const slugField = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Lowercase letters, digits and dashes only').max(80)
const optDate = z.union([z.null(), z.coerce.date()])
const urlOrEmpty = z.union([z.literal(''), z.string().max(500).refine((u) => /^https?:\/\/[^\s]+$/i.test(u), 'Must be an http(s) URL')])

export const ALLOWED_TRANSITIONS: Record<ContentStatus, ContentStatus[]> = {
  draft: ['published', 'scheduled', 'archived'],
  scheduled: ['draft', 'published', 'archived'],
  published: ['draft', 'archived'],
  archived: ['draft'],
}

export const statusBody = z.object({ status: z.enum(['draft', 'scheduled', 'published', 'archived']), publishAt: z.coerce.date().optional() })
const institutionStatusBody = z.object({ status: z.enum(['pending', 'active', 'inactive']) })

interface Cfg {
  name: string
  label: string
  table: PgTable & Record<string, PgColumn> & { id: PgColumn }
  create: ZodType<Record<string, unknown>>
  update: ZodType<Record<string, unknown>>
  searchCols: string[]
  titleCol: string
  newestCol: string
  /** content = draft/scheduled/published/archived workflow; institution = pending/active/inactive */
  workflow: 'content' | 'institution'
  slugFrom: (b: Record<string, unknown>) => string
}

const pageFields = {
  titleFr: s(200).pipe(z.string().min(1)), titleEn: s(200), bodyFr: s(40000), bodyEn: s(40000),
}
const newsCreate = z.object({
  slug: slugField.optional(), category: s(60), titleFr: s(200).pipe(z.string().min(1)), titleEn: s(200),
  excerptFr: s(600), excerptEn: s(600), bodyFr: s(40000), bodyEn: s(40000), coverMediaId: z.string().uuid().nullable(),
}).partial({ category: true, titleEn: true, excerptFr: true, excerptEn: true, bodyFr: true, bodyEn: true, coverMediaId: true })
const eventCreate = z.object({
  slug: slugField.optional(), titleFr: s(200).pipe(z.string().min(1)), titleEn: s(200), subtitleFr: s(300), subtitleEn: s(300),
  descriptionFr: s(3000), descriptionEn: s(3000), dateLabel: s(120), startsAt: z.coerce.date(), endsAt: optDate, location: s(200),
}).partial({ titleEn: true, subtitleFr: true, subtitleEn: true, descriptionFr: true, descriptionEn: true, dateLabel: true, endsAt: true, location: true })
const publicationCreate = z.object({
  slug: slugField.optional(), category: s(60), titleFr: s(200).pipe(z.string().min(1)), titleEn: s(200), summaryFr: s(1500), summaryEn: s(1500),
  dateLabel: s(120), fileMediaId: z.string().uuid().nullable(), externalUrl: urlOrEmpty,
}).partial({ category: true, titleEn: true, summaryFr: true, summaryEn: true, dateLabel: true, fileMediaId: true, externalUrl: true })
const pageCreate = z.object({ slug: slugField, ...pageFields }).partial({ titleEn: true, bodyFr: true, bodyEn: true })
const institutionCreate = z.object({
  slug: slugField.optional(), name: s(200).pipe(z.string().min(1)), kind: z.enum(['pilot', 'member', 'partner']),
  status: z.enum(['pending', 'active', 'inactive']), city: s(120), descriptionFr: s(1500), descriptionEn: s(1500), websiteUrl: urlOrEmpty,
  sortOrder: z.coerce.number().int().min(0).max(10000),
}).partial({ kind: true, status: true, city: true, descriptionFr: true, descriptionEn: true, websiteUrl: true, sortOrder: true })

const upd = <T extends z.ZodObject>(o: T) => o.partial()

const CONFIGS: Cfg[] = [
  { name: 'news', label: 'Actualité', table: news as never, create: newsCreate, update: upd(newsCreate as never), searchCols: ['titleFr', 'titleEn', 'category'], titleCol: 'titleFr', newestCol: 'createdAt', workflow: 'content', slugFrom: (b) => String(b.titleFr) },
  { name: 'events', label: 'Événement', table: events as never, create: eventCreate, update: upd(eventCreate as never), searchCols: ['titleFr', 'titleEn', 'location'], titleCol: 'titleFr', newestCol: 'startsAt', workflow: 'content', slugFrom: (b) => String(b.titleFr) },
  { name: 'publications', label: 'Publication', table: publications as never, create: publicationCreate, update: upd(publicationCreate as never), searchCols: ['titleFr', 'titleEn', 'category'], titleCol: 'titleFr', newestCol: 'createdAt', workflow: 'content', slugFrom: (b) => String(b.titleFr) },
  { name: 'pages', label: 'Contenu', table: pages as never, create: pageCreate, update: upd(pageCreate as never).omit({ slug: true }), searchCols: ['titleFr', 'titleEn', 'slug'], titleCol: 'titleFr', newestCol: 'updatedAt', workflow: 'content', slugFrom: (b) => String(b.slug) },
  { name: 'institutions', label: 'Institution', table: institutions as never, create: institutionCreate, update: upd(institutionCreate as never), searchCols: ['name', 'city'], titleCol: 'name', newestCol: 'createdAt', workflow: 'institution', slugFrom: (b) => String(b.name) },
]

export async function uniqueSlug(ctx: AppContext, table: Cfg['table'], base: string): Promise<string> {
  const root = slugify(base)
  for (let i = 0; i < 50; i++) {
    const candidate = i === 0 ? root : `${root}-${i + 1}`
    const [hit] = await ctx.db.select({ id: table.id }).from(table).where(eq(table.slug, candidate)).limit(1)
    if (!hit) return candidate
  }
  return `${root}-${Date.now()}`
}

export function contentRoutes(ctx: AppContext) {
  const { router, route } = createRouter(ctx, '/admin', 'Admin · Content')
  const db = ctx.db

  for (const cfg of CONFIGS) {
    const t = cfg.table
    const base = `/${cfg.name}`
    const listQuery = pageQuery.extend({
      status: z.enum(['draft', 'scheduled', 'published', 'archived', 'pending', 'active', 'inactive']).optional(),
      kind: z.enum(['pilot', 'member', 'partner']).optional(),
    })
    const actorOf = (u: { id: string; email: string }) => ({ id: u.id, label: u.email })

    route({
      method: 'get', path: base, auth: 'content:read', summary: `List ${cfg.name} (search, filter, sort, paginate)`, query: listQuery,
      handler: async ({ query }) => {
        const conds: SQL[] = []
        if (query.status) conds.push(eq(t.status, query.status))
        if (query.kind && cfg.name === 'institutions') conds.push(eq(t.kind, query.kind))
        if (query.q) conds.push(or(...cfg.searchCols.map((c) => ilike(t[c], likeTerm(query.q!))))!)
        const where = conds.length ? and(...conds) : undefined
        const order = query.sort === 'title' ? asc(t[cfg.titleCol]) : query.sort === 'oldest' ? asc(t[cfg.newestCol]) : desc(t[cfg.newestCol])
        const [items, [{ n }]] = await Promise.all([
          db.select().from(t).where(where).orderBy(order).limit(query.pageSize).offset(offset(query.page, query.pageSize)),
          db.select({ n: sql<number>`count(*)::int` }).from(t).where(where),
        ])
        return paged(items, n, query.page, query.pageSize)
      },
    })

    route({
      method: 'get', path: `${base}/:id`, auth: 'content:read', summary: `Get one ${cfg.name} item`, params: idParam,
      handler: async ({ params }) => {
        const [row] = await db.select().from(t).where(eq(t.id, params.id))
        if (!row) throw notFound(cfg.label)
        return row
      },
    })

    route({
      method: 'post', path: base, auth: 'content:write', summary: `Create ${cfg.name} item`, body: cfg.create,
      handler: async ({ req, user, body }) => {
        const { slug, ...rest } = body as Record<string, unknown>
        const finalSlug = slug ? String(slug) : await uniqueSlug(ctx, t, cfg.slugFrom(body))
        if (slug) {
          const [dup] = await db.select({ id: t.id }).from(t).where(eq(t.slug, finalSlug))
          if (dup) throw conflict('Slug already in use')
        }
        const [row] = await db.insert(t).values({ ...rest, slug: finalSlug, createdBy: user.id, updatedBy: user.id } as never).returning()
        await audit(db, actorOf(user), 'create', cfg.name, String(row.id), `Created ${cfg.label.toLowerCase()} “${String(cfg.slugFrom(body)).slice(0, 80)}”`, undefined, req)
        return new Created(row)
      },
    })

    route({
      method: 'patch', path: `${base}/:id`, auth: 'content:write', summary: `Update ${cfg.name} item`, params: idParam, body: cfg.update,
      handler: async ({ req, user, params, body }) => {
        const [before] = await db.select().from(t).where(eq(t.id, params.id))
        if (!before) throw notFound(cfg.label)
        const patch = body as Record<string, unknown>
        if (patch.slug && patch.slug !== before.slug) {
          const [dup] = await db.select({ id: t.id }).from(t).where(eq(t.slug, String(patch.slug)))
          if (dup) throw conflict('Slug already in use')
        }
        const [row] = await db.update(t).set({ ...patch, updatedBy: user.id, updatedAt: new Date(), isDemo: false } as never).where(eq(t.id, params.id)).returning()
        await audit(db, actorOf(user), 'update', cfg.name, params.id, `Updated ${cfg.label.toLowerCase()}`, { changes: diff(before as Record<string, unknown>, patch) }, req)
        return row
      },
    })

    if (cfg.workflow === 'content') {
      route({
        method: 'post', path: `${base}/:id/status`, auth: 'content:write', summary: 'Change publication status (publish, unpublish, schedule, archive)', params: idParam, body: statusBody,
        handler: async ({ req, user, params, body }) => {
          const [row] = await db.transaction(async (tx) => {
            const [cur] = await tx.select().from(t).where(eq(t.id, params.id)).for('update')
            if (!cur) throw notFound(cfg.label)
            const from = cur.status as ContentStatus
            if (from === body.status) throw conflict(`Already ${from}`)
            if (!ALLOWED_TRANSITIONS[from].includes(body.status)) throw conflict(`Cannot go from ${from} to ${body.status}`)
            const now = new Date()
            const set: Record<string, unknown> = { status: body.status, updatedBy: user.id, updatedAt: now }
            if (body.status === 'scheduled') {
              if (!body.publishAt || body.publishAt <= now) throw badRequest('publishAt must be a future date for scheduled content')
              set.publishAt = body.publishAt
            } else if (body.status === 'published') {
              set.publishedAt = now
              set.publishAt = now
            } else if (body.status === 'draft') {
              set.publishAt = null
            }
            const updated = await tx.update(t).set(set as never).where(eq(t.id, params.id)).returning()
            await audit(tx, actorOf(user), `status.${body.status}`, cfg.name, params.id, `${cfg.label}: ${from} → ${body.status}`, { from, to: body.status, publishAt: body.publishAt ?? null }, req)
            return updated
          })
          return row
        },
      })
    } else {
      route({
        method: 'post', path: `${base}/:id/status`, auth: 'content:write', summary: 'Change institution status', params: idParam, body: institutionStatusBody,
        handler: async ({ req, user, params, body }) => {
          const [before] = await db.select().from(t).where(eq(t.id, params.id))
          if (!before) throw notFound(cfg.label)
          const [row] = await db.update(t).set({ status: body.status, updatedBy: user.id, updatedAt: new Date() } as never).where(eq(t.id, params.id)).returning()
          await audit(db, actorOf(user), `status.${body.status}`, cfg.name, params.id, `Institution: ${before.status} → ${body.status}`, { from: before.status, to: body.status }, req)
          return row
        },
      })
    }

    route({
      method: 'delete', path: `${base}/:id`, auth: 'content:delete', summary: `Delete ${cfg.name} item`, params: idParam,
      handler: async ({ req, user, params }) => {
        const [row] = await db.delete(t).where(eq(t.id, params.id)).returning()
        if (!row) throw notFound(cfg.label)
        await audit(db, actorOf(user), 'delete', cfg.name, params.id, `Deleted ${cfg.label.toLowerCase()} “${String(row.slug)}”`, undefined, req)
        return undefined
      },
    })
  }
  return router
}
