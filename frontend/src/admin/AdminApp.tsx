import './admin.css'
import { FormEvent, useEffect, useRef, useState } from 'react'
import { api } from '../api/client'
import { useAsync } from '../api/hooks'
import type { NotificationItem } from '../api/types'
import { Button, Icon, Logo, go } from '../ui'
import { Activity } from './Activity'
import { useAuth } from './auth'
import { ContentManager } from './ContentManager'
import { Dashboard } from './Dashboard'
import { Field, Modal, ToastProvider, errMsg, fmtDateTime, useToast } from './kit'
import { Media } from './Media'
import { MODULES } from './modules'
import { Perm, ROLE_LABEL } from './permissions'
import { Reports } from './Reports'
import { Settings } from './Settings'
import { Submissions } from './Submissions'
import { Users } from './Users'

const NAV: { key: string; label: string; icon: string; perm: Perm }[] = [
  { key: 'dashboard', label: 'Tableau de bord', icon: 'chart', perm: 'content:read' }, { key: 'content', label: 'Contenus', icon: 'file', perm: 'content:read' },
  { key: 'news', label: 'Actualités', icon: 'file', perm: 'content:read' }, { key: 'events', label: 'Événements', icon: 'calendar', perm: 'content:read' },
  { key: 'publications', label: 'Publications', icon: 'file', perm: 'content:read' }, { key: 'institutions', label: 'Institutions', icon: 'globe', perm: 'content:read' },
  { key: 'submissions', label: 'Demandes', icon: 'mail', perm: 'submissions:read' }, { key: 'media', label: 'Médiathèque', icon: 'image', perm: 'media:read' },
  { key: 'users', label: 'Utilisateurs', icon: 'users', perm: 'users:read' }, { key: 'reports', label: 'Rapports', icon: 'chart', perm: 'reports:read' },
  { key: 'activity', label: 'Activité', icon: 'clock', perm: 'audit:read' }, { key: 'settings', label: 'Paramètres', icon: 'settings', perm: 'settings:read' },
]

export function AdminApp() {
  return <ToastProvider><Shell/></ToastProvider>
}

function Shell() {
  const { user, loading, logout, can } = useAuth()
  const [moduleKey, setModuleKey] = useState(location.pathname.split('/')[2] || 'dashboard')
  const [mobile, setMobile] = useState(false)
  const [query, setQuery] = useState('')
  const [account, setAccount] = useState(false)
  useEffect(() => { if (!loading && !user) go('/admin/login') }, [loading, user])
  useEffect(() => { const f = () => { setModuleKey(location.pathname.split('/')[2] || 'dashboard'); setQuery('') }; addEventListener('popstate', f); return () => removeEventListener('popstate', f) }, [])
  const newCount = useAsync(() => (user && can('submissions:read') ? api<{ total: number }>('/admin/submissions', { auth: true, query: { status: 'new', pageSize: 1 } }) : Promise.resolve({ total: 0 })), [user?.id])
  useEffect(() => { const f = () => newCount.reload(); addEventListener('maliren:submissions-changed', f); return () => removeEventListener('maliren:submissions-changed', f) }, [newCount.reload])

  if (loading || !user) return <div className="login"><div className="login-form"><p role="status">Chargement…</p></div></div>
  if (user.mustChangePassword) return <ForcedPasswordChange/>
  const nav = NAV.filter((n) => can(n.perm))
  const current = nav.find((n) => n.key === moduleKey) ?? nav[0]
  const select = (k: string) => { setModuleKey(k); setQuery(''); history.pushState({}, '', `/admin/${k}`); setMobile(false) }
  const initials = user.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase()
  const hasSearch = !['dashboard', 'reports', 'settings'].includes(current.key)

  let body
  switch (current.key) {
    case 'dashboard': body = <Dashboard/>; break
    case 'submissions': body = <Submissions query={query}/>; break
    case 'media': body = <Media query={query}/>; break
    case 'users': body = <Users query={query}/>; break
    case 'reports': body = <Reports/>; break
    case 'activity': body = <Activity query={query}/>; break
    case 'settings': body = <Settings/>; break
    default: body = <ContentManager key={current.key} cfg={MODULES[current.key]} query={query}/>
  }
  return <div className="admin"><aside className={mobile ? 'open' : ''}><Logo light/><button className="aside-close" onClick={() => setMobile(false)} aria-label="Fermer le menu"><Icon name="close"/></button><p>ESPACE ADMINISTRATION</p>
    {nav.map((n) => <button key={n.key} className={current.key === n.key ? 'active' : ''} onClick={() => select(n.key)}><Icon name={n.icon}/>{n.label}{n.key === 'submissions' && (newCount.data?.total ?? 0) > 0 && <i>{newCount.data!.total}</i>}</button>)}
    <div className="admin-user" onClick={() => setAccount(true)} role="button" tabIndex={0} title="Mon compte" onKeyDown={(e) => e.key === 'Enter' && setAccount(true)}><span>{initials}</span><div><b>{user.name}</b><small>{ROLE_LABEL[user.role]}</small></div></div>
    <button className="signout" onClick={async () => { await logout(); go('/admin/login') }}><Icon name="logout"/> Se déconnecter</button></aside>
    <main className="admin-main"><header><button className="admin-menu" onClick={() => setMobile(true)} aria-label="Ouvrir le menu"><Icon name="menu"/></button>
      {hasSearch ? <label><Icon name="search"/><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Rechercher…" aria-label="Rechercher dans ce module"/></label> : <span style={{ flex: 1 }}/>}
      <Bell/><button onClick={() => go('/')}>Voir le site <Icon name="arrow"/></button></header>
      <div className="admin-content"><div className="admin-title"><div><p>Administration / {current.label}</p><h1>{current.label}</h1></div>{user.role === 'reviewer' && <span className="status archive">Lecture seule</span>}</div>{body}</div></main>
    {account && <AccountModal onClose={() => setAccount(false)}/>}</div>
}

function Bell() {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const res = useAsync(() => api<{ items: NotificationItem[]; unread: number }>('/admin/notifications', { auth: true }), [])
  useEffect(() => { const t = setInterval(res.reload, 60_000); return () => clearInterval(t) }, [res.reload])
  useEffect(() => { const f = (e: MouseEvent) => { if (open && !ref.current?.contains(e.target as Node)) setOpen(false) }; addEventListener('mousedown', f); return () => removeEventListener('mousedown', f) }, [open])
  const unread = res.data?.unread ?? 0
  async function read(n: NotificationItem) { if (!n.readAt) await api(`/admin/notifications/${n.id}/read`, { method: 'POST', auth: true }).catch(() => undefined); setOpen(false); res.reload(); if (n.link) go(n.link) }
  async function readAll() { await api('/admin/notifications/read-all', { method: 'POST', auth: true }).catch(() => undefined); res.reload() }
  return <div className="bell" ref={ref}><button className="icon-btn" aria-label={`Notifications (${unread} non lues)`} onClick={() => { setOpen(!open); if (!open) res.reload() }}><Icon name="bell"/>{unread > 0 && <i>{unread > 9 ? '9+' : unread}</i>}</button>
    {open && <div className="bell-pop"><div className="bell-head"><b>Notifications</b>{unread > 0 && <button onClick={readAll}>Tout marquer comme lu</button>}</div>
      {!res.data?.items.length ? <p className="muted pad">Aucune notification.</p> : res.data.items.map((n) => <button key={n.id} className={`bell-item ${n.readAt ? '' : 'unread'}`} onClick={() => read(n)}><b>{n.title}</b>{n.body && <span>{n.body}</span>}<small>{fmtDateTime(n.createdAt)}</small></button>)}</div>}</div>
}

function PasswordForm({ onDone, forced }: { onDone: () => void; forced?: boolean }) {
  const toast = useToast(); const { refreshUser } = useAuth()
  const [busy, setBusy] = useState(false); const [error, setError] = useState('')
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    const currentPassword = String(f.get('current')), newPassword = String(f.get('next')), confirm = String(f.get('confirm'))
    if (newPassword.length < 10) return setError('Le nouveau mot de passe doit contenir au moins 10 caractères.')
    if (newPassword !== confirm) return setError('La confirmation ne correspond pas.')
    setBusy(true); setError('')
    try { await api('/auth/change-password', { method: 'POST', auth: true, body: { currentPassword, newPassword } }); toast('Mot de passe modifié'); await refreshUser(); onDone() } catch (err) { setError(errMsg(err)) } finally { setBusy(false) }
  }
  return <form id="pw-form" className="form-grid" onSubmit={submit}>{forced && <p className="hint full">Votre mot de passe est temporaire : choisissez-en un nouveau pour continuer.</p>}
    <Field label="Mot de passe actuel" full><input name="current" type="password" autoComplete="current-password" required/></Field><Field label="Nouveau mot de passe (10 caractères minimum)" full><input name="next" type="password" autoComplete="new-password" minLength={10} required/></Field><Field label="Confirmation" full><input name="confirm" type="password" autoComplete="new-password" required/></Field>
    {error && <p className="error full" role="alert">{error}</p>}<div className="full"><Button type="submit">{busy ? 'Enregistrement…' : 'Changer le mot de passe'}</Button></div></form>
}
function AccountModal({ onClose }: { onClose: () => void }) { const { user } = useAuth(); return <Modal title="Mon compte" onClose={onClose}><p><b>{user!.name}</b> · {user!.email} · {ROLE_LABEL[user!.role]}</p><h4>Changer mon mot de passe</h4><PasswordForm onDone={onClose}/></Modal> }
function ForcedPasswordChange() {
  const { logout } = useAuth()
  return <ToastProvider><div className="login"><div className="login-form"><div style={{ width: 'min(420px,100%)' }}><span className="kicker">SÉCURITÉ</span><h2>Nouveau mot de passe</h2><PasswordForm forced onDone={() => undefined}/><p><button className="btn outline small" onClick={async () => { await logout(); go('/admin/login') }}>Se déconnecter</button></p></div></div></div></ToastProvider>
}

