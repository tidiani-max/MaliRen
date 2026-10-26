import { and, asc, desc, eq, getTableColumns, gte, ilike, inArray, isNull, lte, or, sql, type SQL } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { z } from 'zod'
import type { AppContext } from '../context'
import { submissionNotes, submissions, users } from '../db/schema'
import { badRequest, notFound } from '../lib/errors'
import { idParam, likeTerm, offset, paged } from '../lib/http'
import { cleanText } from '../lib/text'
import { createRouter, Created } from '../openapi/registry'
import { audit, diff } from '../services/audit'

export const submissionListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().max(100).optional(),
  status: z.enum(['new', 'in_progress', 'handled', 'spam']).optional(),
  assignee: z.union([z.literal('none'), z.literal('me'), z.string().uuid()]).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  sort: z.enum(['newest', 'oldest']).default('newest'),
})

export function submissionFilters(q: z.infer<typeof submissionListQuery>, meId: string): SQL | undefined {
  const c: SQL[] = []
  if (q.status) c.push(eq(submissions.status, q.status))
  if (q.assignee === 'none') c.push(isNull(submissions.assignedTo))
  else if (q.assignee === 'me') c.push(eq(submissions.assignedTo, meId))
  else if (q.assignee) c.push(eq(submissions.assignedTo, q.assignee))
  if (q.from) c.push(gte(submissions.createdAt, q.from))
  if (q.to) c.push(lte(submissions.createdAt, q.to))
  if (q.q) c.push(or(ilike(submissions.name, likeTerm(q.q)), ilike(submissions.email, likeTerm(q.q)), ilike(submissions.subject, likeTerm(q.q)), ilike(submissions.message, likeTerm(q.q)))!)
  return c.length ? and(...c) : undefined
}

export function submissionRoutes(ctx: AppContext) {
  const { router, route } = createRouter(ctx, '/admin/submissions', 'Admin · Submissions')
  const db = ctx.db
  const assignee = alias(users, 'assignee')
  const cols = { ...getTableColumns(submissions), assigneeName: assignee.name }

  route({
    method: 'get', path: '/', auth: 'submissions:read', summary: 'List contact submissions (filters, search, pagination)', query: submissionListQuery,
    handler: async ({ user, query }) => {
      const where = submissionFilters(query, user.id)
      const [items, [{ n }]] = await Promise.all([
        db.select(cols).from(submissions).leftJoin(assignee, eq(assignee.id, submissions.assignedTo)).where(where)
          .orderBy(query.sort === 'oldest' ? asc(submissions.createdAt) : desc(submissions.createdAt)).limit(query.pageSize).offset(offset(query.page, query.pageSize)),
        db.select({ n: sql<number>`count(*)::int` }).from(submissions).where(where),
      ])
      return paged(items, n, query.page, query.pageSize)
    },
  })

  route({
    method: 'get', path: '/staff', auth: 'submissions:read', summary: 'Users a submission can be assigned to',
    handler: async () => ({ items: await db.select({ id: users.id, name: users.name, role: users.role }).from(users).where(and(eq(users.active, true), inArray(users.role, ['super_admin', 'admin', 'editor']))).orderBy(asc(users.name)) }),
  })

  route({
    method: 'get', path: '/:id', auth: 'submissions:read', summary: 'Submission with internal notes', params: idParam,
    handler: async ({ params }) => {
      const [row] = await db.select(cols).from(submissions).leftJoin(assignee, eq(assignee.id, submissions.assignedTo)).where(eq(submissions.id, params.id))
      if (!row) throw notFound('Submission')
      const notes = await db.select().from(submissionNotes).where(eq(submissionNotes.submissionId, params.id)).orderBy(asc(submissionNotes.createdAt))
      return { ...row, notes }
    },
  })

  route({
    method: 'patch', path: '/:id', auth: 'submissions:write', summary: 'Triage: change status, assignee or follow-up date', params: idParam,
    body: z.object({
      status: z.enum(['new', 'in_progress', 'handled', 'spam']),
      assignedTo: z.string().uuid().nullable(),
      followUpAt: z.union([z.null(), z.coerce.date()]),
    }).partial(),
    handler: async ({ req, user, params, body }) => {
      const [before] = await db.select().from(submissions).where(eq(submissions.id, params.id))
      if (!before) throw notFound('Submission')
      if (body.assignedTo) {
        const [a] = await db.select({ id: users.id }).from(users).where(and(eq(users.id, body.assignedTo), eq(users.active, true), inArray(users.role, ['super_admin', 'admin', 'editor'])))
        if (!a) throw badRequest('Assignee must be an active staff member')
      }
      const set: Record<string, unknown> = { ...body, updatedAt: new Date() }
      if (body.status) set.handledAt = body.status === 'handled' ? new Date() : null
      // Taking a request from "new" into work without an explicit assignee assigns it to the actor.
      if (body.status === 'in_progress' && before.status === 'new' && body.assignedTo === undefined && !before.assignedTo) set.assignedTo = user.id
      const [row] = await db.update(submissions).set(set as never).where(eq(submissions.id, params.id)).returning()
      await audit(db, { id: user.id, label: user.email }, body.status ? `status.${body.status}` : 'update', 'submission', params.id, `Submission from ${before.name}${body.status ? `: ${before.status} → ${body.status}` : ' updated'}`, { changes: diff(before as never, set) }, req)
      return row
    },
  })

  route({
    method: 'post', path: '/:id/notes', auth: 'submissions:write', summary: 'Add an internal note', params: idParam,
    body: z.object({ body: z.string().max(3000).transform(cleanText).pipe(z.string().min(1)) }),
    handler: async ({ req, user, params, body }) => {
      const [sub] = await db.select({ id: submissions.id }).from(submissions).where(eq(submissions.id, params.id))
      if (!sub) throw notFound('Submission')
      const [note] = await db.insert(submissionNotes).values({ submissionId: params.id, authorId: user.id, authorName: user.name, body: body.body }).returning()
      await audit(db, { id: user.id, label: user.email }, 'note.add', 'submission', params.id, 'Internal note added', undefined, req)
      return new Created(note)
    },
  })

  route({
    method: 'delete', path: '/:id', auth: 'submissions:delete', summary: 'Delete a submission (e.g. spam, data-erasure request)', params: idParam,
    handler: async ({ req, user, params }) => {
      const [row] = await db.delete(submissions).where(eq(submissions.id, params.id)).returning()
      if (!row) throw notFound('Submission')
      await audit(db, { id: user.id, label: user.email }, 'delete', 'submission', params.id, `Deleted submission from ${row.name}`, undefined, req)
      return undefined
    },
  })

  return router
}
