import { FormEvent, useEffect, useState } from 'react'
import { ApiError } from '../api/client'
import { Button, Icon, Logo, go } from '../ui'
import { useAuth } from './auth'

export function LoginPage() {
  const { user, loading, login } = useAuth()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (user) go('/admin/dashboard') }, [user])

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    const email = String(f.get('email') || '').trim(), password = String(f.get('password') || '')
    if (!email || !password) return setError('Renseignez votre email et votre mot de passe.')
    setBusy(true); setError('')
    try { await login(email, password) } catch (err) {
      const s = err instanceof ApiError ? err.status : 0
      setError(s === 401 ? 'Email ou mot de passe incorrect.' : s === 429 ? 'Trop de tentatives. Réessayez dans quelques minutes.' : s === 0 ? 'Serveur injoignable. Réessayez plus tard.' : 'Connexion impossible.')
    } finally { setBusy(false) }
  }
  if (loading) return <div className="login"><div className="login-form"><p role="status">Chargement…</p></div></div>
  return <div className="login"><div className="login-side"><Logo light/><div><span>ADMINISTRATION MALIREN</span><h1>Pilotez le réseau,<br/>informez la communauté.</h1><p>Une interface unifiée pour administrer les contenus et suivre l’activité du site.</p></div><small>Accès réservé aux équipes autorisées</small></div><div className="login-form"><form onSubmit={submit} noValidate><span className="kicker">ESPACE SÉCURISÉ</span><h2>Bienvenue</h2><p>Connectez-vous à l’espace d’administration.</p><label>Email<input name="email" type="email" autoComplete="username" required/></label><label>Mot de passe<input name="password" type="password" autoComplete="current-password" required/></label>{error && <p className="error" role="alert">{error}</p>}<Button type="submit">{busy ? 'Connexion…' : <>Se connecter <Icon name="arrow"/></>}</Button><small>Connexion chiffrée · sessions révocables · journal d’audit</small></form></div></div>
}
