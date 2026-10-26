import type { Request, Response } from 'express'
import rateLimit from 'express-rate-limit'
import { and, eq, isNull, ne } from 'drizzle-orm'
import { z } from 'zod'
import { signAccessToken } from '../auth/tokens'
import type { AppContext } from '../context'
import { sessions, users, type User } from '../db/schema'
import { hashPassword, randomToken, sha256, verifyPassword } from '../lib/crypto'
import { badRequest, unauthorized, forbidden, tooMany } from '../lib/errors'
import { createRouter } from '../openapi/registry'
import { audit } from '../services/audit'

export const COOKIE = 'maliren_rt'
export const passwordSchema = z.string().min(10, 'At least 10 characters').max(128)
const DUMMY_HASH_PROMISE = (ctx: AppContext) => hashPassword('dummy-password-for-timing', ctx.env.SCRYPT_N)

export const publicUser = (u: Pick<User, 'id' | 'email' | 'name' | 'role' | 'mustChangePassword'>) => ({
  id: u.id, email: u.email, name: u.name, role: u.role, mustChangePassword: u.mustChangePassword,
})

function setRefreshCookie(ctx: AppContext, res: Response, token: string) {
  res.cookie(COOKIE, token, {
    httpOnly: true,
    secure: ctx.env.cookieSecure,
    sameSite: ctx.env.COOKIE_SAMESITE,
    domain: ctx.env.COOKIE_DOMAIN,
    path: '/api/v1/auth',
    maxAge: ctx.env.REFRESH_TOKEN_TTL_DAYS * 86_400_000,
  })
}
const clearRefreshCookie = (ctx: AppContext, res: Response) =>
  res.clearCookie(COOKIE, { httpOnly: true, secure: ctx.env.cookieSecure, sameSite: ctx.env.COOKIE_SAMESITE, domain: ctx.env.COOKIE_DOMAIN, path: '/api/v1/auth' })

async function issueSession(ctx: AppContext, user: User, req: Request, res: Response, familyId?: string) {
  const refresh = randomToken()
  const [s] = await ctx.db
    .insert(sessions)
    .values({
      userId: user.id,
      tokenHash: sha256(refresh),
      familyId: familyId ?? crypto.randomUUID(),
      expiresAt: new Date(Date.now() + ctx.env.REFRESH_TOKEN_TTL_DAYS * 86_400_000),
      userAgent: (req.headers['user-agent'] ?? '').slice(0, 300),
      ip: req.ip,
    })
    .returning()
  setRefreshCookie(ctx, res, refresh)
  return {
    accessToken: signAccessToken(ctx.env, { sub: user.id, role: user.role, sid: s.id }),
    expiresIn: ctx.env.ACCESS_TOKEN_TTL_MIN * 60,
    user: publicUser(user),
  }
}

/** The refresh cookie is the only cookie-authenticated surface, so guard it against CSRF. */
function assertSameOriginIntent(ctx: AppContext, req: Request) {
  const origin = req.headers.origin
  if (origin && !ctx.env.corsOrigins.includes(origin)) throw forbidden('Origin not allowed')
  if (req.headers['x-requested-with'] !== 'maliren') throw forbidden('Missing X-Requested-With header')
}

export function authRoutes(ctx: AppContext) {
  const { router, route } = createRouter(ctx, '/auth', 'Auth')
  const loginLimiter = rateLimit({
    windowMs: ctx.env.LOGIN_RATE_LIMIT_WINDOW_MIN * 60_000,
    limit: ctx.env.LOGIN_RATE_LIMIT_MAX,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (_req, _res, next) => next(tooMany('Too many login attempts, please try again later')),
  })

  route({
    method: 'post', path: '/login', auth: 'public', summary: 'Sign in with email and password',
    middleware: [loginLimiter],
    body: z.object({ email: z.string().trim().toLowerCase().email().max(254), password: z.string().min(1).max(128) }),
    handler: async ({ req, res, body }) => {
      const [user] = await ctx.db.select().from(users).where(eq(users.email, body.email))
      const now = new Date()
      // Always run a scrypt verification so response time does not reveal whether the account exists.
      const hash = user?.passwordHash ?? (await DUMMY_HASH_PROMISE(ctx))
      const ok = await verifyPassword(body.password, hash)
      if (user?.lockedUntil && user.lockedUntil > now) {
        await audit(ctx.db, { id: user.id, label: user.email }, 'login.locked', 'user', user.id, 'Login attempt while locked', undefined, req)
        throw tooMany('Account temporarily locked after repeated failures')
      }
      if (!user || !ok || !user.active) {
        if (user) {
          const failed = user.failedLogins + 1
          const lock = failed >= ctx.env.MAX_FAILED_LOGINS
          await ctx.db.update(users).set({ failedLogins: lock ? 0 : failed, lockedUntil: lock ? new Date(Date.now() + ctx.env.LOCKOUT_MINUTES * 60_000) : null }).where(eq(users.id, user.id))
        }
        await audit(ctx.db, { id: user?.id ?? null, label: body.email }, 'login.failed', 'user', user?.id ?? null, 'Failed login', undefined, req)
        throw unauthorized('Invalid email or password')
      }
      await ctx.db.update(users).set({ failedLogins: 0, lockedUntil: null, lastLoginAt: now }).where(eq(users.id, user.id))
      const out = await issueSession(ctx, user, req, res)
      await audit(ctx.db, { id: user.id, label: user.email }, 'login.success', 'user', user.id, 'Signed in', undefined, req)
      return out
    },
  })

  route({
    method: 'post', path: '/refresh', auth: 'public', summary: 'Rotate the refresh cookie and get a new access token',
    handler: async ({ req, res }) => {
      assertSameOriginIntent(ctx, req)
      const token = req.cookies?.[COOKIE] as string | undefined
      if (!token) throw unauthorized('No session')
      const [s] = await ctx.db.select().from(sessions).where(eq(sessions.tokenHash, sha256(token)))
      if (!s) { clearRefreshCookie(ctx, res); throw unauthorized('Invalid session') }
      if (s.revokedAt) {
        // Re-use of a rotated token: assume theft unless it is a near-simultaneous double refresh.
        if (Date.now() - s.revokedAt.getTime() > 10_000) {
          await ctx.db.update(sessions).set({ revokedAt: new Date() }).where(and(eq(sessions.familyId, s.familyId), isNull(sessions.revokedAt)))
          await audit(ctx.db, { id: s.userId, label: 'unknown' }, 'session.reuse_detected', 'session', s.id, 'Refresh token reuse – session family revoked', undefined, req)
        }
        clearRefreshCookie(ctx, res)
        throw unauthorized('Session expired')
      }
      if (s.expiresAt < new Date()) { clearRefreshCookie(ctx, res); throw unauthorized('Session expired') }
      const [user] = await ctx.db.select().from(users).where(eq(users.id, s.userId))
      if (!user || !user.active) { clearRefreshCookie(ctx, res); throw unauthorized('Account disabled') }
      await ctx.db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, s.id))
      return issueSession(ctx, user, req, res, s.familyId)
    },
  })

  route({
    method: 'post', path: '/logout', auth: 'public', summary: 'Revoke the current session and clear the cookie',
    handler: async ({ req, res }) => {
      assertSameOriginIntent(ctx, req)
      const token = req.cookies?.[COOKIE] as string | undefined
      if (token) {
        const [s] = await ctx.db.update(sessions).set({ revokedAt: new Date() }).where(and(eq(sessions.tokenHash, sha256(token)), isNull(sessions.revokedAt))).returning()
        if (s) await ctx.db.update(sessions).set({ revokedAt: new Date() }).where(and(eq(sessions.familyId, s.familyId), isNull(sessions.revokedAt)))
      }
      clearRefreshCookie(ctx, res)
      return undefined
    },
  })

  route({
    method: 'get', path: '/me', auth: 'authenticated', summary: 'Current user', allowPasswordChangePending: true,
    handler: async ({ user }) => ({ id: user.id, email: user.email, name: user.name, role: user.role, mustChangePassword: user.mustChangePassword }),
  })

  route({
    method: 'post', path: '/change-password', auth: 'authenticated', summary: 'Change own password (revokes other sessions)', allowPasswordChangePending: true,
    body: z.object({ currentPassword: z.string().min(1).max(128), newPassword: passwordSchema }),
    handler: async ({ req, user, body }) => {
      const [row] = await ctx.db.select().from(users).where(eq(users.id, user.id))
      if (!(await verifyPassword(body.currentPassword, row.passwordHash))) throw badRequest('Current password is incorrect')
      if (body.currentPassword === body.newPassword) throw badRequest('New password must differ from the current one')
      await ctx.db.update(users).set({ passwordHash: await hashPassword(body.newPassword, ctx.env.SCRYPT_N), mustChangePassword: false, updatedAt: new Date() }).where(eq(users.id, user.id))
      await ctx.db.update(sessions).set({ revokedAt: new Date() }).where(and(eq(sessions.userId, user.id), ne(sessions.id, user.sessionId), isNull(sessions.revokedAt)))
      await audit(ctx.db, { id: user.id, label: user.email }, 'password.changed', 'user', user.id, 'Password changed', undefined, req)
      return undefined
    },
  })

  return router
}
