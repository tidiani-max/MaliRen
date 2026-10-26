import request from 'supertest'
import { afterAll, describe, expect, it } from 'vitest'
import { createApp } from '../src/app'
import { loadEnv } from '../src/config/env'
import { API, makeCtx } from './helpers'

const ctx = makeCtx()
const app = createApp(ctx)
afterAll(() => ctx.pool.end())

describe('platform', () => {
  it('health reports database status', async () => {
    const r = await request(app).get('/health')
    expect(r.body).toMatchObject({ status: 'ok', db: 'up' })
  })

  it('sends hardened headers and hides the framework', async () => {
    const r = await request(app).get('/health')
    expect(r.headers['x-powered-by']).toBeUndefined()
    expect(r.headers['x-content-type-options']).toBe('nosniff')
    expect(r.headers['strict-transport-security']).toBeTruthy()
    expect(r.headers['content-security-policy']).toContain("default-src 'none'")
  })

  it('CORS allows only configured origins', async () => {
    const ok = await request(app).get(`${API}/public/site`).set('Origin', 'http://localhost:5173')
    expect(ok.headers['access-control-allow-origin']).toBe('http://localhost:5173')
    expect(ok.headers['access-control-allow-credentials']).toBe('true')
    const bad = await request(app).get(`${API}/public/site`).set('Origin', 'https://evil.example')
    expect(bad.headers['access-control-allow-origin']).toBeUndefined()
  })

  it('returns JSON errors for unknown routes and never leaks internals', async () => {
    const r = await request(app).get(`${API}/nope`)
    expect(r.status).toBe(404)
    expect(r.body.error.code).toBe('not_found')
    const big = await request(app).post(`${API}/public/contact`).send({ message: 'x'.repeat(200_000) })
    expect(big.status).toBe(413)
  })

  it('publishes an OpenAPI document covering public and admin routes', async () => {
    const r = await request(app).get(`${API}/openapi.json`)
    expect(r.body.openapi).toMatch(/^3\./)
    expect(Object.keys(r.body.paths)).toEqual(expect.arrayContaining(['/auth/login', '/public/contact', '/admin/news/{id}/status', '/admin/submissions/{id}/notes', '/admin/automation/{name}/run']))
    expect(r.body.paths['/public/contact'].post.requestBody.content['application/json'].schema.properties.email).toBeTruthy()
    expect((await request(app).get('/docs/')).status).toBe(200)
  })

  it('refuses unsafe production configuration', () => {
    expect(() => loadEnv({ NODE_ENV: 'production' })).toThrow(/JWT_SECRET/)
    expect(() => loadEnv({ NODE_ENV: 'production', JWT_SECRET: 'x'.repeat(40), COOKIE_SAMESITE: 'none', COOKIE_SECURE: 'false' })).toThrow(/SECURE/)
    expect(() => loadEnv({ JWT_SECRET: 'short' })).toThrow(/at least 32/)
    expect(loadEnv({ NODE_ENV: 'production', JWT_SECRET: 'x'.repeat(40) }).cookieSecure).toBe(true)
  })
})
