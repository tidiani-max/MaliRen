import request from 'supertest'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../src/app'
import { runDueJobs } from '../src/automation/worker'
import { emailLog, jobs, notifications, submissions } from '../src/db/schema'
import { API, actor, fakeMailer, makeCtx, mkUser, resetDb } from './helpers'

const ctx = makeCtx()
const mailer = fakeMailer()
ctx.mailer = mailer
const app = createApp(ctx)
beforeEach(async () => { await resetDb(ctx); mailer.sent.length = 0 })
afterAll(() => ctx.pool.end())

const valid = { name: 'Awa Traoré', email: 'awa@example.org', subject: 'Connexion eduroam', message: 'Bonjour, nous souhaitons rejoindre le réseau.', consent: true, locale: 'fr' }

describe('public contact form', () => {
  it('persists a valid submission in PostgreSQL and shows it in admin', async () => {
    const a = await actor(ctx, app, 'editor')
    const res = await request(app).post(`${API}/public/contact`).send(valid)
    expect(res.status).toBe(201)
    const rows = await ctx.db.select().from(submissions)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ name: 'Awa Traoré', email: 'awa@example.org', status: 'new', consent: true })
    expect(rows[0].ipHash).toBeTruthy()
    const list = await request(app).get(`${API}/admin/submissions`).set(a.h)
    expect(list.body.total).toBe(1)
    expect(list.body.items[0].subject).toBe('Connexion eduroam')
  })

  it('validates input and never stores invalid or consent-less messages', async () => {
    const bad = [{ ...valid, email: 'not-an-email' }, { ...valid, name: '' }, { ...valid, message: 'hi' }, { ...valid, consent: false }, { ...valid, message: 'x'.repeat(5001) }, {}]
    for (const b of bad) {
      const r = await request(app).post(`${API}/public/contact`).send(b)
      expect(r.status).toBe(400)
      expect(r.body.error.code).toBe('bad_request')
    }
    expect(await ctx.db.select().from(submissions)).toHaveLength(0)
  })

  it('silently drops honeypot submissions (nothing stored, no job)', async () => {
    const r = await request(app).post(`${API}/public/contact`).send({ ...valid, website: 'http://spam.example' })
    expect(r.status).toBe(201)
    expect(await ctx.db.select().from(submissions)).toHaveLength(0)
    expect(await ctx.db.select().from(jobs)).toHaveLength(0)
  })

  it('treats an identical resubmission as idempotent', async () => {
    await request(app).post(`${API}/public/contact`).send(valid)
    await request(app).post(`${API}/public/contact`).send(valid)
    expect(await ctx.db.select().from(submissions)).toHaveLength(1)
    expect(await ctx.db.select().from(jobs)).toHaveLength(1)
  })

  it('stores markup as inert text and strips control characters', async () => {
    await request(app).post(`${API}/public/contact`).send({ ...valid, name: 'Eve\u0000 <script>alert(1)</script>', message: 'Message with\u0007 bell <img src=x onerror=alert(1)>' })
    const [row] = await ctx.db.select().from(submissions)
    expect(row.name).not.toContain('\u0000')
    expect(row.message).not.toContain('\u0007')
    expect(row.name).toContain('<script>') // kept as text; React escapes on render, CSV export neutralises formulas
  })

  it('is rate limited per IP', async () => {
    const limited = makeCtx({ CONTACT_RATE_LIMIT_MAX: '2' })
    const limitedApp = createApp(limited)
    const codes: number[] = []
    for (let i = 0; i < 4; i++) codes.push((await request(limitedApp).post(`${API}/public/contact`).send({ ...valid, message: `Message numéro ${i} suffisamment long` })).status)
    expect(codes).toEqual([201, 201, 429, 429])
    await limited.pool.end()
  })
})

describe('new-submission notification automation', () => {
  it('creates in-app notifications and one e-mail per recipient, exactly once', async () => {
    const admin = await mkUser(ctx, 'admin', 'admin@test.local')
    await mkUser(ctx, 'reviewer', 'reviewer@test.local') // read-only users are not notified
    const editor = await mkUser(ctx, 'editor', 'editor@test.local')
    await request(app).post(`${API}/public/contact`).send(valid)
    expect(await runDueJobs(ctx)).toBe(1)
    const n = await ctx.db.select().from(notifications)
    expect(n.map((x) => x.userId).sort()).toEqual([admin.id, editor.id].sort())
    expect(mailer.sent.map((m) => m.to).sort()).toEqual(['admin@test.local', 'editor@test.local'])
    expect(mailer.sent[0].subject).toContain('Connexion eduroam')
    // Re-running the same logical job (e.g. manual re-queue) must not spam again.
    await ctx.db.update(jobs).set({ status: 'queued', attempts: 0 })
    await runDueJobs(ctx)
    expect(mailer.sent).toHaveLength(2)
    expect(await ctx.db.select().from(notifications)).toHaveLength(2)
    expect((await ctx.db.select().from(emailLog)).every((r) => r.status === 'sent')).toBe(true)
  })

  it('respects the notifyOnContact setting', async () => {
    const sa = await actor(ctx, app, 'super_admin')
    await request(app).put(`${API}/admin/settings/notifications`).set(sa.h).send({ notifyOnContact: false, notifyAdmins: true, recipients: [] })
    await request(app).post(`${API}/public/contact`).send(valid)
    await runDueJobs(ctx)
    expect(mailer.sent).toHaveLength(0)
    expect(await ctx.db.select().from(notifications)).toHaveLength(0)
  })
})

describe('submission triage', () => {
  it('supports status, assignment, follow-up, internal notes, filters and deletion rules', async () => {
    const editor = await actor(ctx, app, 'editor')
    const admin = await actor(ctx, app, 'admin')
    await request(app).post(`${API}/public/contact`).send(valid)
    await request(app).post(`${API}/public/contact`).send({ ...valid, email: 'b@example.org', subject: 'Autre sujet', message: 'Un second message de test.' })
    const [first] = (await request(app).get(`${API}/admin/submissions?sort=oldest`).set(editor.h)).body.items

    const inProgress = await request(app).patch(`${API}/admin/submissions/${first.id}`).set(editor.h).send({ status: 'in_progress' })
    expect(inProgress.body.status).toBe('in_progress')
    expect(inProgress.body.assignedTo).toBe(editor.user.id) // auto-assigned to the person who takes it
    const followUp = new Date(Date.now() + 86_400_000).toISOString()
    expect((await request(app).patch(`${API}/admin/submissions/${first.id}`).set(editor.h).send({ followUpAt: followUp, assignedTo: admin.user.id })).body.assignedTo).toBe(admin.user.id)
    const handled = await request(app).patch(`${API}/admin/submissions/${first.id}`).set(editor.h).send({ status: 'handled' })
    expect(handled.body.handledAt).toBeTruthy()
    expect((await request(app).post(`${API}/admin/submissions/${first.id}/notes`).set(editor.h).send({ body: 'Rappelé par téléphone.' })).status).toBe(201)

    const detail = await request(app).get(`${API}/admin/submissions/${first.id}`).set(editor.h)
    expect(detail.body.notes).toHaveLength(1)
    expect(detail.body.notes[0].authorName).toBe('editor user')

    expect((await request(app).get(`${API}/admin/submissions?status=handled`).set(editor.h)).body.total).toBe(1)
    expect((await request(app).get(`${API}/admin/submissions?status=new`).set(editor.h)).body.total).toBe(1)
    expect((await request(app).get(`${API}/admin/submissions?q=second`).set(editor.h)).body.total).toBe(1)
    expect((await request(app).get(`${API}/admin/submissions?q=%25`).set(editor.h)).body.total).toBe(0) // wildcard is escaped
    expect((await request(app).get(`${API}/admin/submissions?assignee=me`).set(admin.h)).body.total).toBe(1)

    expect((await request(app).patch(`${API}/admin/submissions/${first.id}`).set(editor.h).send({ status: 'bogus' })).status).toBe(400)
    expect((await request(app).delete(`${API}/admin/submissions/${first.id}`).set(editor.h)).status).toBe(403)
    expect((await request(app).delete(`${API}/admin/submissions/${first.id}`).set(admin.h)).status).toBe(204)
  })

  it('exports CSV with formula-injection neutralised and records the export in the audit log', async () => {
    const admin = await actor(ctx, app, 'admin')
    await request(app).post(`${API}/public/contact`).send({ ...valid, name: '=HYPERLINK("http://evil","x")', message: '@SUM(1+1) malicious cell' })
    const csv = await request(app).get(`${API}/admin/reports/export/submissions`).set(admin.h)
    expect(csv.status).toBe(200)
    expect(csv.headers['content-type']).toContain('text/csv')
    expect(csv.text).toContain(`"'=HYPERLINK(""http://evil"",""x"")"`)
    expect(csv.text).toContain(`"'@SUM(1+1) malicious cell"`)
    const audit = await request(app).get(`${API}/admin/activity/audit?action=export`).set(admin.h)
    expect(audit.body.total).toBe(1)
  })
})
