import { useEffect, useState } from 'react'
import { api, download } from '../api/client'
import { useAsync } from '../api/hooks'
import type { Paged, Submission, SubmissionNote, SubmissionStatus } from '../api/types'
import { Button, Icon } from '../ui'
import { useAuth } from './auth'
import { Chips, EmptyState, ErrorBox, Field, Loading, Modal, Pagination, StatusBadge, errMsg, fmtDateTime, fromLocalInput, toLocalInput, useConfirm, useDebounced, useToast } from './kit'

type Detail = Submission & { notes: SubmissionNote[] }
const FILTERS: [string, string][] = [['', 'Toutes'], ['new', 'Nouvelles'], ['in_progress', 'En cours'], ['handled', 'Traitées'], ['spam', 'Indésirables']]

export function Submissions({ query }: { query: string }) {
  const { can, user } = useAuth()
  const toast = useToast()
  const [page, setPage] = useState(1)
  const [status, setStatus] = useState('')
  const [assignee, setAssignee] = useState('')
  const [sort, setSort] = useState('newest')
  const [open, setOpen] = useState<string | null>(null)
  const q = useDebounced(query, 300)
  useEffect(() => setPage(1), [q, status, assignee, sort])
  const res = useAsync(() => api<Paged<Submission>>('/admin/submissions', { auth: true, query: { page, pageSize: 15, q, status, assignee, sort } }), [page, q, status, assignee, sort])
  const staff = useAsync(() => api<{ items: { id: string; name: string }[] }>('/admin/submissions/staff', { auth: true }), [])
  const changed = () => { res.reload(); dispatchEvent(new Event('maliren:submissions-changed')) }

  return <>
    <div className="filters"><Chips value={status} onChange={setStatus} options={FILTERS}/>
      <select value={assignee} onChange={(e) => setAssignee(e.target.value)} aria-label="Assignation"><option value="">Toutes assignations</option><option value="me">Mes demandes</option><option value="none">Non assignées</option>{staff.data?.items.filter((s) => s.id !== user?.id).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
      <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Tri"><option value="newest">Plus récentes</option><option value="oldest">Plus anciennes</option></select></div>
    <article className="admin-panel"><div className="panel-title"><div><h2>Demandes et messages</h2><p>{res.data ? `${res.data.total} enregistrement(s)` : ' '}</p></div>
      <Button kind="outline" onClick={() => download('/admin/reports/export/submissions', 'demandes-maliren.csv').catch((e) => toast(errMsg(e), 'error'))}><Icon name="download" size={16}/> Exporter CSV</Button></div>
      {res.loading && !res.data ? <Loading/> : res.error && !res.data ? <ErrorBox message={res.error} onRetry={res.reload}/> : !res.data?.items.length
        ? <EmptyState icon="mail" title="Aucune demande trouvée">{q || status || assignee ? 'Modifiez vos filtres.' : 'Les messages envoyés via le formulaire de contact public apparaîtront ici.'}</EmptyState>
        : <div className="table-wrap"><table><thead><tr><th>Contact</th><th>Objet</th><th>Date</th><th>Assignée à</th><th>Statut</th></tr></thead><tbody>
          {res.data.items.map((x) => <tr key={x.id} className="clickable" onClick={() => setOpen(x.id)}><td><b>{x.name}</b><small>{x.email}</small></td><td>{x.subject}<small>{x.message.slice(0, 70)}{x.message.length > 70 ? '…' : ''}</small></td><td>{fmtDateTime(x.createdAt)}</td><td>{x.assigneeName ?? ''}{x.followUpAt && <small>Suivi : {fmtDateTime(x.followUpAt)}</small>}</td><td><StatusBadge status={x.status}/></td></tr>)}
        </tbody></table></div>}
      {res.data && <Pagination page={page} pageSize={res.data.pageSize} total={res.data.total} onPage={setPage}/>}
    </article>
    {open && <SubmissionModal id={open} canWrite={can('submissions:write')} canDelete={can('submissions:delete')} onClose={() => setOpen(null)} onChanged={changed}/>}
  </>
}

function SubmissionModal({ id, canWrite, canDelete, onClose, onChanged }: { id: string; canWrite: boolean; canDelete: boolean; onClose: () => void; onChanged: () => void }) {
  const toast = useToast()
  const { confirm, node } = useConfirm()
  const res = useAsync(() => api<Detail>(`/admin/submissions/${id}`, { auth: true }), [id])
  const staff = useAsync(() => api<{ items: { id: string; name: string }[] }>('/admin/submissions/staff', { auth: true }), [])
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const d = res.data

  async function patch(body: Record<string, unknown>) {
    try { await api(`/admin/submissions/${id}`, { method: 'PATCH', auth: true, body }); res.reload(); onChanged() } catch (e) { toast(errMsg(e), 'error') }
  }
  async function addNote() {
    if (!note.trim()) return
    setBusy(true)
    try { await api(`/admin/submissions/${id}/notes`, { method: 'POST', auth: true, body: { body: note } }); setNote(''); res.reload() } catch (e) { toast(errMsg(e), 'error') } finally { setBusy(false) }
  }
  async function remove() {
    if (!(await confirm('Supprimer définitivement cette demande et ses notes ?', 'Supprimer'))) return
    try { await api(`/admin/submissions/${id}`, { method: 'DELETE', auth: true }); toast('Demande supprimée'); onChanged(); onClose() } catch (e) { toast(errMsg(e), 'error') }
  }
  return <Modal wide title={d ? `Demande  ${d.name}` : 'Demande'} onClose={onClose} footer={canDelete && d ? <button className="btn outline small danger-text" onClick={remove}><Icon name="trash" size={15}/> Supprimer</button> : undefined}>
    {!d ? <Loading/> : <div className="split">
      <div><p className="meta"><b>{d.name}</b> · <a href={`mailto:${d.email}`}>{d.email}</a> · {fmtDateTime(d.createdAt)} · {d.locale.toUpperCase()}</p><h3>{d.subject}</h3><div className="message-box">{d.message}</div>
        <h4>Notes internes</h4>{d.notes.length ? d.notes.map((n) => <div className="note" key={n.id}><b>{n.authorName}</b> <small>{fmtDateTime(n.createdAt)}</small><p>{n.body}</p></div>) : <p className="muted">Aucune note.</p>}
        {canWrite && <div className="note-form"><textarea rows={2} maxLength={3000} placeholder="Ajouter une note interne (non visible du demandeur)…" value={note} onChange={(e) => setNote(e.target.value)}/><button className="btn primary small" disabled={busy || !note.trim()} onClick={addNote}>Ajouter</button></div>}</div>
      <div className="side-form">
        <Field label="Statut"><select value={d.status} disabled={!canWrite} onChange={(e) => patch({ status: e.target.value as SubmissionStatus })}>{([['new', 'Nouvelle'], ['in_progress', 'En cours'], ['handled', 'Traitée'], ['spam', 'Indésirable']] as const).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
        <Field label="Assignée à"><select value={d.assignedTo ?? ''} disabled={!canWrite} onChange={(e) => patch({ assignedTo: e.target.value || null })}><option value=""> Non assignée </option>{staff.data?.items.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
        <Field label="Date de suivi" hint="Un rappel est envoyé si la demande reste en cours après cette date."><input type="datetime-local" disabled={!canWrite} defaultValue={toLocalInput(d.followUpAt)} onBlur={(e) => { if (e.target.value !== toLocalInput(d.followUpAt)) patch({ followUpAt: fromLocalInput(e.target.value) }) }}/></Field>
        <p className="muted">Statut actuel : <StatusBadge status={d.status}/></p>{d.handledAt && <p className="muted">Traitée le {fmtDateTime(d.handledAt)}</p>}{d.reminderCount > 0 && <p className="muted">{d.reminderCount} rappel(s) envoyé(s)</p>}
      </div></div>}
    {node}</Modal>
}
