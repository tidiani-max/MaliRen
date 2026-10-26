import { createContext, ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { ApiError } from '../api/client'
import { Icon } from '../ui'

/* ---------- toasts */
type ToastKind = 'ok' | 'error'
const ToastCtx = createContext<(msg: string, kind?: ToastKind) => void>(() => undefined)
export const useToast = () => useContext(ToastCtx)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<{ id: number; msg: string; kind: ToastKind }[]>([])
  const push = useCallback((msg: string, kind: ToastKind = 'ok') => {
    const id = Date.now() + Math.random()
    setItems((s) => [...s, { id, msg, kind }])
    setTimeout(() => setItems((s) => s.filter((x) => x.id !== id)), kind === 'error' ? 7000 : 3500)
  }, [])
  return <ToastCtx.Provider value={push}>{children}<div className="toasts" role="status" aria-live="polite">{items.map((t) => <div key={t.id} className={`toast ${t.kind}`}>{t.msg}</div>)}</div></ToastCtx.Provider>
}

/** Turn any thrown error into a readable French message. */
export function errMsg(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 0) return 'Serveur injoignable. Vérifiez votre connexion.'
    if (e.status === 403) return 'Action non autorisée pour votre rôle.'
    if (e.status === 429) return 'Trop de tentatives. Réessayez dans quelques minutes.'
    if (e.status === 413) return 'Fichier trop volumineux.'
    if (e.status === 409) return e.message
    if (e.details?.length) return e.details.map((d) => `${d.path ? d.path + ' : ' : ''}${d.message}`).join(' · ')
    return e.message
  }
  return e instanceof Error ? e.message : 'Une erreur est survenue.'
}

/* ---------- formatting */
export const fmtDateTime = (iso?: string | null) => (iso ? new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '')
export const fmtDate = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' }) : '')
export const toLocalInput = (iso?: string | null) => { if (!iso) return ''; const d = new Date(iso); const p = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}` }
export const fromLocalInput = (v: string) => (v ? new Date(v).toISOString() : null)
export const fmtBytes = (n: number) => (n < 1024 ? `${n} o` : n < 1048576 ? `${(n / 1024).toFixed(0)} Ko` : `${(n / 1048576).toFixed(1)} Mo`)

export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value)
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t) }, [value, ms])
  return v
}

/* ---------- status badges */
const STATUS: Record<string, [string, string]> = {
  draft: ['Brouillon', 'brouillon'], scheduled: ['Programmé', 'encours'], published: ['Publié', ''], archived: ['Archivé', 'archive'],
  pending: ['En attente', 'brouillon'], active: ['Actif', ''], inactive: ['Inactif', 'archive'],
  new: ['Nouveau', 'nouveau'], in_progress: ['En cours', 'encours'], handled: ['Traité', ''], spam: ['Indésirable', 'archive'],
  succeeded: ['Réussie', ''], queued: ['En attente', 'encours'], running: ['En cours', 'encours'], failed: ['Échec', 'erreur'], dead: ['Abandonnée', 'erreur'],
  sent: ['Envoyé', ''], logged: ['Journalisé (dev)', 'encours'], pending_mail: ['En attente', 'encours'],
  not_configured: ['Non configuré', 'archive'],
}
export const StatusBadge = ({ status }: { status: string }) => { const [label, cls] = STATUS[status] ?? [status, 'archive']; return <i className={`status ${cls}`}>{label}</i> }
export const statusLabel = (s: string) => STATUS[s]?.[0] ?? s

/* ---------- layout bits */
export function Modal({ title, onClose, children, wide, footer }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean; footer?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    addEventListener('keydown', onKey)
    ref.current?.focus()
    return () => { removeEventListener('keydown', onKey); prev?.focus?.() }
  }, [onClose])
  return <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
    <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={ref}>
      <div className="modal-head"><h2>{title}</h2><button className="icon-btn" onClick={onClose} aria-label="Fermer"><Icon name="close"/></button></div>
      <div className="modal-body">{children}</div>
      {footer && <div className="modal-foot">{footer}</div>}
    </div></div>
}

export const Loading = ({ text = 'Chargement…' }: { text?: string }) => <div className="empty" role="status"><b>{text}</b></div>
export const ErrorBox = ({ message, onRetry }: { message: string; onRetry?: () => void }) => <div className="empty error-box" role="alert"><b>{message}</b>{onRetry && <p><button className="btn outline small" onClick={onRetry}>Réessayer</button></p>}</div>
export const EmptyState = ({ icon = 'file', title, children }: { icon?: string; title: string; children?: ReactNode }) => <div className="empty"><Icon name={icon} size={40}/><b>{title}</b>{children && <p>{children}</p>}</div>

export function Pagination({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  if (total <= pageSize) return null
  return <div className="pager"><span>{(page - 1) * pageSize + 1}–{Math.min(total, page * pageSize)} sur {total}</span><button className="btn outline small" disabled={page <= 1} onClick={() => onPage(page - 1)}>Précédent</button><button className="btn outline small" disabled={page >= pages} onClick={() => onPage(page + 1)}>Suivant</button></div>
}

export function Chips<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: [T, string][] }) {
  return <>{options.map(([v, label]) => <button key={v} className={value === v ? 'active' : ''} onClick={() => onChange(v)}>{label}</button>)}</>
}

export function Field({ label, hint, error, children, full }: { label: string; hint?: string; error?: string; children: ReactNode; full?: boolean }) {
  return <label className={`f ${full ? 'full' : ''}`}><span>{label}</span>{children}{hint && <small>{hint}</small>}{error && <small className="err">{error}</small>}</label>
}

/** Small promise-based confirm dialog. */
export function useConfirm() {
  const [state, setState] = useState<{ msg: string; ok: string; resolve: (v: boolean) => void } | null>(null)
  const confirm = useCallback((msg: string, ok = 'Confirmer') => new Promise<boolean>((resolve) => setState({ msg, ok, resolve })), [])
  const close = (v: boolean) => { state?.resolve(v); setState(null) }
  const node = state ? <Modal title="Confirmation" onClose={() => close(false)} footer={<><button className="btn outline small" onClick={() => close(false)}>Annuler</button><button className="btn primary small danger" onClick={() => close(true)}>{state.ok}</button></>}><p>{state.msg}</p></Modal> : null
  return { confirm, node }
}

export function CopyButton({ text, label = 'Copier' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false)
  return <button className="btn outline small" onClick={async () => { try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500) } catch { /* clipboard unavailable */ } }}>{done ? 'Copié ✓' : label}</button>
}
