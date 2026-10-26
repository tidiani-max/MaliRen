import fs from 'node:fs/promises'
import { sql } from 'drizzle-orm'
import request from 'supertest'
import { createApp } from '../src/app'
import { createContext } from '../src/bootstrap'
import { loadEnv } from '../src/config/env'
import type { AppContext } from '../src/context'
import { users, type Role } from '../src/db/schema'
import { ensureSchedules } from '../src/automation/schedules'
import { hashPassword } from '../src/lib/crypto'
import { seedContent } from '../src/db/seed'
import type { Mailer } from '../src/services/mailer'

export const PASSWORD = 'Correct-Horse-Battery-9'
export const API = '/api/v1'
export const XRW = { 'X-Requested-With': 'maliren' }

export function makeCtx(overrides: Record<string, string> = {}): AppContext {
  const ctx = createContext(loadEnv({ ...process.env, ...overrides }))
  return ctx
}

export async function resetDb(ctx: AppContext, opts: { content?: boolean } = {}) {
  const res = await ctx.db.execute(sql`select tablename from pg_tables where schemaname = 'public'`)
  const names = (res.rows as { tablename: string }[]).map((r) => `"${r.tablename}"`).join(', ')
  await ctx.db.execute(sql.raw(`truncate ${names} restart identity cascade`))
  await ensureSchedules(ctx.db)
  if (opts.content) await seedContent(ctx.db)
  await fs.rm(ctx.env.UPLOAD_DIR, { recursive: true, force: true })
}

export async function mkUser(ctx: AppContext, role: Role, email = `${role}@test.local`, extra: Partial<typeof users.$inferInsert> = {}) {
  const [u] = await ctx.db.insert(users).values({ email, name: `${role} user`, role, passwordHash: await hashPassword(PASSWORD, ctx.env.SCRYPT_N), ...extra }).returning()
  return u
}

export async function login(app: ReturnType<typeof createApp>, email: string, password = PASSWORD) {
  const res = await request(app).post(`${API}/auth/login`).send({ email, password })
  return { res, token: res.body.accessToken as string, cookies: res.headers['set-cookie'] as unknown as string[] }
}

export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` })

/** Create a user of a role and sign in. */
export async function actor(ctx: AppContext, app: ReturnType<typeof createApp>, role: Role) {
  const u = await mkUser(ctx, role)
  const { token, cookies } = await login(app, u.email)
  return { user: u, token, cookies, h: bearer(token) }
}

export function fakeMailer(failTimes = 0): Mailer & { sent: { to: string; subject: string; text: string }[]; failures: number } {
  const m = {
    mode: 'log' as const,
    sent: [] as { to: string; subject: string; text: string }[],
    failures: 0,
    async send(msg: { to: string; subject: string; text: string }) {
      if (m.failures < failTimes) { m.failures++; throw new Error('SMTP down') }
      m.sent.push(msg)
      return 'sent' as const
    },
  }
  return m
}

// 1x1 transparent PNG
export const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')
