import type { Request } from 'express'
import { and, eq, gt, isNull } from 'drizzle-orm'
import type { AppContext } from '../context'
import { sessions, users, type Role } from '../db/schema'
import { forbidden, unauthorized } from '../lib/errors'
import { can, type Permission } from './rbac'
import { verifyAccessToken } from './tokens'

export interface AuthUser { id: string; email: string; name: string; role: Role; sessionId: string; mustChangePassword: boolean }

/**
 * Validates the bearer token AND re-checks the database on every request, so that deactivating a user,
 * changing a role or logging out takes effect immediately instead of when the JWT expires.
 */
export async function authenticate(ctx: AppContext, req: Request): Promise<AuthUser> {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) throw unauthorized()
  const claims = verifyAccessToken(ctx.env, header.slice(7))
  if (!claims) throw unauthorized('Invalid or expired token')
  const [row] = await ctx.db
    .select({ u: users, s: sessions })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, claims.sid), eq(users.id, claims.sub), isNull(sessions.revokedAt), gt(sessions.expiresAt, new Date())))
  if (!row || !row.u.active) throw unauthorized('Session is no longer valid')
  return { id: row.u.id, email: row.u.email, name: row.u.name, role: row.u.role, sessionId: row.s.id, mustChangePassword: row.u.mustChangePassword }
}

export function requirePermission(user: AuthUser, perm: Permission) {
  if (!can(user.role, perm)) throw forbidden()
}
