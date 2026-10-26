/**
 * Minimal API client.
 * - The short-lived access token lives only in memory (never localStorage → not readable by injected scripts).
 * - The long-lived refresh token is an httpOnly cookie managed by the server; we just call /auth/refresh.
 */
export const API_BASE: string = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '/api/v1'

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: { path: string; message: string }[]) {
    super(message)
  }
}

let accessToken: string | null = null
let refreshInFlight: Promise<string | null> | null = null
export const setAccessToken = (t: string | null) => { accessToken = t }
export const getAccessToken = () => accessToken

const UNAUTHORIZED_EVENT = 'maliren:unauthorized'
export const onUnauthorized = (fn: () => void) => { addEventListener(UNAUTHORIZED_EVENT, fn); return () => removeEventListener(UNAUTHORIZED_EVENT, fn) }

async function parseError(res: Response): Promise<ApiError> {
  let body: { error?: { code?: string; message?: string; details?: { path: string; message: string }[] } } = {}
  try { body = await res.json() } catch { /* not JSON */ }
  return new ApiError(res.status, body.error?.code ?? 'error', body.error?.message ?? res.statusText ?? 'Request failed', body.error?.details)
}

/** Single-flight refresh so several parallel 401s trigger one rotation. */
export function refreshSession(): Promise<string | null> {
  refreshInFlight ??= (async () => {
    try {
      const res = await fetch(`${API_BASE}/auth/refresh`, { method: 'POST', credentials: 'include', headers: { 'X-Requested-With': 'maliren' } })
      if (!res.ok) { accessToken = null; return null }
      const data = await res.json()
      accessToken = data.accessToken
      return accessToken
    } catch {
      return null
    } finally {
      setTimeout(() => { refreshInFlight = null }, 0)
    }
  })()
  return refreshInFlight
}

export interface RequestOptions { method?: string; body?: unknown; query?: Record<string, string | number | boolean | undefined | null>; auth?: boolean; form?: FormData; signal?: AbortSignal; raw?: boolean }

function url(path: string, query?: RequestOptions['query']) {
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined && v !== null && v !== '') q.set(k, String(v))
  const s = q.toString()
  return `${API_BASE}${path}${s ? `?${s}` : ''}`
}

async function once(path: string, o: RequestOptions) {
  const headers: Record<string, string> = { 'X-Requested-With': 'maliren' }
  if (o.body !== undefined) headers['Content-Type'] = 'application/json'
  if (o.auth && accessToken) headers.Authorization = `Bearer ${accessToken}`
  return fetch(url(path, o.query), { method: o.method ?? (o.body !== undefined || o.form ? 'POST' : 'GET'), headers, credentials: 'include', signal: o.signal, body: o.form ?? (o.body !== undefined ? JSON.stringify(o.body) : undefined) })
}

export async function request(path: string, o: RequestOptions = {}): Promise<Response> {
  let res: Response
  try { res = await once(path, o) } catch (e) {
    if ((e as Error).name === 'AbortError') throw e
    throw new ApiError(0, 'network', 'Network error')
  }
  if (res.status === 401 && o.auth) {
    const t = await refreshSession()
    if (t) res = await once(path, o)
    if (res.status === 401) { accessToken = null; dispatchEvent(new Event(UNAUTHORIZED_EVENT)) }
  }
  if (!res.ok) throw await parseError(res)
  return res
}

export async function api<T = unknown>(path: string, o: RequestOptions = {}): Promise<T> {
  const res = await request(path, o)
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

/** Authenticated file download (CSV exports) via blob so the bearer token is never put in a URL. */
export async function download(path: string, fallbackName: string) {
  const res = await request(path, { auth: true })
  const blob = await res.blob()
  const cd = res.headers.get('Content-Disposition') ?? ''
  const name = /filename="([^"]+)"/.exec(cd)?.[1] ?? fallbackName
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 5000)
}

export const mediaUrl = (id: string) => `${API_BASE}/public/media/${id}`
