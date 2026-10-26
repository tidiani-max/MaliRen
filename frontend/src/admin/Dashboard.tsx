import { api } from '../api/client'
import { useAsync } from '../api/hooks'
import type { Dashboard as D } from '../api/types'
import { Button, Icon, go } from '../ui'
import { EmptyState, ErrorBox, Loading, StatusBadge, fmtDate } from './kit'

const MONTHS = ['Janv', 'Févr', 'Mars', 'Avr', 'Mai', 'Juin', 'Juil', 'Août', 'Sept', 'Oct', 'Nov', 'Déc']
const TYPE_LABEL: Record<string, string> = { news: 'Actualité', events: 'Événement', publications: 'Publication' }

export function Dashboard() {
  const res = useAsync(() => api<D>('/admin/dashboard', { auth: true }), [])
  if (res.loading && !res.data) return <Loading/>
  if (res.error || !res.data) return <ErrorBox message={res.error ?? 'Erreur'} onRetry={res.reload}/>
  const d = res.data
  const max = Math.max(1, ...d.publicationActivity.map((m) => m.published))
  const metrics: [string, number, string, string][] = [
    ['Contenus publiés', d.metrics.published, 'Actualités, événements, publications, pages', 'file'],
    ['Brouillons', d.metrics.drafts, 'À réviser et publier', 'file'],
    ['Événements à venir', d.metrics.upcomingEvents, 'Publiés et pas encore terminés', 'calendar'],
    ['Nouvelles demandes', d.metrics.newSubmissions, 'À traiter', 'mail'],
  ]
  return <>
    <div className="metrics">{metrics.map((m) => <article key={m[0]}><span><Icon name={m[3]}/></span><div><small>{m[0]}</small><b>{m[1]}</b><p>{m[2]}</p></div></article>)}</div>
    <div className="admin-grid">
      <article className="admin-panel"><div className="panel-title"><h2>Activité de publication</h2><span>6 derniers mois</span></div>
        <div className="bars" role="img" aria-label="Publications par mois">{d.publicationActivity.map((m) => <div key={m.month} title={`${m.published} publication(s)`}><i style={{ height: `${Math.max(m.published ? 6 : 1, (m.published / max) * 100)}%` }}/><span>{MONTHS[Number(m.month.slice(5)) - 1]} · {m.published}</span></div>)}</div></article>
      <article className="admin-panel"><div className="panel-title"><h2>Demandes récentes</h2><button onClick={() => go('/admin/submissions')}>Tout voir</button></div>
        {d.recentSubmissions.length ? d.recentSubmissions.map((x) => <div className="mini-row" key={x.id} style={{ cursor: 'pointer' }} onClick={() => go('/admin/submissions')}><span>{x.name.slice(0, 2).toUpperCase()}</span><div><b>{x.name}</b><small>{x.subject}</small></div><StatusBadge status={x.status}/></div>) : <EmptyState icon="mail" title="Aucune demande">Les demandes du formulaire public apparaîtront ici.</EmptyState>}</article>
    </div>
    <article className="admin-panel recent"><div className="panel-title"><h2>Contenus récents</h2><Button kind="link" onClick={() => go('/admin/news')}>Gérer les contenus</Button></div>
      {d.recentContent.length ? <div className="table-wrap"><table><thead><tr><th>Titre</th><th>Type</th><th>Statut</th><th>Mise à jour</th></tr></thead><tbody>{d.recentContent.map((c) => <tr key={c.type + c.id} style={{ cursor: 'pointer' }} onClick={() => go(`/admin/${c.type}`)}><td><b>{c.title}</b></td><td>{TYPE_LABEL[c.type]}</td><td><StatusBadge status={c.status}/></td><td>{fmtDate(c.updatedAt)}</td></tr>)}</tbody></table></div> : <EmptyState title="Aucun contenu">Créez votre première actualité.</EmptyState>}</article>
  </>
}
