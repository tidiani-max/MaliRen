import request from 'supertest'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../src/app'
import { sessions, users } from '../src/db/schema'
import { API, PASSWORD, XRW, actor, bearer, login, makeCtx, mkUser, resetDb } from './helpers'

const ctx = makeCtx({ MAX_FAILED_LOGINS: '3' })
const app = createApp(ctx)
beforeAll(() => resetDb(ctx))
beforeEach(() => resetDb(ctx))
afterAll(() => ctx.pool.end())

describe('authentication', () => {
  it('logs in with valid credentials and sets an httpOnly refresh cookie', async () => {
    await mkUser(ctx, 'editor', 'a@test.local')
    const { res } = await login(app, 'A@Test.local') // case-insensitive email
    expect(res.status).toBe(200)
    expect(res.body.accessToken).toBeTruthy()
    expect(res.body.user).toMatchObject({ email: 'a@test.local', role: 'editor' })
    expect(JSON.stringify(res.body)).not.toContain('passwordHash')
    const cookie = (res.headers['set-cookie'] as unknown as string[])[0]
    expect(cookie).toMatch(/maliren_rt=/)
    expect(cookie).toMatch(/HttpOnly/i)
    expect(cookie).toMatch(/Path=\/api\/v1\/auth/)
  })

  it('stores only a hash of the refresh token and a scrypt password hash', async () => {
    const u = await mkUser(ctx, 'editor', 'a@test.local')
    const { cookies } = await login(app, u.email)
    const token = cookies[0].split(';')[0].split('=')[1]
    const rows = await ctx.db.select().from(sessions)
    expect(rows).toHaveLength(1)
    expect(rows[0].tokenHash).not.toContain(token)
    const [row] = await ctx.db.select().from(users).where(eq(users.id, u.id))
    expect(row.passwordHash.startsWith('scrypt$')).toBe(true)
    expect(row.passwordHash).not.toContain(PASSWORD)
  })

  it('rejects bad passwords and unknown users with the same generic message', async () => {
    await mkUser(ctx, 'editor', 'a@test.local')
    const bad = await login(app, 'a@test.local', 'wrong-password-1')
    const unknown = await login(app, 'nobody@test.local', 'wrong-password-1')
    expect(bad.res.status).toBe(401)
    expect(unknown.res.status).toBe(401)
    expect(bad.res.body.error.message).toBe(unknown.res.body.error.message)
  })

  it('locks the account after repeated failures, even for the right password', async () => {
    await mkUser(ctx, 'editor', 'a@test.local')
    for (let i = 0; i < 3; i++) await login(app, 'a@test.local', 'wrong-password-1')
    const ok = await login(app, 'a@test.local')
    expect(ok.res.status).toBe(429)
  })

  it('refuses inactive users', async () => {
    await mkUser(ctx, 'editor', 'a@test.local', { active: false })
    expect((await login(app, 'a@test.local')).res.status).toBe(401)
  })

  it('protects /me and rejects missing, malformed and forged tokens', async () => {
    expect((await request(app).get(`${API}/auth/me`)).status).toBe(401)
    expect((await request(app).get(`${API}/auth/me`).set(bearer('garbage'))).status).toBe(401)
    const a = await actor(ctx, app, 'editor')
    const me = await request(app).get(`${API}/auth/me`).set(a.h)
    expect(me.body).toMatchObject({ email: 'editor@test.local', role: 'editor' })
    const forged = a.token.split('.').slice(0, 2).join('.') + '.AAAA'
    expect((await request(app).get(`${API}/auth/me`).set(bearer(forged))).status).toBe(401)
  })

  it('rotates refresh tokens and detects reuse of a rotated token (family revoked)', async () => {
    const a = await actor(ctx, app, 'editor')
    const first = a.cookies[0].split(';')[0]
    const r1 = await request(app).post(`${API}/auth/refresh`).set(XRW).set('Cookie', first)
    expect(r1.status).toBe(200)
    const second = (r1.headers['set-cookie'] as unknown as string[])[0].split(';')[0]
    expect(second).not.toBe(first)
    // age the revoked session so it is not mistaken for a double-click race
    await ctx.db.update(sessions).set({ revokedAt: new Date(Date.now() - 60_000) }).where(eq(sessions.tokenHash, (await import('../src/lib/crypto')).sha256(first.split('=')[1])))
    const replay = await request(app).post(`${API}/auth/refresh`).set(XRW).set('Cookie', first)
    expect(replay.status).toBe(401)
    // the legitimate newest token is now dead too
    const after = await request(app).post(`${API}/auth/refresh`).set(XRW).set('Cookie', second)
    expect(after.status).toBe(401)
  })

  it('requires the X-Requested-With header and an allowed Origin on refresh (CSRF)', async () => {
    const a = await actor(ctx, app, 'editor')
    const cookie = a.cookies[0].split(';')[0]
    expect((await request(app).post(`${API}/auth/refresh`).set('Cookie', cookie)).status).toBe(403)
    expect((await request(app).post(`${API}/auth/refresh`).set(XRW).set('Origin', 'https://evil.example').set('Cookie', cookie)).status).toBe(403)
    expect((await request(app).post(`${API}/auth/refresh`).set(XRW).set('Origin', 'http://localhost:5173').set('Cookie', cookie)).status).toBe(200)
  })

  it('logout revokes the session immediately  the still-unexpired access token stops working', async () => {
    const a = await actor(ctx, app, 'editor')
    expect((await request(app).get(`${API}/auth/me`).set(a.h)).status).toBe(200)
    const out = await request(app).post(`${API}/auth/logout`).set(XRW).set('Cookie', a.cookies[0].split(';')[0])
    expect(out.status).toBe(204)
    expect((await request(app).get(`${API}/auth/me`).set(a.h)).status).toBe(401)
    expect((await request(app).post(`${API}/auth/refresh`).set(XRW).set('Cookie', a.cookies[0].split(';')[0])).status).toBe(401)
  })

  it('deactivating a user kills their live sessions at once', async () => {
    const admin = await actor(ctx, app, 'super_admin')
    const editor = await actor(ctx, app, 'editor')
    const res = await request(app).patch(`${API}/admin/users/${editor.user.id}`).set(admin.h).send({ active: false })
    expect(res.status).toBe(200)
    expect((await request(app).get(`${API}/auth/me`).set(editor.h)).status).toBe(401)
  })

  it('changes password: needs the current one, enforces length, revokes other sessions', async () => {
    const a = await actor(ctx, app, 'editor')
    const other = await login(app, a.user.email)
    expect((await request(app).post(`${API}/auth/change-password`).set(a.h).send({ currentPassword: 'nope-nope-nope', newPassword: 'New-Password-12345' })).status).toBe(400)
    expect((await request(app).post(`${API}/auth/change-password`).set(a.h).send({ currentPassword: PASSWORD, newPassword: 'short' })).status).toBe(400)
    expect((await request(app).post(`${API}/auth/change-password`).set(a.h).send({ currentPassword: PASSWORD, newPassword: 'New-Password-12345' })).status).toBe(204)
    expect((await request(app).get(`${API}/auth/me`).set(a.h)).status).toBe(200)
    expect((await request(app).get(`${API}/auth/me`).set(bearer(other.token))).status).toBe(401)
    expect((await login(app, a.user.email)).res.status).toBe(401)
    expect((await login(app, a.user.email, 'New-Password-12345')).res.status).toBe(200)
  })

  it('forces a password change before anything else when mustChangePassword is set', async () => {
    await mkUser(ctx, 'editor', 'temp@test.local', { mustChangePassword: true })
    const { token } = await login(app, 'temp@test.local')
    expect((await request(app).get(`${API}/admin/news`).set(bearer(token))).status).toBe(403)
    expect((await request(app).post(`${API}/auth/change-password`).set(bearer(token)).send({ currentPassword: PASSWORD, newPassword: 'Another-Long-Pass-77' })).status).toBe(204)
    expect((await request(app).get(`${API}/admin/news`).set(bearer(token))).status).toBe(200)
  })
})

describe('login rate limiting', () => {
  it('returns 429 after the configured number of attempts from one IP', async () => {
    const limited = makeCtx({ LOGIN_RATE_LIMIT_MAX: '3' })
    const limitedApp = createApp(limited)
    const codes: number[] = []
    for (let i = 0; i < 5; i++) codes.push((await request(limitedApp).post(`${API}/auth/login`).send({ email: 'x@test.local', password: 'whatever-123' })).status)
    expect(codes.slice(0, 3)).toEqual([401, 401, 401])
    expect(codes.slice(3)).toEqual([429, 429])
    await limited.pool.end()
  })
})
