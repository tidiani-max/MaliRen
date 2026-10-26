import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { api, onUnauthorized, refreshSession, setAccessToken } from '../api/client'
import type { User } from '../api/types'
import { can as canRole, Perm } from './permissions'

interface AuthState { user: User | null; loading: boolean; login: (email: string, password: string) => Promise<void>; logout: () => Promise<void>; can: (p: Perm) => boolean; refreshUser: () => Promise<void> }
const Ctx = createContext<AuthState>(null as never)
export const useAuth = () => useContext(Ctx)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  // Restore the session from the httpOnly refresh cookie (the access token is memory-only).
  useEffect(() => {
    let alive = true
    ;(async () => {
      const t = await refreshSession()
      if (t) { try { const me = await api<User>('/auth/me', { auth: true }); if (alive) setUser(me) } catch { /* not signed in */ } }
      if (alive) setLoading(false)
    })()
    return () => { alive = false }
  }, [])

  useEffect(() => onUnauthorized(() => setUser(null)), [])

  const login = useCallback(async (email: string, password: string) => {
    const r = await api<{ accessToken: string; user: User }>('/auth/login', { method: 'POST', body: { email, password } })
    setAccessToken(r.accessToken)
    setUser(r.user)
  }, [])
  const logout = useCallback(async () => {
    try { await api('/auth/logout', { method: 'POST', body: undefined, auth: false, query: undefined }) } catch { /* ignore */ }
    setAccessToken(null); setUser(null)
  }, [])
  const refreshUser = useCallback(async () => { setUser(await api<User>('/auth/me', { auth: true })) }, [])
  const value = useMemo<AuthState>(() => ({ user, loading, login, logout, can: (p) => canRole(user?.role, p), refreshUser }), [user, loading, login, logout, refreshUser])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
