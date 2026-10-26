import { useEffect, useState } from 'react'
import { api } from '../api/client'
import { useAsync } from '../api/hooks'
import type { NotificationSettings, ScheduleItem, SiteSettings } from '../api/types'
import { useAuth } from './auth'
import { Chips, ErrorBox, Field, Loading, StatusBadge, errMsg, fmtDateTime, useToast } from './kit'

type Tab = 'site' | 'notifications' | 'automation' | 'integrations'
export function Settings() {
  const { can } = useAuth()
  const [tab, setTab] = useState<Tab>('site')
  const tabs: [Tab, string][] = [['site', 'Site & contacts'], ['notifications', 'Notifications'], ...(can('automation:read') ? [['automation', 'Automatisations'] as [Tab, string]] : []), ['integrations', 'Intégrations']]
  return <><div className="filters"><Chips value={tab} onChange={setTab} options={tabs}/></div>{tab === 'site' ? <SiteTab/> : tab === 'notifications' ? <NotifTab/> : tab === 'automation' ? <AutomationTab/> : <IntegrationsTab/>}</>
}

const SITE_FIELDS: [keyof SiteSettings, string, string?][] = [
  ['technicalContactName', 'Contact technique  nom'], ['technicalContactPhone', 'Contact technique  téléphone'], ['technicalContactEmail', 'Contact technique  e-mail'],
  ['ceoName', 'Contact CEO  nom'], ['ceoEmail', 'Contact CEO  e-mail'], ['supportEmail', 'E-mail de support (optionnel)'],
  ['addressLine', 'Adresse'], ['asn', 'ASN'], ['ipv4Block', 'Bloc IPv4'], ['peering', 'Peering'],
]
function SiteTab() {
  const { can } = useAuth(); const toast = useToast()
  const res = useAsync(() => api<{ site: SiteSettings }>('/admin/settings', { auth: true }), [])
  const [v, setV] = useState<SiteSettings | null>(null)
  useEffect(() => { if (res.data) setV(res.data.site) }, [res.data])
  if (res.loading && !v) return <Loading/>
  if (res.error && !v) return <ErrorBox message={res.error} onRetry={res.reload}/>
  const ro = !can('settings:write')
  async function save() { try { await api('/admin/settings/site', { method: 'PUT', auth: true, body: v }); toast('Paramètres du site enregistrés') } catch (e) { toast(errMsg(e), 'error') } }
  return <article className="admin-panel"><div className="panel-title"><div><h2>Site & contacts</h2><p>Affichés dans le pied de page, la page d’accueil et la page Contact.</p></div>{!ro && <button className="btn primary small" onClick={save}>Enregistrer</button>}</div>
    <div className="form-grid">{SITE_FIELDS.map(([k, l]) => <Field key={k} label={l}><input disabled={ro} value={v?.[k] ?? ''} maxLength={300} onChange={(e) => setV({ ...v!, [k]: e.target.value })}/></Field>)}</div></article>
}

function NotifTab() {
  const { can } = useAuth(); const toast = useToast()
  const res = useAsync(() => api<{ notifications: NotificationSettings; mailMode: string }>('/admin/settings', { auth: true }), [])
  const [v, setV] = useState<NotificationSettings | null>(null)
  const [text, setText] = useState('')
  useEffect(() => { if (res.data) { setV(res.data.notifications); setText(res.data.notifications.recipients.join('\n')) } }, [res.data])
  if (res.loading && !v) return <Loading/>
  if (res.error && !v) return <ErrorBox message={res.error} onRetry={res.reload}/>
  const ro = !can('settings:write')
  async function save() {
    const recipients = text.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean)
    try { await api('/admin/settings/notifications', { method: 'PUT', auth: true, body: { ...v, recipients } }); toast('Notifications enregistrées') } catch (e) { toast(errMsg(e), 'error') }
  }
  return <article className="admin-panel"><div className="panel-title"><div><h2>Notifications</h2><p>Qui est prévenu des nouvelles demandes, rappels et rapports.{res.data?.mailMode === 'log' && ' (Mode développement : e-mails journalisés, non envoyés.)'}</p></div>{!ro && <button className="btn primary small" onClick={save}>Enregistrer</button>}</div>
    <div className="form-grid"><label className="check-inline full"><input type="checkbox" disabled={ro} checked={v?.notifyAdmins ?? true} onChange={(e) => setV({ ...v!, notifyAdmins: e.target.checked })}/> Prévenir tous les administrateurs et éditeurs actifs (notification dans l’interface + e-mail)</label>
      <label className="check-inline full"><input type="checkbox" disabled={ro} checked={v?.notifyOnContact ?? true} onChange={(e) => setV({ ...v!, notifyOnContact: e.target.checked })}/> Notifier à chaque nouvelle demande de contact</label>
      <Field label="Destinataires e-mail supplémentaires" hint="Un par ligne (20 maximum)." full><textarea rows={4} disabled={ro} value={text} onChange={(e) => setText(e.target.value)} placeholder="equipe@maliren.ml"/></Field></div></article>
}

const WEEKDAYS = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi']
const CFG_LABEL: Record<string, string> = { afterHours: 'Rappeler après (heures)', cooldownHours: 'Délai entre deux rappels (heures)', maxReminders: 'Nombre maximum de rappels', eventDaysAhead: 'Événements : prévenir X jours avant', publicationHoursAhead: 'Publications programmées : X heures avant', jobRetentionDays: 'Conserver les tâches (jours)' }
function describe(s: ScheduleItem) { return s.kind === 'interval' ? `Toutes les ${s.intervalMinutes} min` : s.kind === 'daily' ? `Chaque jour à ${String(s.atHour).padStart(2, '0')}:${String(s.atMinute ?? 0).padStart(2, '0')} UTC` : `Chaque ${WEEKDAYS[s.weekday ?? 1].toLowerCase()} à ${String(s.atHour).padStart(2, '0')}:${String(s.atMinute ?? 0).padStart(2, '0')} UTC` }

function AutomationTab() {
  const { can } = useAuth(); const toast = useToast()
  const res = useAsync(() => api<{ globalEnabled: boolean; mailMode: string; items: ScheduleItem[] }>('/admin/automation', { auth: true }), [])
  const [result, setResult] = useState<{ name: string; dryRun: boolean; result: unknown } | null>(null)
  const manage = can('automation:manage')
  async function patch(name: string, body: Record<string, unknown>) { try { await api(`/admin/automation/${name}`, { method: 'PATCH', auth: true, body }); toast('Automatisation mise à jour'); res.reload() } catch (e) { toast(errMsg(e), 'error') } }
  async function run(name: string, dryRun: boolean) { try { const r = await api<{ dryRun: boolean; result: unknown }>(`/admin/automation/${name}/run`, { method: 'POST', auth: true, body: { dryRun } }); setResult({ name, ...r }); if (!dryRun) { toast('Exécutée'); res.reload() } } catch (e) { toast(errMsg(e), 'error') } }
  if (res.loading && !res.data) return <Loading/>
  if (res.error && !res.data) return <ErrorBox message={res.error} onRetry={res.reload}/>
  return <>
    {!res.data!.globalEnabled && <div className="demo-banner">Les automatisations sont désactivées globalement (AUTOMATIONS_ENABLED=false sur le serveur).</div>}
    {res.data!.mailMode === 'log' && <div className="demo-banner">Mode e-mail « log » : les e-mails sont enregistrés dans Activité → E-mails mais pas envoyés.</div>}
    {!manage && <p className="muted">Lecture seule  seul un super administrateur peut modifier ou exécuter les automatisations.</p>}
    {res.data!.items.map((s) => <article className="admin-panel" key={s.name}>
      <div className="panel-title"><div><h2>{s.label}</h2><p>{s.description}</p></div><label className="check-inline"><input type="checkbox" disabled={!manage} checked={s.enabled} onChange={(e) => patch(s.name, { enabled: e.target.checked })}/> {s.enabled ? 'Activée' : 'Désactivée'}</label></div>
      <p className="muted">{describe(s)} · dernière exécution : {fmtDateTime(s.lastRunAt)} · prochaine : {s.enabled ? fmtDateTime(s.nextRunAt) : ''}</p>
      <div className="form-grid">{Object.entries(s.config).map(([k, val]) => typeof val === 'number' ? <Field key={k} label={CFG_LABEL[k] ?? k}><input type="number" min={0} disabled={!manage} defaultValue={val} onBlur={(e) => { if (Number(e.target.value) !== val) patch(s.name, { config: { [k]: Number(e.target.value) } }) }}/></Field> : k === 'frequency' ? <Field key={k} label="Fréquence"><select disabled={!manage} value={String(val)} onChange={(e) => patch(s.name, { config: { frequency: e.target.value }, ...(e.target.value === 'daily' ? { kind: 'daily', atHour: 7 } : { kind: 'weekly', weekday: 1, atHour: 7 }) })}><option value="weekly">Hebdomadaire (lundi 07:00 UTC)</option><option value="daily">Quotidienne (07:00 UTC)</option></select></Field> : null)}</div>
      {manage && <div className="row-actions"><button className="btn outline small" onClick={() => run(s.name, true)}>Simuler (dry-run)</button><button className="btn outline small" onClick={() => run(s.name, false)}>Exécuter maintenant</button></div>}
      {result?.name === s.name && <div className="result-box"><b>{result.dryRun ? 'Simulation  aucune modification, aucun e-mail envoyé' : 'Résultat de l’exécution'}</b><pre className="json">{JSON.stringify(result.result, null, 2)}</pre></div>}
    </article>)}</>
}

function IntegrationsTab() {
  const res = useAsync(() => api<{ note: string; items: { key: string; label: string; status: string }[] }>('/admin/integrations', { auth: true }), [])
  if (res.loading && !res.data) return <Loading/>
  if (res.error && !res.data) return <ErrorBox message={res.error} onRetry={res.reload}/>
  return <article className="admin-panel"><div className="panel-title"><div><h2>Intégrations</h2><p>{res.data!.note}</p></div></div>
    <div className="table-wrap"><table><thead><tr><th>Service</th><th>État</th></tr></thead><tbody>{res.data!.items.map((i) => <tr key={i.key}><td><b>{i.label}</b></td><td><StatusBadge status={i.status}/></td></tr>)}</tbody></table></div></article>
}
