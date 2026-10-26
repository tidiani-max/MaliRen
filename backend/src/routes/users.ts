import { and, asc, desc, eq, ilike, ne, or, sql, type SQL } from 'drizzle-orm'
import { z } from 'zod'
import { ROLE_RANK } from '../auth/rbac'
import type { AuthUser } from '../auth/middleware'
import type { AppContext } from '../context'
import { notifications, sessions, users, type Role } from '../db/schema'
import { hashPassword, randomToken } from '../lib/crypto'
import { badRequest, conflict, forbidden, notFound } from '../lib/errors'
import { idParam, likeTerm, offset, paged } from '../lib/http'
import { cleanText } from '../lib/text'
import { createRouter, Created } from '../openapi/registry'
import { audit } from '../services/audit'
import { passwordSchema, publicUser } from './auth'

const roleEnum = z.enum(['super_admin', 'admin', 'editor', 'reviewer'])

export function userRoutes(ctx: AppContext) {
  const { router, route } = createRouter(ctx, '/admin/users', 'Admin · Users')
  const db = ctx.db
  const present = (u: typeof users.$inferSelect) => ({ ...publicUser(u), active: u.active, lastLoginAt: u.lastLoginAt, createdAt: u.createdAt, lockedUntil: u.lockedUntil })

  /** Admins may only manage accounts strictly below their own rank and never grant their own rank or higher. */
  const assertCanManage = (actor: AuthUser, targetRole: Role) => {
    if (actor.role !== 'super_admin' && ROLE_RANK[targetRole] >= ROLE_RANK[actor.role]) throw forbidden('You cannot manage accounts at or above your own role')
  }
  async function assertNotLastSuperAdmin(userId: string) {
    const others = await db.select({ id: users.id }).from(users).where(and(eq(users.role, 'super_admin'), eq(users.active, true), ne(users.id, userId)))
    if (!others.length) throw conflict('At least one active super administrator must remain')
  }
  const tempPassword = () => `${randomToken(9)}-Aa1`

  route({
    method: 'get', path: '/', auth: 'users:read', summary: 'List users',
    query: z.object({ page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(50), q: z.string().trim().max(100).optional(), role: roleEnum.optional(), active: z.enum(['true', 'false']).optional() }),
    handler: async ({ query }) => {
      const c: SQL[] = []
      if (query.role) c.push(eq(users.role, query.role))
      if (query.active) c.push(eq(users.active, query.active === 'true'))
      if (query.q) c.push(or(ilike(users.name, likeTerm(query.q)), ilike(users.email, likeTerm(query.q)))!)
      const where = c.length ? and(...c) : undefined
      const [items, [{ n }]] = await Promise.all([
        db.select().from(users).where(where).orderBy(desc(users.createdAt), asc(users.email)).limit(query.pageSize).offset(offset(query.page, query.pageSize)),
        db.select({ n: sql<number>`count(*)::int` }).from(users).where(where),
      ])
      return paged(items.map(present), n, query.page, query.pageSize)
    },
  })

  route({
    method: 'post', path: '/', auth: 'users:write', summary: 'Create a user (a one-time temporary password is returned)',
    body: z.object({ email: z.string().trim().toLowerCase().email().max(254), name: z.string().max(120).transform(cleanText).pipe(z.string().min(2)), role: roleEnum, password: passwordSchema.optional() }),
    handler: async ({ req, user, body }) => {
      assertCanManage(user, body.role)
      const [dup] = await db.select({ id: users.id }).from(users).where(sql`lower(${users.email}) = ${body.email}`)
      if (dup) throw conflict('A user with this email already exists')
      const temp = body.password ?? tempPassword()
      const [row] = await db.insert(users).values({ email: body.email, name: body.name, role: body.role, passwordHash: await hashPassword(temp, ctx.env.SCRYPT_N), mustChangePassword: true }).returning()
      await audit(db, { id: user.id, label: user.email }, 'create', 'user', row.id, `Created user ${row.email} (${row.role})`, undefined, req)
      return new Created({ ...present(row), temporaryPassword: temp })
    },
  })

  route({
    method: 'patch', path: '/:id', auth: 'users:write', summary: 'Change name, role or activation', params: idParam,
    body: z.object({ name: z.string().max(120).transform(cleanText).pipe(z.string().min(2)), role: roleEnum, active: z.boolean() }).partial(),
    handler: async ({ req, user, params, body }) => {
      const [target] = await db.select().from(users).where(eq(users.id, params.id))
      if (!target) throw notFound('User')
      assertCanManage(user, target.role)
      if (body.role) assertCanManage(user, body.role)
      if (params.id === user.id && (body.role !== undefined || body.active === false)) throw badRequest('You cannot change your own role or deactivate yourself')
      const losesSuper = target.role === 'super_admin' && ((body.role && body.role !== 'super_admin') || body.active === false)
      if (losesSuper) await assertNotLastSuperAdmin(target.id)
      const [row] = await db.update(users).set({ ...body, updatedAt: new Date() }).where(eq(users.id, params.id)).returning()
      if (body.active === false || (body.role && body.role !== target.role)) {
        await db.update(sessions).set({ revokedAt: new Date() }).where(and(eq(sessions.userId, params.id), sql`${sessions.revokedAt} is null`))
      }
      await audit(db, { id: user.id, label: user.email }, 'update', 'user', params.id, `Updated user ${row.email}`, { changes: body }, req)
      return present(row)
    },
  })

  route({
    method: 'post', path: '/:id/reset-password', auth: 'users:write', summary: 'Issue a new one-time temporary password and revoke sessions', params: idParam,
    handler: async ({ req, user, params }) => {
      const [target] = await db.select().from(users).where(eq(users.id, params.id))
      if (!target) throw notFound('User')
      if (target.id !== user.id) assertCanManage(user, target.role)
      const temp = tempPassword()
      await db.update(users).set({ passwordHash: await hashPassword(temp, ctx.env.SCRYPT_N), mustChangePassword: true, failedLogins: 0, lockedUntil: null, updatedAt: new Date() }).where(eq(users.id, target.id))
      await db.update(sessions).set({ revokedAt: new Date() }).where(and(eq(sessions.userId, target.id), sql`${sessions.revokedAt} is null`))
      await audit(db, { id: user.id, label: user.email }, 'password.reset', 'user', target.id, `Password reset for ${target.email}`, undefined, req)
      return { temporaryPassword: temp }
    },
  })

  route({
    method: 'delete', path: '/:id', auth: 'users:write', summary: 'Delete a user permanently', params: idParam,
    handler: async ({ req, user, params }) => {
      const [target] = await db.select().from(users).where(eq(users.id, params.id))
      if (!target) throw notFound('User')
      if (target.id === user.id) throw badRequest('You cannot delete your own account')
      assertCanManage(user, target.role)
      if (target.role === 'super_admin') await assertNotLastSuperAdmin(target.id)
      await db.delete(users).where(eq(users.id, params.id))
      await audit(db, { id: user.id, label: user.email }, 'delete', 'user', params.id, `Deleted user ${target.email}`, undefined, req)
      return undefined
    },
  })

  // Own notifications live here to avoid another router file.
  const own = createRouter(ctx, '/admin/notifications', 'Admin · Notifications')
  own.route({
    method: 'get', path: '/', auth: 'authenticated', summary: 'My notifications (newest first) with unread count',
    handler: async ({ user }) => {
      const items = await db.select().from(notifications).where(eq(notifications.userId, user.id)).orderBy(desc(notifications.createdAt)).limit(30)
      const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(notifications).where(and(eq(notifications.userId, user.id), sql`${notifications.readAt} is null`))
      return { items, unread: n }
    },
  })
  own.route({
    method: 'post', path: '/read-all', auth: 'authenticated', summary: 'Mark all my notifications as read',
    handler: async ({ user }) => {
      await db.update(notifications).set({ readAt: new Date() }).where(and(eq(notifications.userId, user.id), sql`${notifications.readAt} is null`))
      return undefined
    },
  })
  own.route({
    method: 'post', path: '/:id/read', auth: 'authenticated', summary: 'Mark one notification as read', params: idParam,
    handler: async ({ user, params }) => {
      await db.update(notifications).set({ readAt: new Date() }).where(and(eq(notifications.id, params.id), eq(notifications.userId, user.id)))
      return undefined
    },
  })

  return { users: router, notifications: own.router }
}
