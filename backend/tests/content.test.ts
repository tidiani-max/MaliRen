import fs from 'node:fs/promises'
import path from 'node:path'
import request from 'supertest'
import { eq } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../src/app'
import { auditLog, media } from '../src/db/schema'
import { API, PNG, actor, makeCtx, resetDb } from './helpers'

const ctx = makeCtx()
const app = createApp(ctx)
beforeEach(() => resetDb(ctx))
afterAll(async () => { await ctx.pool.end(); await fs.rm(ctx.env.UPLOAD_DIR, { recursive: true, force: true }) })

const draft = { titleFr: 'Nouveau réseau à Bamako', titleEn: 'New network in Bamako', category: 'Réseau', excerptFr: 'Résumé', bodyFr: 'Corps du texte.' }

describe('admin content CRUD', () => {
  it('creates, reads, updates, lists with search/sort/pagination and deletes', async () => {
    const a = await actor(ctx, app, 'admin')
    const c = await request(app).post(`${API}/admin/news`).set(a.h).send(draft)
    expect(c.status).toBe(201)
    expect(c.body).toMatchObject({ status: 'draft', slug: 'nouveau-reseau-a-bamako', createdBy: a.user.id })
    // same title -> unique slug
    const c2 = await request(app).post(`${API}/admin/news`).set(a.h).send({ ...draft, titleFr: 'Autre actualité' })
    expect(c2.status).toBe(201)
    const dup = await request(app).post(`${API}/admin/news`).set(a.h).send({ ...draft, slug: 'nouveau-reseau-a-bamako' })
    expect(dup.status).toBe(409)

    const upd = await request(app).patch(`${API}/admin/news/${c.body.id}`).set(a.h).send({ titleEn: 'Updated' })
    expect(upd.body.titleEn).toBe('Updated')
    expect((await request(app).get(`${API}/admin/news/${c.body.id}`).set(a.h)).body.titleEn).toBe('Updated')

    const list = await request(app).get(`${API}/admin/news?q=autre&pageSize=1`).set(a.h)
    expect(list.body).toMatchObject({ total: 1, page: 1, pageSize: 1 })
    expect((await request(app).get(`${API}/admin/news?sort=title`).set(a.h)).body.items.map((i: { titleFr: string }) => i.titleFr)).toEqual(['Autre actualité', 'Nouveau réseau à Bamako'])
    expect((await request(app).get(`${API}/admin/news?status=published`).set(a.h)).body.total).toBe(0)

    expect((await request(app).delete(`${API}/admin/news/${c.body.id}`).set(a.h)).status).toBe(204)
    expect((await request(app).get(`${API}/admin/news/${c.body.id}`).set(a.h)).status).toBe(404)
  })

  it('validates payloads (types, lengths, URLs, uuids)', async () => {
    const a = await actor(ctx, app, 'admin')
    expect((await request(app).post(`${API}/admin/news`).set(a.h).send({ titleFr: '' })).status).toBe(400)
    expect((await request(app).post(`${API}/admin/news`).set(a.h).send({ titleFr: 'x'.repeat(201) })).status).toBe(400)
    expect((await request(app).post(`${API}/admin/news`).set(a.h).send({ titleFr: 'ok', coverMediaId: 'nope' })).status).toBe(400)
    expect((await request(app).post(`${API}/admin/news`).set(a.h).send({ titleFr: 'ok', coverMediaId: '00000000-0000-4000-8000-000000000000' })).status).toBe(400) // FK
    expect((await request(app).post(`${API}/admin/publications`).set(a.h).send({ titleFr: 'ok', externalUrl: 'javascript:alert(1)' })).status).toBe(400)
    expect((await request(app).post(`${API}/admin/events`).set(a.h).send({ titleFr: 'ok', startsAt: 'not-a-date' })).status).toBe(400)
    expect((await request(app).get(`${API}/admin/news/not-a-uuid`).set(a.h)).status).toBe(400)
    expect((await request(app).post(`${API}/admin/news`).set(a.h).set('Content-Type', 'application/json').send('{bad json')).status).toBe(400)
  })

  it('supports all five modules: news, events, publications, pages, institutions', async () => {
    const a = await actor(ctx, app, 'admin')
    const ev = await request(app).post(`${API}/admin/events`).set(a.h).send({ titleFr: 'Atelier', startsAt: '2030-05-01T09:00:00Z', location: 'Bamako' })
    const pub = await request(app).post(`${API}/admin/publications`).set(a.h).send({ titleFr: 'Guide', category: 'Guide', externalUrl: 'https://example.org/guide.pdf' })
    const pg = await request(app).post(`${API}/admin/pages`).set(a.h).send({ slug: 'a-propos', titleFr: 'À propos', bodyFr: 'Texte' })
    const inst = await request(app).post(`${API}/admin/institutions`).set(a.h).send({ name: 'Université X', kind: 'member', city: 'Bamako' })
    for (const r of [ev, pub, pg, inst]) expect(r.status).toBe(201)
    expect(inst.body.status).toBe('pending')
    expect((await request(app).post(`${API}/admin/pages`).set(a.h).send({ slug: 'Bad Slug', titleFr: 'x' })).status).toBe(400)
    const act = await request(app).post(`${API}/admin/institutions/${inst.body.id}/status`).set(a.h).send({ status: 'active' })
    expect(act.body.status).toBe('active')
    expect((await request(app).get(`${API}/admin/institutions?kind=member&status=active`).set(a.h)).body.total).toBe(1)
  })
})

describe('publication status workflow', () => {
  it('draft → published → unpublished → archived → restored, with invalid transitions rejected', async () => {
    const a = await actor(ctx, app, 'editor')
    const { body } = await request(app).post(`${API}/admin/news`).set(a.h).send(draft)
    const st = (status: string, extra: object = {}) => request(app).post(`${API}/admin/news/${body.id}/status`).set(a.h).send({ status, ...extra })

    expect((await st('draft')).status).toBe(409) // already draft
    expect((await st('archived')).status).toBe(200)
    expect((await st('published')).status).toBe(409) // archived must be restored to draft first
    expect((await st('draft')).body.status).toBe('draft')
    const pub = await st('published')
    expect(pub.status).toBe(200)
    expect(pub.body.publishedAt).toBeTruthy()
    expect((await st('scheduled', { publishAt: new Date(Date.now() + 3600_000).toISOString() })).status).toBe(409) // published → scheduled not allowed
    expect((await st('draft')).body.status).toBe('draft') // unpublish
    expect((await st('scheduled')).status).toBe(400) // needs publishAt
    expect((await st('scheduled', { publishAt: new Date(Date.now() - 1000).toISOString() })).status).toBe(400) // must be future
    const sch = await st('scheduled', { publishAt: new Date(Date.now() + 3600_000).toISOString() })
    expect(sch.body.status).toBe('scheduled')
  })

  it('public API exposes only published, already-live content', async () => {
    const a = await actor(ctx, app, 'admin')
    const mk = async (titleFr: string) => (await request(app).post(`${API}/admin/news`).set(a.h).send({ titleFr })).body
    const live = await mk('Visible'); const hidden = await mk('Brouillon'); const sched = await mk('Programmée'); const arch = await mk('Archivée')
    await request(app).post(`${API}/admin/news/${live.id}/status`).set(a.h).send({ status: 'published' })
    await request(app).post(`${API}/admin/news/${sched.id}/status`).set(a.h).send({ status: 'scheduled', publishAt: new Date(Date.now() + 3600_000).toISOString() })
    await request(app).post(`${API}/admin/news/${arch.id}/status`).set(a.h).send({ status: 'archived' })

    const list = await request(app).get(`${API}/public/news`)
    expect(list.body.items.map((i: { titleFr: string }) => i.titleFr)).toEqual(['Visible'])
    expect(JSON.stringify(list.body)).not.toMatch(/createdBy|updatedBy/)
    expect((await request(app).get(`${API}/public/news/${live.slug}`)).status).toBe(200)
    expect((await request(app).get(`${API}/public/news/${live.id}`)).status).toBe(200)
    for (const x of [hidden, sched, arch]) {
      expect((await request(app).get(`${API}/public/news/${x.slug}`)).status).toBe(404)
      expect((await request(app).get(`${API}/public/news/${x.id}`)).status).toBe(404)
    }
    expect((await request(app).get(`${API}/public/search?q=visible`)).body.results).toHaveLength(1)
    expect((await request(app).get(`${API}/public/search?q=programm`)).body.results).toHaveLength(0)
  })

  it('splits public events into upcoming and past by date', async () => {
    const a = await actor(ctx, app, 'admin')
    for (const [t, d] of [['Futur', '2099-01-01T09:00:00Z'], ['Passé', '2020-01-01T09:00:00Z']]) {
      const e = await request(app).post(`${API}/admin/events`).set(a.h).send({ titleFr: t, startsAt: d })
      await request(app).post(`${API}/admin/events/${e.body.id}/status`).set(a.h).send({ status: 'published' })
    }
    const r = await request(app).get(`${API}/public/events`)
    expect(r.body.upcoming.map((e: { titleFr: string }) => e.titleFr)).toEqual(['Futur'])
    expect(r.body.past.map((e: { titleFr: string }) => e.titleFr)).toEqual(['Passé'])
  })

  it('serves seeded prototype content publicly, flagged as demo', async () => {
    await resetDb(ctx, { content: true })
    expect((await request(app).get(`${API}/public/news`)).body.items).toHaveLength(3)
    const ev = (await request(app).get(`${API}/public/events`)).body
    expect(ev.upcoming.length + ev.past.length).toBe(6)
    expect((await request(app).get(`${API}/public/institutions?kind=pilot`)).body.items).toHaveLength(5)
    expect((await request(app).get(`${API}/public/publications`)).body.items).toHaveLength(2)
    expect((await request(app).get(`${API}/public/news`)).body.items.every((n: { isDemo: boolean }) => n.isDemo)).toBe(true)
    expect((await request(app).get(`${API}/public/site`)).body.technicalContactName).toBe('Cheickné H. DIAWARA')
    expect((await request(app).get(`${API}/public/pages/mentions`)).status).toBe(200)
    // A human editing a demo record counts as validating it: the demo flag is cleared.
    const a = await actor(ctx, app, 'editor')
    const first = (await request(app).get(`${API}/admin/news`).set(a.h)).body.items[0]
    await request(app).patch(`${API}/admin/news/${first.id}`).set(a.h).send({ titleEn: 'Reviewed' })
    expect((await request(app).get(`${API}/public/news/${first.slug}`)).body.isDemo).toBe(false)
  })
})

describe('audit log', () => {
  it('records who did what for create / update / status / delete, with change diffs', async () => {
    const a = await actor(ctx, app, 'admin')
    const { body } = await request(app).post(`${API}/admin/news`).set(a.h).send(draft)
    await request(app).patch(`${API}/admin/news/${body.id}`).set(a.h).send({ titleFr: 'Titre modifié' })
    await request(app).post(`${API}/admin/news/${body.id}/status`).set(a.h).send({ status: 'published' })
    await request(app).delete(`${API}/admin/news/${body.id}`).set(a.h)
    const rows = await ctx.db.select().from(auditLog).where(eq(auditLog.entityId, body.id))
    expect(rows.map((r) => r.action).sort()).toEqual(['create', 'delete', 'status.published', 'update'])
    expect(rows.every((r) => r.actorId === a.user.id && r.actorLabel === a.user.email)).toBe(true)
    const update = rows.find((r) => r.action === 'update')!
    expect(update.meta).toMatchObject({ changes: { titleFr: { from: 'Nouveau réseau à Bamako', to: 'Titre modifié' } } })

    const api = await request(app).get(`${API}/admin/activity/audit?entity=news&q=${encodeURIComponent(a.user.email)}`).set(a.h)
    expect(api.body.total).toBe(4)
  })

  it('records failed logins and permission-relevant events', async () => {
    const a = await actor(ctx, app, 'admin')
    await request(app).post(`${API}/auth/login`).send({ email: a.user.email, password: 'wrong-password-1' })
    const r = await request(app).get(`${API}/admin/activity/audit?action=login`).set(a.h)
    expect(r.body.items.map((i: { action: string }) => i.action)).toEqual(expect.arrayContaining(['login.failed', 'login.success']))
  })
})

describe('media library', () => {
  const upload = (token: string, buf: Buffer, name: string, extra: Record<string, string> = {}) => {
    const r = request(app).post(`${API}/admin/media`).set({ Authorization: `Bearer ${token}` })
    for (const [k, v] of Object.entries(extra)) r.field(k, v)
    return r.attach('file', buf, name)
  }

  it('accepts a real image, stores it outside the web root with a random name, serves it safely, edits metadata and deletes it', async () => {
    const a = await actor(ctx, app, 'editor')
    const admin = await actor(ctx, app, 'admin')
    const up = await upload(a.token, PNG, 'logo ../../évil.png')
    expect(up.status).toBe(201)
    expect(up.body).toMatchObject({ mimeType: 'image/png', sizeBytes: PNG.length })
    expect(up.body.storageKey).toMatch(/^\d{4}[\\/][0-9a-f-]{36}\.png$/)
    expect(up.body.originalName).not.toContain('/')
    await fs.access(path.resolve(ctx.env.UPLOAD_DIR, up.body.storageKey))

    const served = await request(app).get(`${API}/public/media/${up.body.id}`)
    expect(served.status).toBe(200)
    expect(served.headers['content-type']).toBe('image/png')
    expect(served.headers['x-content-type-options']).toBe('nosniff')
    expect(served.headers['content-security-policy']).toContain('sandbox')

    const meta = await request(app).patch(`${API}/admin/media/${up.body.id}`).set(a.h).send({ altFr: 'Logo', caption: 'Légende' })
    expect(meta.body).toMatchObject({ altFr: 'Logo', caption: 'Légende' })
    expect((await request(app).delete(`${API}/admin/media/${up.body.id}`).set(a.h)).status).toBe(403)
    expect((await request(app).delete(`${API}/admin/media/${up.body.id}`).set(admin.h)).status).toBe(204)
    await expect(fs.access(path.resolve(ctx.env.UPLOAD_DIR, up.body.storageKey))).rejects.toThrow()
    expect((await request(app).get(`${API}/public/media/${up.body.id}`)).status).toBe(404)
  })

  it('rejects disguised and dangerous files by content, not by name or declared type', async () => {
    const a = await actor(ctx, app, 'editor')
    for (const [buf, name] of [
      [Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>'), 'x.svg'],
      [Buffer.from('<html><script>alert(1)</script></html>'), 'x.png'],
      [Buffer.from('MZ\x90\x00 fake exe'), 'photo.jpg'],
      [Buffer.from('#!/bin/sh\nrm -rf /'), 'run.pdf'],
      [Buffer.from('PK\x03\x04 zip but not office'), 'archive.zip'],
    ] as [Buffer, string][]) {
      expect((await upload(a.token, buf, name)).status, name).toBe(400)
    }
    expect(await ctx.db.select().from(media)).toHaveLength(0)
  })

  it('enforces the size limit, authentication and write permission', async () => {
    const small = makeCtx({ MAX_UPLOAD_MB: '1' })
    const smallApp = createApp(small)
    const a = await actor(small, smallApp, 'editor')
    const big = Buffer.concat([PNG, Buffer.alloc(1.2 * 1024 * 1024)])
    const r = await request(smallApp).post(`${API}/admin/media`).set(a.h).attach('file', big, 'big.png')
    expect(r.status).toBe(413)
    await small.pool.end()
    expect((await request(app).post(`${API}/admin/media`).attach('file', PNG, 'a.png')).status).toBe(401)
    const reviewer = await actor(ctx, app, 'reviewer')
    expect((await upload(reviewer.token, PNG, 'a.png')).status).toBe(403)
  })

  it('temporary uploads are not publicly served until kept', async () => {
    const a = await actor(ctx, app, 'editor')
    const up = await upload(a.token, PNG, 'tmp.png', { temporary: 'true' })
    expect(up.body.expiresAt).toBeTruthy()
    expect((await request(app).get(`${API}/public/media/${up.body.id}`)).status).toBe(404)
    await request(app).patch(`${API}/admin/media/${up.body.id}`).set(a.h).send({ keep: true })
    expect((await request(app).get(`${API}/public/media/${up.body.id}`)).status).toBe(200)
  })
})
