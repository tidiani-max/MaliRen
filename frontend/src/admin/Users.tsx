import { useState } from 'react'
import { api } from '../api/client'
import { useAsync } from '../api/hooks'
import type { Paged, Role, User } from '../api/types'
import { useAuth } from './auth'
import { CopyButton, EmptyState, ErrorBox, Field, Loading, Modal, StatusBadge, errMsg, fmtDateTime, useConfirm, useToast } from './kit'
import { ROLE_LABEL, ROLE_RANK } from './permissions'

export function Users({ query }: { query: string }) {
  const { user: me, can } = useAuth()
  const toast = useToast()
  const { confirm, node } = useConfirm()
  const [edit, setEdit] = useState<User | 'new' | null>(null)
  const [secret, setSecret] = useState<{ email: string; password: string } | null>(null)
  const res = useAsync(() => api<Paged<User>>('/admin/users', { auth: true, query: { pageSize: 100, q: query } }), [query])
  const myRank = ROLE_RANK[me!.role]
  const canManage = (u: User) => can('users:write') && (me!.role === 'super_admin' || ROLE_RANK[u.role] < myRank)

  async function reset(u: User) {
    if (!(await confirm(`Générer un nouveau mot de passe temporaire pour ${u.email} ? Ses sessions actives seront fermées.`, 'Réinitialiser'))) return
    try { const r = await api<{ temporaryPassword: string }>(`/admin/users/${u.id}/reset-password`, { method: 'POST', auth: true }); setSecret({ email: u.email, password: r.temporaryPassword }) } catch (e) { toast(errMsg(e), 'error') }
  }
  async function toggle(u: User) {
    try { await api(`/admin/users/${u.id}`, { method: 'PATCH', auth: true, body: { active: !u.active } }); toast(u.active ? 'Compte désactivé' : 'Compte réactivé'); res.reload() } catch (e) { toast(errMsg(e), 'error') }
  }
  async function remove(u: User) {
    if (!(await confirm(`Supprimer définitivement le compte de ${u.email} ?`, 'Supprimer'))) return
    try { await api(`/admin/users/${u.id}`, { method: 'DELETE', auth: true }); toast('Compte supprimé'); res.reload() } catch (e) { toast(errMsg(e), 'error') }
  }
  return <>
    <article className="admin-panel"><div className="panel-title"><div><h2>Utilisateurs</h2><p>{res.data ? `${res.data.total} compte(s)` : ' '} · rôles : super administrateur, administrateur, éditeur, lecture seule</p></div>{can('users:write') && <button className="btn primary small" onClick={() => setEdit('new')}>Inviter un utilisateur</button>}</div>
      {res.loading && !res.data ? <Loading/> : res.error && !res.data ? <ErrorBox message={res.error} onRetry={res.reload}/> : !res.data?.items.length ? <EmptyState icon="users" title="Aucun utilisateur"/>
        : <div className="table-wrap"><table><thead><tr><th>Utilisateur</th><th>Rôle</th><th>Statut</th><th>Dernière connexion</th><th></th></tr></thead><tbody>{res.data.items.map((u) => <tr key={u.id}>
          <td><b>{u.name}</b>{u.id === me!.id && ' (vous)'}<small>{u.email}</small></td><td>{ROLE_LABEL[u.role]}</td><td><StatusBadge status={u.active ? 'active' : 'inactive'}/>{u.mustChangePassword && <small>Doit changer son mot de passe</small>}</td><td>{fmtDateTime(u.lastLoginAt)}</td>
          <td className="row-actions">{canManage(u) && u.id !== me!.id && <><button className="btn outline small" onClick={() => setEdit(u)}>Modifier</button><button className="btn outline small" onClick={() => reset(u)}>Mot de passe</button><button className="btn outline small" onClick={() => toggle(u)}>{u.active ? 'Désactiver' : 'Réactiver'}</button><button className="btn outline small danger-text" onClick={() => remove(u)}>Supprimer</button></>}</td></tr>)}</tbody></table></div>}
    </article>
    {edit && <UserModal item={edit === 'new' ? null : edit} onClose={() => setEdit(null)} onSaved={(pw, email) => { setEdit(null); res.reload(); if (pw) setSecret({ email, password: pw }) }}/>}
    {secret && <Modal title="Mot de passe temporaire" onClose={() => setSecret(null)} footer={<button className="btn primary small" onClick={() => setSecret(null)}>J’ai noté le mot de passe</button>}>
      <p>Transmettez ce mot de passe à <b>{secret.email}</b> par un canal sûr. <b>Il ne sera plus affiché.</b> L’utilisateur devra le changer à sa première connexion.</p><div className="secret"><code>{secret.password}</code><CopyButton text={secret.password}/></div></Modal>}
    {node}</>
}

function UserModal({ item, onClose, onSaved }: { item: User | null; onClose: () => void; onSaved: (tempPassword: string | null, email: string) => void }) {
  const { user: me } = useAuth()
  const toast = useToast()
  const [v, setV] = useState({ email: item?.email ?? '', name: item?.name ?? '', role: (item?.role ?? 'editor') as Role })
  const [busy, setBusy] = useState(false)
  const roles = (Object.keys(ROLE_RANK) as Role[]).filter((r) => me!.role === 'super_admin' || ROLE_RANK[r] < ROLE_RANK[me!.role])
  async function save() {
    setBusy(true)
    try {
      if (item) { await api(`/admin/users/${item.id}`, { method: 'PATCH', auth: true, body: { name: v.name, role: v.role } }); toast('Utilisateur modifié'); onSaved(null, item.email) }
      else { const r = await api<{ temporaryPassword: string }>('/admin/users', { method: 'POST', auth: true, body: v }); onSaved(r.temporaryPassword, v.email) }
    } catch (e) { toast(errMsg(e), 'error') } finally { setBusy(false) }
  }
  return <Modal title={item ? 'Modifier l’utilisateur' : 'Inviter un utilisateur'} onClose={onClose} footer={<><button className="btn outline small" onClick={onClose}>Annuler</button><button className="btn primary small" disabled={busy || !v.name.trim() || !v.email.trim()} onClick={save}>{item ? 'Enregistrer' : 'Créer le compte'}</button></>}>
    <div className="form-grid"><Field label="Nom complet *" full><input value={v.name} maxLength={120} onChange={(e) => setV({ ...v, name: e.target.value })}/></Field><Field label="Email *" full><input type="email" value={v.email} disabled={!!item} maxLength={254} onChange={(e) => setV({ ...v, email: e.target.value })}/></Field>
      <Field label="Rôle" full hint="Éditeur : crée et publie des contenus · Lecture seule : consulte sans modifier · Administrateur : gère aussi utilisateurs et paramètres."><select value={v.role} onChange={(e) => setV({ ...v, role: e.target.value as Role })}>{roles.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select></Field></div>
    {!item && <p className="hint">Un mot de passe temporaire sera généré et affiché une seule fois.</p>}</Modal>
}
