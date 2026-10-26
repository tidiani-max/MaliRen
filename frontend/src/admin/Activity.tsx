import { useEffect, useState } from 'react'
import { api } from '../api/client'
import { useAsync } from '../api/hooks'
import type { AuditEntry, EmailLogItem, JobItem, Paged } from '../api/types'
import { useAuth } from './auth'
import { Chips, EmptyState, ErrorBox, Loading, Modal, Pagination, StatusBadge, errMsg, fmtDateTime, useDebounced, useToast } from './kit'

type Tab = 'audit' | 'jobs' | 'emails'

export function Activity({ query }: { query: string }) {
  const { can } = useAuth()
  const [tab, setTab] = useState<Tab>(can('audit:read') ? 'audit' : 'jobs')
  const tabs: [Tab, string][] = [...(can('audit:read') ? [['audit', 'Journal d’audit'] as [Tab, string]] : []), ...(can('automation:read') ? [['jobs', 'Tâches automatiques'] as [Tab, string], ['emails', 'E-mails'] as [Tab, string]] : [])]
  return <><div className="filters"><Chips value={tab} onChange={setTab} options={tabs}/></div>{tab === 'audit' ? <Audit query={query}/> : tab === 'jobs' ? <Jobs/> : <Emails/>}</>
}

function Audit({ query }: { query: string }) {
  const [page, setPage] = useState(1)
  const [entity, setEntity] = useState('')
  const [action, setAction] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const q = useDebounced(query, 300)
  const act = useDebounced(action, 300)
  useEffect(() => setPage(1), [q, entity, act, from, to])
  const res = useAsync(() => api<Paged<AuditEntry>>('/admin/activity/audit', { auth: true, query: { page, pageSize: 25, q, entity, action: act, from: from ? new Date(from).toISOString() : undefined, to: to ? new Date(to + 'T23:59:59').toISOString() : undefined } }), [page, q, entity, act, from, to])
  const [detail, setDetail] = useState<AuditEntry | null>(null)
  return <article className="admin-panel"><div className="panel-title"><div><h2>Journal d’audit</h2><p>Qui a fait quoi, et quand. Conservé côté serveur, non modifiable depuis l’interface.</p></div></div>
    <div className="inline-filters"><select value={entity} onChange={(e) => setEntity(e.target.value)} aria-label="Entité"><option value="">Toutes entités</option>{['news', 'events', 'publications', 'pages', 'institutions', 'submission', 'media', 'user', 'settings', 'automation', 'report', 'job'].map((e) => <option key={e}>{e}</option>)}</select><input placeholder="Action (ex. status, login)" value={action} onChange={(e) => setAction(e.target.value)}/><label>Du <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}/></label><label>au <input type="date" value={to} onChange={(e) => setTo(e.target.value)}/></label></div>
    {res.loading && !res.data ? <Loading/> : res.error && !res.data ? <ErrorBox message={res.error} onRetry={res.reload}/> : !res.data?.items.length ? <EmptyState icon="search" title="Aucune entrée"/> : <div className="table-wrap"><table><thead><tr><th>Date</th><th>Acteur</th><th>Action</th><th>Résumé</th></tr></thead><tbody>{res.data.items.map((a) => <tr key={a.id} className="clickable" onClick={() => setDetail(a)}><td>{fmtDateTime(a.createdAt)}</td><td>{a.actorLabel}</td><td><code>{a.action}</code><small>{a.entity}</small></td><td>{a.summary}</td></tr>)}</tbody></table></div>}
    {res.data && <Pagination page={page} pageSize={res.data.pageSize} total={res.data.total} onPage={setPage}/>}
    {detail && <Modal wide title="Détail de l’entrée" onClose={() => setDetail(null)}><p><b>{detail.actorLabel}</b> · {fmtDateTime(detail.createdAt)} · IP {detail.ip ?? ''}</p><p>{detail.summary}</p><pre className="json">{JSON.stringify(detail.meta ?? {}, null, 2)}</pre></Modal>}
  </article>
}

function Jobs() {
  const { can } = useAuth()
  const toast = useToast()
  const [page, setPage] = useState(1)
  const [status, setStatus] = useState('')
  const [detail, setDetail] = useState<JobItem | null>(null)
  const res = useAsync(() => api<Paged<JobItem>>('/admin/activity/jobs', { auth: true, query: { page, pageSize: 20, status } }), [page, status])
  async function retry(j: JobItem) { try { await api(`/admin/automation/jobs/${j.id}/retry`, { method: 'POST', auth: true }); toast('Tâche remise en file'); res.reload() } catch (e) { toast(errMsg(e), 'error') } }
  return <article className="admin-panel"><div className="panel-title"><div><h2>Tâches automatiques</h2><p>Notifications, rappels, publications programmées, nettoyage. Les échecs sont relancés avec un délai croissant.</p></div><button className="btn outline small" onClick={res.reload}>Actualiser</button></div>
    <div className="inline-filters"><select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1) }} aria-label="Statut"><option value="">Tous statuts</option>{['queued', 'running', 'succeeded', 'failed', 'dead'].map((s) => <option key={s} value={s}>{s}</option>)}</select></div>
    {res.loading && !res.data ? <Loading/> : res.error && !res.data ? <ErrorBox message={res.error} onRetry={res.reload}/> : !res.data?.items.length ? <EmptyState icon="clock" title="Aucune tâche"/> : <div className="table-wrap"><table><thead><tr><th>Type</th><th>Statut</th><th>Essais</th><th>Prévue</th><th>Terminée</th><th></th></tr></thead><tbody>{res.data.items.map((j) => <tr key={j.id}><td><code>{j.type}</code>{j.lastError && <small className="err">{j.lastError}</small>}</td><td><StatusBadge status={j.status}/></td><td>{j.attempts}/{j.maxAttempts}</td><td>{fmtDateTime(j.runAt)}</td><td>{fmtDateTime(j.finishedAt)}</td><td className="row-actions"><button className="btn outline small" onClick={() => setDetail(j)}>Détail</button>{can('automation:manage') && (j.status === 'dead' || j.status === 'failed') && <button className="btn outline small" onClick={() => retry(j)}>Relancer</button>}</td></tr>)}</tbody></table></div>}
    {res.data && <Pagination page={page} pageSize={res.data.pageSize} total={res.data.total} onPage={setPage}/>}
    {detail && <Modal wide title={detail.type} onClose={() => setDetail(null)}><p><StatusBadge status={detail.status}/> · {detail.attempts}/{detail.maxAttempts} essais</p>{detail.lastError && <p className="error">{detail.lastError}</p>}<pre className="json">{JSON.stringify(detail.result ?? {}, null, 2)}</pre></Modal>}
  </article>
}

function Emails() {
  const [page, setPage] = useState(1)
  const res = useAsync(() => api<Paged<EmailLogItem> & { mailMode: string }>('/admin/activity/emails', { auth: true, query: { page, pageSize: 20 } }), [page])
  return <article className="admin-panel"><div className="panel-title"><div><h2>E-mails sortants</h2><p>{res.data?.mailMode === 'log' ? 'Mode développement : les e-mails sont journalisés ici et NON envoyés (MAIL_MODE=log).' : 'Envoi via SMTP.'}</p></div><button className="btn outline small" onClick={res.reload}>Actualiser</button></div>
    {res.loading && !res.data ? <Loading/> : res.error && !res.data ? <ErrorBox message={res.error} onRetry={res.reload}/> : !res.data?.items.length ? <EmptyState icon="mail" title="Aucun e-mail"/> : <div className="table-wrap"><table><thead><tr><th>Destinataire</th><th>Objet</th><th>Statut</th><th>Date</th></tr></thead><tbody>{res.data.items.map((m) => <tr key={m.id}><td>{m.toAddress}</td><td>{m.subject}{m.error && <small className="err">{m.error}</small>}</td><td><StatusBadge status={m.status}/></td><td>{fmtDateTime(m.createdAt)}</td></tr>)}</tbody></table></div>}
    {res.data && <Pagination page={page} pageSize={res.data.pageSize} total={res.data.total} onPage={setPage}/>}</article>
}
