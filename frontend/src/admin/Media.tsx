import { ChangeEvent, useRef, useState } from 'react'
import { api, mediaUrl, request } from '../api/client'
import { useAsync } from '../api/hooks'
import type { MediaItem, Paged } from '../api/types'
import { Icon } from '../ui'
import { useAuth } from './auth'
import { CopyButton, EmptyState, ErrorBox, Field, Loading, Modal, Pagination, errMsg, fmtBytes, fmtDate, useConfirm, useToast } from './kit'

export function Media({ query }: { query: string }) {
  const { can } = useAuth()
  const toast = useToast()
  const { confirm, node } = useConfirm()
  const [page, setPage] = useState(1)
  const [type, setType] = useState('')
  const [temp, setTemp] = useState(false)
  const [busy, setBusy] = useState(false)
  const [edit, setEdit] = useState<MediaItem | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const res = useAsync(() => api<Paged<MediaItem>>('/admin/media', { auth: true, query: { page, pageSize: 24, q: query, type } }), [page, query, type])

  async function onFiles(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    e.target.value = ''
    if (!files.length) return
    setBusy(true)
    let ok = 0
    for (const f of files) {
      const form = new FormData(); form.append('file', f); if (temp) form.append('temporary', 'true')
      try { await request('/admin/media', { method: 'POST', auth: true, form }); ok++ } catch (err) { toast(`${f.name} : ${errMsg(err)}`, 'error') }
    }
    setBusy(false)
    if (ok) { toast(`${ok} fichier(s) téléversé(s)`); res.reload() }
  }
  async function remove(m: MediaItem) {
    if (!(await confirm(`Supprimer « ${m.originalName} » ? Les contenus qui l’utilisent perdront ce fichier.`, 'Supprimer'))) return
    try { await api(`/admin/media/${m.id}`, { method: 'DELETE', auth: true }); toast('Fichier supprimé'); res.reload() } catch (e) { toast(errMsg(e), 'error') }
  }
  return <>
    <div className="filters">{[['', 'Tous'], ['image', 'Images'], ['document', 'Documents']].map(([v, l]) => <button key={v} className={type === v ? 'active' : ''} onClick={() => { setType(v); setPage(1) }}>{l}</button>)}</div>
    <article className="admin-panel"><div className="panel-title"><div><h2>Médiathèque</h2><p>{res.data ? `${res.data.total} fichier(s)` : ' '} · JPEG, PNG, GIF, WebP, PDF, DOCX, XLSX, PPTX</p></div>
      {can('media:write') && <div className="upload-bar"><label className="check-inline"><input type="checkbox" checked={temp} onChange={(e) => setTemp(e.target.checked)}/> Temporaire (24 h)</label><input ref={input} type="file" multiple hidden accept=".jpg,.jpeg,.png,.gif,.webp,.pdf,.docx,.xlsx,.pptx" onChange={onFiles}/><button className="btn primary small" disabled={busy} onClick={() => input.current?.click()}><Icon name="upload" size={16}/> {busy ? 'Envoi…' : 'Téléverser'}</button></div>}</div>
      {res.loading && !res.data ? <Loading/> : res.error && !res.data ? <ErrorBox message={res.error} onRetry={res.reload}/> : !res.data?.items.length ? <EmptyState icon="image" title="Aucun fichier">Téléversez des images et documents à utiliser dans vos contenus.</EmptyState>
        : <div className="media-grid">{res.data.items.map((m) => <figure key={m.id} className="media-card static">
          <div className="thumb">{m.mimeType.startsWith('image/') && !m.expiresAt ? <img src={mediaUrl(m.id)} alt={m.altFr} loading="lazy"/> : <Icon name={m.mimeType.startsWith('image/') ? 'image' : 'file'} size={36}/>}</div>
          <figcaption><b title={m.originalName}>{m.originalName}</b><small>{fmtBytes(m.sizeBytes)} · {fmtDate(m.createdAt)}</small>{m.expiresAt && <span className="status brouillon">Temporaire</span>}
            <div className="card-actions">{can('media:write') && <button className="btn outline small" onClick={() => setEdit(m)}>Modifier</button>}{!m.expiresAt && <CopyButton text={new URL(m.url, location.origin).href} label="Lien"/>}{can('media:delete') && <button className="icon-btn" aria-label="Supprimer" onClick={() => remove(m)}><Icon name="trash" size={16}/></button>}</div></figcaption></figure>)}</div>}
      {res.data && <Pagination page={page} pageSize={res.data.pageSize} total={res.data.total} onPage={setPage}/>}
    </article>
    {edit && <EditMedia item={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); res.reload() }}/>}
    {node}</>
}

function EditMedia({ item, onClose, onSaved }: { item: MediaItem; onClose: () => void; onSaved: () => void }) {
  const toast = useToast()
  const [v, setV] = useState({ altFr: item.altFr, altEn: item.altEn, caption: item.caption })
  const [keep, setKeep] = useState(false)
  async function save() {
    try { await api(`/admin/media/${item.id}`, { method: 'PATCH', auth: true, body: { ...v, ...(keep ? { keep: true } : {}) } }); toast('Enregistré'); onSaved() } catch (e) { toast(errMsg(e), 'error') }
  }
  return <Modal title={item.originalName} onClose={onClose} footer={<><button className="btn outline small" onClick={onClose}>Annuler</button><button className="btn primary small" onClick={save}>Enregistrer</button></>}>
    <div className="form-grid"><Field label="Texte alternatif (FR)" full hint="Décrit l’image pour l’accessibilité."><input value={v.altFr} maxLength={300} onChange={(e) => setV({ ...v, altFr: e.target.value })}/></Field><Field label="Alternative text (EN)" full><input value={v.altEn} maxLength={300} onChange={(e) => setV({ ...v, altEn: e.target.value })}/></Field><Field label="Légende" full><input value={v.caption} maxLength={500} onChange={(e) => setV({ ...v, caption: e.target.value })}/></Field>
      {item.expiresAt && <label className="check-inline full"><input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)}/> Conserver ce fichier (retire l’expiration automatique)</label>}</div></Modal>
}
