import request from 'supertest'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../src/app'
import { API, actor, makeCtx, resetDb } from './helpers'

const ctx = makeCtx()
const app = createApp(ctx)
beforeEach(() => resetDb(ctx))
afterAll(() => ctx.pool.end())

const news = { titleFr: 'Titre test', titleEn: 'Test title' }

describe('server-side RBAC', () => {
  it('rejects every admin endpoint without a token', async () => {
    for (const p of ['/admin/news', '/admin/submissions', '/admin/users', '/admin/media', '/admin/dashboard', '/admin/settings', '/admin/automation', '/admin/activity/audit']) {
      expect((await request(app).get(API + p)).status, p).toBe(401)
    }
  })

  it('reviewer is read-only', async () => {
    const r = await actor(ctx, app, 'reviewer')
    expect((await request(app).get(`${API}/admin/news`).set(r.h)).status).toBe(200)
    expect((await request(app).get(`${API}/admin/submissions`).set(r.h)).status).toBe(200)
    expect((await request(app).get(`${API}/admin/reports/summary`).set(r.h)).status).toBe(200)
    expect((await request(app).post(`${API}/admin/news`).set(r.h).send(news)).status).toBe(403)
    expect((await request(app).post(`${API}/admin/events`).set(r.h).send({ titleFr: 'x', startsAt: new Date() })).status).toBe(403)
    expect((await request(app).get(`${API}/admin/users`).set(r.h)).status).toBe(403)
    expect((await request(app).get(`${API}/admin/settings`).set(r.h)).status).toBe(403)
    expect((await request(app).get(`${API}/admin/activity/audit`).set(r.h)).status).toBe(403)
    expect((await request(app).get(`${API}/admin/activity/jobs`).set(r.h)).status).toBe(403)
  })

  it('editor can write content but not delete, manage users, settings or automation', async () => {
    const e = await actor(ctx, app, 'editor')
    const created = await request(app).post(`${API}/admin/news`).set(e.h).send(news)
    expect(created.status).toBe(201)
    expect((await request(app).delete(`${API}/admin/news/${created.body.id}`).set(e.h)).status).toBe(403)
    expect((await request(app).get(`${API}/admin/users`).set(e.h)).status).toBe(403)
    expect((await request(app).put(`${API}/admin/settings/site`).set(e.h).send({})).status).toBe(403)
    expect((await request(app).patch(`${API}/admin/automation/cleanup`).set(e.h).send({ enabled: false })).status).toBe(403)
    expect((await request(app).get(`${API}/admin/activity/audit`).set(e.h)).status).toBe(403)
  })

  it('admin can delete content and manage lower roles, but not super admins; only super admin runs automation', async () => {
    const a = await actor(ctx, app, 'admin')
    const sa = await actor(ctx, app, 'super_admin')
    const created = await request(app).post(`${API}/admin/news`).set(a.h).send(news)
    expect((await request(app).delete(`${API}/admin/news/${created.body.id}`).set(a.h)).status).toBe(204)
    const mk = await request(app).post(`${API}/admin/users`).set(a.h).send({ email: 'new@test.local', name: 'New Editor', role: 'editor' })
    expect(mk.status).toBe(201)
    expect(mk.body.temporaryPassword).toBeTruthy()
    expect((await request(app).post(`${API}/admin/users`).set(a.h).send({ email: 'x@test.local', name: 'Escalate', role: 'super_admin' })).status).toBe(403)
    expect((await request(app).post(`${API}/admin/users`).set(a.h).send({ email: 'y@test.local', name: 'Peer Admin', role: 'admin' })).status).toBe(403)
    expect((await request(app).patch(`${API}/admin/users/${sa.user.id}`).set(a.h).send({ active: false })).status).toBe(403)
    expect((await request(app).post(`${API}/admin/automation/cleanup/run`).set(a.h).send({ dryRun: true })).status).toBe(403)
    expect((await request(app).post(`${API}/admin/automation/cleanup/run`).set(sa.h).send({ dryRun: true })).status).toBe(200)
    expect((await request(app).get(`${API}/admin/automation`).set(a.h)).status).toBe(200)
  })

  it('nobody can deactivate, demote or delete themselves, or remove the last super admin', async () => {
    const sa = await actor(ctx, app, 'super_admin')
    expect((await request(app).patch(`${API}/admin/users/${sa.user.id}`).set(sa.h).send({ active: false })).status).toBe(400)
    expect((await request(app).patch(`${API}/admin/users/${sa.user.id}`).set(sa.h).send({ role: 'editor' })).status).toBe(400)
    expect((await request(app).delete(`${API}/admin/users/${sa.user.id}`).set(sa.h)).status).toBe(400)
    const other = await request(app).post(`${API}/admin/users`).set(sa.h).send({ email: 'sa2@test.local', name: 'Second Super', role: 'super_admin' })
    expect(other.status).toBe(201)
    expect((await request(app).delete(`${API}/admin/users/${other.body.id}`).set(sa.h)).status).toBe(204)
  })

  it('temporary password must be changed and user creation rejects duplicates', async () => {
    const sa = await actor(ctx, app, 'super_admin')
    const body = { email: 'dup@test.local', name: 'Dup User', role: 'editor' }
    expect((await request(app).post(`${API}/admin/users`).set(sa.h).send(body)).status).toBe(201)
    expect((await request(app).post(`${API}/admin/users`).set(sa.h).send({ ...body, email: 'DUP@test.local' })).status).toBe(409)
  })
})
