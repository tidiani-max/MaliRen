import { FormEvent, ReactNode, useEffect, useState } from 'react'
import { api, ApiError, mediaUrl } from '../api/client'
import { useAsync } from '../api/hooks'
import type { MediaItem, Paged } from '../api/types'
import { Icon } from '../ui'
import { useAuth } from './auth'
import { Chips, EmptyState, ErrorBox, Field, Loading, Modal, Pagination, StatusBadge, errMsg, fmtDate, fmtDateTime, fromLocalInput, toLocalInput, useConfirm, useDebounced, useToast } from './kit'

export interface FieldDef {
  key: string; label: string; type: 'text' | 'textarea' | 'select' | 'datetime' | 'number' | 'media'
  options?: [string, string][]; rows?: number; hint?: string; full?: boolean; required?: boolean; max?: number; mediaKind?: 'image' | 'any'; onlyOnCreate?: boolean
}
type Row = Record<string, any> & { id: string; status: string; updatedAt: string; isDemo?: boolean }
export interface ModuleCfg {
  name: string; title: string; singular: string; subtitle: string; workflow: 'content' | 'institution'; titleKey: string
  fields: FieldDef[]; initial: Record<string, unknown>
  cols: { label: string; render: (i: Row) => ReactNode }[]
  kindFilter?: [string, string][]
}

const CONTENT_FILTERS: [string, string][] = [['', 'Tous'], ['published', 'Publiés'], ['draft', 'Brouillons'], ['scheduled', 'Programmés'], ['archived', 'Archivés']]
const INST_FILTERS: [string, string][] = [['', 'Tous'], ['active', 'Actifs'], ['pending', 'En attente'], ['inactive', 'Inactifs']]
const TRANSITIONS: Record<string, [string, string][]> = {
  draft: [['published', 'Publier'], ['scheduled', 'Programmer…'], ['archived', 'Archiver']],
  scheduled: [['published', 'Publier maintenant'], ['draft', 'Repasser en brouillon'], ['archived', 'Archiver']],
  published: [['draft', 'Dépublier'], ['archived', 'Archiver']],
  archived: [['draft', 'Restaurer en brouillon']],
}

export function ContentManager({ cfg, query }: { cfg: ModuleCfg; query: string }) {
  const { can } = useAuth()
  const toast = useToast()
  const { confirm, node: confirmNode } = useConfirm()
  const canWrite = can('content:write'), canDelete = can('content:delete')
  const [page, setPage] = useState(1)
  const [status, setStatus] = useState('')
  const [kind, setKind] = useState('')
  const [sort, setSort] = useState<'newest' | 'oldest' | 'title'>('newest')
  const [editing, setEditing] = useState<Row | 'new' | null>(null)
  const [scheduling, setScheduling] = useState<Row | null>(null)
  const q = useDebounced(query, 300)
  useEffect(() => setPage(1), [q, status, kind, sort, cfg.name])
  const res = useAsync(() => api<Paged<Row>>(`/admin/${cfg.name}`, { auth: true, query: { page, pageSize: 15, q, status, kind, sort } }), [cfg.name, page, q, status, kind, sort])

  async function setItemStatus(item: Row, next: string, publishAt?: string) {
    try {
      await api(`/admin/${cfg.name}/${item.id}/status`, { method: 'POST', auth: true, body: { status: next, publishAt } })
      toast('Statut mis à jour'); res.reload()
    } catch (e) { toast(errMsg(e), 'error') }
  }
  async function remove(item: Row) {
    if (!(await confirm(`Supprimer définitivement « ${item[cfg.titleKey]} » ? Cette action est irréversible.`, 'Supprimer'))) return
    try { await api(`/admin/${cfg.name}/${item.id}`, { method: 'DELETE', auth: true }); toast('Élément supprimé'); res.reload() } catch (e) { toast(errMsg(e), 'error') }
  }
  function onAction(item: Row, value: string) {
    if (!value) return
    if (value === 'delete') return void remove(item)
    if (value === 'scheduled') return setScheduling(item)
    void setItemStatus(item, value)
  }

  const filters = cfg.workflow === 'content' ? CONTENT_FILTERS : INST_FILTERS
  return <>
    <div className="filters"><Chips value={status} onChange={setStatus} options={filters}/>
      {cfg.kindFilter && <select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Type"><option value="">Tous types</option>{cfg.kindFilter.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>}
      <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} aria-label="Tri"><option value="newest">Plus récents</option><option value="oldest">Plus anciens</option><option value="title">Titre (A→Z)</option></select></div>
    <article className="admin-panel">
      <div className="panel-title"><div><h2>{cfg.title}</h2><p>{cfg.subtitle}{res.data ? ` · ${res.data.total} élément(s)` : ''}</p></div>
        {canWrite && <button className="btn primary small" onClick={() => setEditing('new')}><Icon name="plus" size={16}/> Créer {cfg.singular}</button>}</div>
      {res.loading && !res.data ? <Loading/> : res.error && !res.data ? <ErrorBox message={res.error} onRetry={res.reload}/> : !res.data?.items.length
        ? (q || status || kind ? <EmptyState icon="search" title="Aucun résultat">Essayez avec un autre terme ou un autre filtre.</EmptyState> : <EmptyState title={`Aucun(e) ${cfg.singular}`}>{canWrite ? 'Utilisez le bouton « Créer » pour commencer.' : 'Rien à afficher pour le moment.'}</EmptyState>)
        : <div className="table-wrap"><table><thead><tr><th>Titre</th>{cfg.cols.map((c) => <th key={c.label}>{c.label}</th>)}<th>Statut</th><th>Mise à jour</th><th></th></tr></thead><tbody>
          {res.data.items.map((it) => <tr key={it.id}>
            <td><b>{it[cfg.titleKey]}</b>{it.isDemo && <small title="Contenu issu du prototype, à valider">Contenu de démonstration</small>}</td>
            {cfg.cols.map((c) => <td key={c.label}>{c.render(it)}</td>)}
            <td><StatusBadge status={it.status}/>{it.status === 'scheduled' && it.publishAt && <small>{fmtDateTime(it.publishAt)}</small>}</td>
            <td>{fmtDate(it.updatedAt)}</td>
            <td className="row-actions"><button className="btn outline small" onClick={() => setEditing(it)}>{canWrite ? 'Modifier' : 'Voir'}</button>
              {(canWrite || canDelete) && <select aria-label={`Actions pour ${it[cfg.titleKey]}`} value="" onChange={(e) => onAction(it, e.target.value)}><option value="">Actions…</option>
                {canWrite && (cfg.workflow === 'content' ? TRANSITIONS[it.status] : INST_FILTERS.slice(1).filter(([v]) => v !== it.status).map(([v, l]) => [v, `Marquer « ${l.toLowerCase()} »`] as [string, string])).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                {canDelete && <option value="delete">Supprimer…</option>}</select>}</td></tr>)}
        </tbody></table></div>}
      {res.data && <Pagination page={page} pageSize={res.data.pageSize} total={res.data.total} onPage={setPage}/>}
    </article>
    {editing && <Editor cfg={cfg} item={editing === 'new' ? null : editing} readOnly={!canWrite} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); res.reload() }}/>}
    {scheduling && <ScheduleModal onClose={() => setScheduling(null)} onConfirm={(iso) => { void setItemStatus(scheduling, 'scheduled', iso); setScheduling(null) }}/>}
    {confirmNode}
  </>
}

function ScheduleModal({ onClose, onConfirm }: { onClose: () => void; onConfirm: (iso: string) => void }) {
  const [v, setV] = useState(toLocalInput(new Date(Date.now() + 3600_000).toISOString()))
  const iso = fromLocalInput(v)
  const invalid = !iso || new Date(iso) <= new Date()
  return <Modal title="Programmer la publication" onClose={onClose} footer={<><button className="btn outline small" onClick={onClose}>Annuler</button><button className="btn primary small" disabled={invalid} onClick={() => iso && onConfirm(iso)}>Programmer</button></>}>
    <Field label="Date et heure de publication" hint="Heure locale de votre navigateur. Le contenu sera publié automatiquement." error={invalid ? 'Choisissez une date future.' : undefined}><input type="datetime-local" value={v} onChange={(e) => setV(e.target.value)}/></Field></Modal>
}

function Editor({ cfg, item, readOnly, onClose, onSaved }: { cfg: ModuleCfg; item: Row | null; readOnly: boolean; onClose: () => void; onSaved: () => void }) {
  const toast = useToast()
  const [values, setValues] = useState<Record<string, any>>(() => {
    const base: Record<string, any> = { ...cfg.initial }
    if (item) for (const f of cfg.fields) base[f.key] = f.type === 'datetime' ? toLocalInput(item[f.key]) : (item[f.key] ?? (f.type === 'media' ? null : ''))
    if (item) base.slug = item.slug
    return base
  })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const set = (k: string, v: unknown) => setValues((s) => ({ ...s, [k]: v }))

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (readOnly) return
    const body: Record<string, unknown> = {}
    for (const f of cfg.fields) {
      if (item && f.onlyOnCreate) continue
      const v = values[f.key]
      body[f.key] = f.type === 'datetime' ? fromLocalInput(v) : f.type === 'number' ? Number(v || 0) : f.type === 'media' ? (v || null) : v
    }
    if (cfg.name !== 'pages' && values.slug) body.slug = values.slug
    else if (cfg.name === 'pages' && !item) body.slug = values.slug
    setBusy(true); setErrors({})
    try {
      await api(item ? `/admin/${cfg.name}/${item.id}` : `/admin/${cfg.name}`, { method: item ? 'PATCH' : 'POST', auth: true, body })
      toast(item ? 'Modifications enregistrées' : 'Élément créé'); onSaved()
    } catch (err) {
      if (err instanceof ApiError && err.details) setErrors(Object.fromEntries(err.details.map((d) => [d.path, d.message])))
      toast(errMsg(err), 'error')
    } finally { setBusy(false) }
  }

  const renderField = (f: FieldDef) => {
    if (item && f.onlyOnCreate) return null
    const common = { id: f.key, value: values[f.key] ?? '', disabled: readOnly, required: f.required, maxLength: f.max }
    let input: ReactNode
    if (f.type === 'textarea') input = <textarea {...common} rows={f.rows ?? 4} onChange={(e) => set(f.key, e.target.value)}/>
    else if (f.type === 'select') input = <select {...common} onChange={(e) => set(f.key, e.target.value)}>{f.options!.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
    else if (f.type === 'datetime') input = <input {...common} type="datetime-local" onChange={(e) => set(f.key, e.target.value)}/>
    else if (f.type === 'number') input = <input {...common} type="number" min={0} onChange={(e) => set(f.key, e.target.value)}/>
    else if (f.type === 'media') input = <MediaField value={values[f.key]} onChange={(v) => set(f.key, v)} disabled={readOnly} kind={f.mediaKind ?? 'any'}/>
    else input = <input {...common} type="text" onChange={(e) => set(f.key, e.target.value)}/>
    return <Field key={f.key} label={f.label + (f.required ? ' *' : '')} hint={f.hint} error={errors[f.key]} full={f.full || f.type === 'textarea'}>{input}</Field>
  }

  return <Modal wide title={item ? (readOnly ? `Consulter  ${item[cfg.titleKey]}` : `Modifier  ${item[cfg.titleKey]}`) : `Créer ${cfg.singular}`} onClose={onClose}
    footer={<><button type="button" className="btn outline small" onClick={onClose}>{readOnly ? 'Fermer' : 'Annuler'}</button>{!readOnly && <button type="submit" form="editor-form" className="btn primary small" disabled={busy}>{busy ? 'Enregistrement…' : 'Enregistrer'}</button>}</>}>
    {item?.isDemo && !readOnly && <div className="demo-banner">Contenu de démonstration issu du prototype. Dès que vous l’enregistrez, il est considéré comme validé.</div>}
    <form id="editor-form" className="form-grid" onSubmit={submit}>
      {cfg.name !== 'pages' && <Field label="Adresse (slug)" hint="Laisser vide pour la générer à partir du titre." error={errors.slug} full><input value={values.slug ?? ''} disabled={readOnly} maxLength={80} placeholder="genere-automatiquement" onChange={(e) => set('slug', e.target.value)}/></Field>}
      {cfg.fields.map(renderField)}
    </form>
    {!item && cfg.workflow === 'content' && <p className="hint">Le nouvel élément est créé en <b>brouillon</b> : publiez-le depuis la liste (menu « Actions »).</p>}
  </Modal>
}

/* ---------- media picker used for cover images and downloadable files */
function MediaField({ value, onChange, disabled, kind }: { value: string | null; onChange: (v: string | null) => void; disabled?: boolean; kind: 'image' | 'any' }) {
  const [open, setOpen] = useState(false)
  return <div className="media-field">
    {value ? <div className="media-current">{kind === 'image' ? <img src={mediaUrl(value)} alt="" /> : <Icon name="file"/>}<span>Fichier sélectionné</span></div> : <span className="muted">Aucun fichier</span>}
    {!disabled && <><button type="button" className="btn outline small" onClick={() => setOpen(true)}>Choisir…</button>{value && <button type="button" className="btn outline small" onClick={() => onChange(null)}>Retirer</button>}</>}
    {open && <MediaPicker kind={kind} onClose={() => setOpen(false)} onPick={(m) => { onChange(m.id); setOpen(false) }}/>}
  </div>
}

function MediaPicker({ kind, onClose, onPick }: { kind: 'image' | 'any'; onClose: () => void; onPick: (m: MediaItem) => void }) {
  const res = useAsync(() => api<Paged<MediaItem>>('/admin/media', { auth: true, query: { pageSize: 48, temporary: 'false', type: kind === 'image' ? 'image' : undefined } }), [kind])
  return <Modal wide title="Médiathèque" onClose={onClose}>{res.loading && !res.data ? <Loading/> : !res.data?.items.length ? <EmptyState icon="image" title="Médiathèque vide">Téléversez d’abord un fichier dans le module « Médiathèque ».</EmptyState>
    : <div className="media-grid">{res.data.items.map((m) => <button type="button" key={m.id} className="media-card" onClick={() => onPick(m)}>{m.mimeType.startsWith('image/') ? <img src={m.url} alt={m.altFr}/> : <Icon name="file" size={36}/>}<span>{m.originalName}</span></button>)}</div>}</Modal>
}
