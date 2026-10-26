import { useState } from 'react'
import { api, download } from '../api/client'
import { useAsync } from '../api/hooks'
import type { DigestReport, SummaryReport } from '../api/types'
import { Icon } from '../ui'
import { useAuth } from './auth'
import { EmptyState, ErrorBox, Loading, Modal, errMsg, fmtDate, fmtDateTime, statusLabel, useToast } from './kit'

const DATASETS: [string, string][] = [['submissions', 'Demandes'], ['news', 'Actualités'], ['events', 'Événements'], ['publications', 'Publications'], ['institutions', 'Institutions'], ['audit', 'Journal d’audit']]
const TYPE: Record<string, string> = { news: 'Actualités', events: 'Événements', publications: 'Publications', pages: 'Pages' }

export function Reports() {
  const { can } = useAuth()
  const toast = useToast()
  const [days, setDays] = useState(30)
  const [view, setView] = useState<DigestReport | null>(null)
  const res = useAsync(() => { const to = new Date(); return api<SummaryReport>('/admin/reports/summary', { auth: true, query: { from: new Date(to.getTime() - days * 86_400_000).toISOString(), to: to.toISOString() } }) }, [days])
  const digests = useAsync(() => api<{ items: DigestReport[] }>('/admin/reports/digests', { auth: true }), [])
  async function generate() { try { await api('/admin/reports/digests', { method: 'POST', auth: true, body: { days } }); toast('Rapport enregistré'); digests.reload() } catch (e) { toast(errMsg(e), 'error') } }
  const s = res.data
  const max = Math.max(1, ...(s?.submissions.byMonth.map((m) => m.n) ?? [1]))
  return <>
    <div className="filters">{[7, 30, 90, 365].map((d) => <button key={d} className={days === d ? 'active' : ''} onClick={() => setDays(d)}>{d === 365 ? '12 mois' : `${d} jours`}</button>)}</div>
    {res.loading && !s ? <Loading/> : res.error && !s ? <ErrorBox message={res.error} onRetry={res.reload}/> : s && <>
      <div className="metrics"><article><span><Icon name="mail"/></span><div><small>Demandes reçues</small><b>{s.submissions.total}</b><p>sur la période</p></div></article><article><span><Icon name="clock"/></span><div><small>Encore ouvertes</small><b>{s.submissions.openNow}</b><p>nouvelles + en cours (total)</p></div></article><article><span><Icon name="check"/></span><div><small>Traitées</small><b>{s.submissions.byStatus.handled ?? 0}</b><p>sur la période</p></div></article><article><span><Icon name="chart"/></span><div><small>Délai moyen de traitement</small><b>{s.submissions.avgHoursToHandle ?? ''}{s.submissions.avgHoursToHandle !== null && ' h'}</b><p>demandes traitées</p></div></article></div>
      <div className="admin-grid">
        <article className="admin-panel"><div className="panel-title"><h2>Demandes par mois</h2><span>{fmtDate(s.period.from)} → {fmtDate(s.period.to)}</span></div>{s.submissions.byMonth.length ? <div className="bars">{s.submissions.byMonth.map((m) => <div key={m.month}><i style={{ height: `${(m.n / max) * 100}%` }}/><span>{m.month} · {m.n}</span></div>)}</div> : <EmptyState icon="chart" title="Aucune donnée sur la période"/>}</article>
        <article className="admin-panel"><div className="panel-title"><h2>Contenus par statut</h2></div><table><thead><tr><th>Type</th><th>Publié</th><th>Brouillon</th><th>Programmé</th><th>Archivé</th></tr></thead><tbody>{s.content.map((c) => <tr key={c.type}><td><b>{TYPE[c.type]}</b></td>{['published', 'draft', 'scheduled', 'archived'].map((k) => <td key={k}>{c.byStatus[k] ?? 0}</td>)}</tr>)}</tbody></table>
          <div className="panel-title" style={{ marginTop: 22 }}><h2>Institutions</h2></div><p className="muted">{s.institutions.length ? s.institutions.map((i) => `${i.n} ${i.kind} (${statusLabel(i.status).toLowerCase()})`).join(' · ') : 'Aucune institution.'}</p></article>
      </div></>}
    <article className="admin-panel"><div className="panel-title"><div><h2>Exports CSV</h2><p>Les cellules commençant par = + - @ sont neutralisées contre l’injection de formules.</p></div></div>
      <div className="export-row">{DATASETS.filter(([k]) => k !== 'audit' || can('audit:read')).map(([k, l]) => <button key={k} className="btn outline small" onClick={() => download(`/admin/reports/export/${k}`, `${k}.csv`).catch((e) => toast(errMsg(e), 'error'))}><Icon name="download" size={15}/> {l}</button>)}</div></article>
    <article className="admin-panel"><div className="panel-title"><div><h2>Rapports enregistrés</h2><p>Instantanés manuels et rapports périodiques (automatisation « digest »).</p></div>{can('reports:generate') && <button className="btn primary small" onClick={generate}>Générer maintenant ({days} j)</button>}</div>
      {digests.loading && !digests.data ? <Loading/> : !digests.data?.items.length ? <EmptyState icon="file" title="Aucun rapport enregistré"/> : <div className="table-wrap"><table><thead><tr><th>Titre</th><th>Type</th><th>Créé le</th><th></th></tr></thead><tbody>{digests.data.items.map((d) => <tr key={d.id}><td><b>{d.title}</b></td><td>{d.type === 'digest' ? 'Périodique' : 'Manuel'}</td><td>{fmtDateTime(d.createdAt)}</td><td><button className="btn outline small" onClick={() => setView(d)}>Voir</button></td></tr>)}</tbody></table></div>}</article>
    {view && <Modal wide title={view.title} onClose={() => setView(null)}><p className="muted">Période : {fmtDate(view.periodStart)} → {fmtDate(view.periodEnd)}</p><p>Demandes reçues : <b>{view.data.submissions.total}</b> · ouvertes : <b>{view.data.submissions.openNow}</b> · délai moyen : <b>{view.data.submissions.avgHoursToHandle ?? ''} h</b></p><pre className="json">{JSON.stringify(view.data.submissions.byStatus, null, 2)}</pre></Modal>}
  </>
}
