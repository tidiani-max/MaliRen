import { FormEvent, ReactNode, useContext, useEffect, useRef, useState } from 'react'
import { api, ApiError, mediaUrl } from './api/client'
import { useAsync, useFormatDate, usePick, usePilots, useSite } from './api/hooks'
import type { EventItem, PageItem, SearchHit } from './api/types'
import { events as fallbackEvents, news as fallbackNews, STATIC_FALLBACK } from './fallback'
import { PageHero, PublicLayout } from './layout'
import { services } from './staticPages'
import { Button, Icon, LanguageContext, go } from './ui'

// The list/detail endpoints return different shapes per content type; fields are read by the branch that knows them.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyItem = Record<string, any> & { id: string; slug: string }
const isHttp = (u: string) => /^https?:\/\//i.test(u)
const paragraphs = (text: string) => text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)
const Loading = () => <p className="muted" role="status">Chargement…</p>
const Empty = ({ children }: { children: ReactNode }) => <p className="muted">{children}</p>
const Unavailable = () => <p className="error" role="alert">Le service est momentanément indisponible. Réessayez plus tard.</p>

/* ------------------------------------------------------------------ Home */
export function Home() {
  const { lang } = useContext(LanguageContext)
  const site = useSite()
  const pilots = usePilots()
  const icons = ['users', 'users', 'file', 'file', 'chart']
  const title = lang === 'en' ? `${pilots.length} connected pilot sites` : `${pilots.length} sites pilotes connectés`
  return <PublicLayout><section className="home-hero"><div className="container hero-grid"><div><div className="home-title"><h1>NOC Point G <span> Now Live</span></h1><b>Now Live</b></div><div className="network-pills"><span><Icon name="chart"/> ASN<br/><b>{site.asn}</b></span><span><Icon name="globe"/> IPv4<br/><b>{site.ipv4Block}</b></span><span><Icon name="file"/> Peering<br/><b>{site.peering}</b></span></div><p>Le Network Operation Center de MaliREN est désormais opérationnel à Point G.<br/>Interconnexion nationale pour la recherche et l’éducation, peering activé et monitoring 24/7.</p><div className="actions"><Button onClick={() => window.open('https://www.eduid.ml','_blank')}>Accéder à EduID</Button><Button kind="outline" onClick={() => go('/services')}>Voir les services</Button></div></div><div className="network-card"><h2>EduID </h2><h3>Identité Éducation-Recherche</h3><p className="check"><Icon name="check"/> Fédération d’identité pour les établissements</p><a href="https://www.eduid.ml" target="_blank" rel="noopener noreferrer"><Icon name="globe"/> www.eduid.ml</a><a href="https://maliren.eduid.africa" target="_blank" rel="noopener noreferrer"><Icon name="globe"/> www.maliren.eduid.africa</a><small>Authentification unique · SSO · Sécurisé</small></div></div></section>
    <section className="sites container"><h2>{title}</h2><div>{pilots.map((s, i) => <article key={s}><Icon name={icons[i % icons.length]}/><b>{s}</b><small>Connecté · Opérationnel</small></article>)}</div></section>
  </PublicLayout>
}

/* ------------------------------------------------------------------ Events */
interface EventView { key: string; badge: string; title: string; date: string; text: string; location: string; href: string }


export function EventsPage() {
  const { lang } = useContext(LanguageContext)
  const pick = usePick()
  const fmt = useFormatDate()
  const [tab, setTab] = useState<'À venir' | 'Passé'>('À venir')
  const res = useAsync(() => api<{ upcoming: EventItem[]; past: EventItem[] }>('/public/events'), [])
  const view = (e: EventItem, upcoming: boolean): EventView => {
    const year = new Date(e.startsAt).getUTCFullYear()
    const sub = pick(e.subtitleFr, e.subtitleEn)
    const badge = upcoming ? (lang === 'en' ? `UPCOMING  ${year}` : `À VENIR  ${year}`) : (lang === 'en' ? `PAST  ${year}` : `PASSÉ  ${year}`)
    return { key: e.id, badge, title: pick(e.titleFr, e.titleEn), date: `${e.dateLabel || fmt(e.startsAt)}${sub ? ` · ${sub}` : ''}`, text: pick(e.descriptionFr, e.descriptionEn), location: e.location, href: `/evenements/${e.slug}` }
  }
  let upcoming: EventView[] = [], past: EventView[] = []
  if (res.data) { upcoming = res.data.upcoming.map((e) => view(e, true)); past = res.data.past.map((e) => view(e, false)) }
  else if (res.error && STATIC_FALLBACK) { // explicit demo mode only → bundled prototype content
    const f = (e: typeof fallbackEvents[0]): EventView => ({ key: e.title + e.date, badge: e.status, title: e.title, date: e.date, text: e.text, location: '', href: '' })
    upcoming = fallbackEvents.slice(0, 3).map(f); past = fallbackEvents.slice(3).map(f)
  }
  const Item = ({ e }: { e: EventView }) => <article className="event-card" onClick={e.href ? () => go(e.href) : undefined} style={e.href ? { cursor: 'pointer' } : undefined}>{e.badge && <span className={e.badge.startsWith('À') || e.badge.startsWith('UP') ? 'upcoming' : 'past'}>{e.badge}</span>}<h3>{e.title}</h3><b>{e.date}</b><p>{e.text}</p></article>
  return <PublicLayout><div className="events-title"><h1>Événements</h1><p>suivez l’actualité et les activités de MaliREN  à venir et passés</p><small>⌖ Point G, FMOS  Bamako, Mali</small></div><section className="events-body container"><div className="tabs">{(['À venir', 'Passé'] as const).map(x => <button className={tab === x ? 'active' : ''} onClick={() => setTab(x)} key={x}>{x}</button>)}</div>
    {res.loading && !res.data ? <Loading/> : res.error && !res.data && !STATIC_FALLBACK ? <Unavailable/> : <div className={`event-columns ${tab === 'Passé' ? 'show-past' : ''}`}><div className="upcoming-column">{upcoming.length ? upcoming.map(e => <Item e={e} key={e.key}/>) : <Empty>Aucun événement à venir.</Empty>}</div><div className="past-column">{past.length ? past.map(e => <Item e={e} key={e.key}/>) : <Empty>Aucun événement passé.</Empty>}</div></div>}
  </section></PublicLayout>
}

/* ------------------------------------------------------------------ Contact */
export function Contact() {
  const { lang } = useContext(LanguageContext)
  const site = useSite()
  const pilots = usePilots()
  const [state, setState] = useState<{ sent: boolean; error: string; busy: boolean }>({ sent: false, error: '', busy: false })
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    const fd = new FormData(form)
    const name = String(fd.get('name') || '').trim(), email = String(fd.get('email') || '').trim(), message = String(fd.get('message') || '').trim()
    if (!name || !email || !message) return setState({ sent: false, busy: false, error: 'Veuillez remplir tous les champs obligatoires.' })
    setState({ sent: false, error: '', busy: true })
    try {
      await api('/public/contact', { method: 'POST', body: { name, email, subject: String(fd.get('subject') || '').trim() || undefined, message, consent: fd.get('consent') === 'on', locale: lang, website: String(fd.get('website') || '') } })
      form.reset()
      setState({ sent: true, error: '', busy: false })
    } catch (err) {
      const status = err instanceof ApiError ? err.status : 0
      const msg = status === 429 ? 'Trop de messages envoyés depuis cette adresse. Réessayez plus tard.' : status === 400 ? 'Veuillez vérifier vos informations : adresse e-mail valide et message d’au moins 5 caractères.' : 'Le service est momentanément indisponible. Réessayez plus tard.'
      setState({ sent: false, error: msg, busy: false })
    }
  }
  const title = lang === 'en' ? `${pilots.length} connected pilot sites` : `${pilots.length} sites pilotes connectés`
  return <PublicLayout><div className="contact-title"><h1>Contactez MaliREN</h1><p>Nous sommes à votre disposition pour toute question, partenariat ou demande de connexion</p></div><section className="contact-body container two-grid"><div><article className="panel contact-info"><h2>Informations de contact</h2><div className="contact-info-grid"><div><p><b>☎　Contact Technique<br/>　　{site.technicalContactName}</b><small>{`Tél : ${site.technicalContactPhone}`}</small></p><p><b>{`✉　Email : ${site.technicalContactEmail}`}</b></p><p><b>▧　Contact CEO<br/>　　{site.ceoName}</b><small>{`Email : ${site.ceoEmail}`}</small></p></div><div><p><b>♙　Adresse :<br/>　　NOC Point G</b><small>Network Operation Center, Point G,</small></p><p><b>⌖　Adresse :<br/>　　FMOS, Bamako</b><small>Network Operation Center, Point G,<br/>Faculté de Médecine et d’Odontostomatologie, Bamako, Mali</small></p></div></div></article><div className="network-info"><h2>Informations réseau</h2><div><span>{`ASN ${site.asn}`}</span><span>{`IPv4 ${site.ipv4Block}`}</span><span>{`Peering ${site.peering}`}</span></div><h3>{title}</h3><p>{pilots.map(x => <b key={x}>{x}</b>)}</p></div></div>
    <form className="panel form" onSubmit={submit} noValidate><h2>Formulaire de contact</h2><div className="field-row"><label>Nom complet<input name="name" placeholder="Votre nom et prénom" maxLength={120} autoComplete="name"/></label><label>Email<input name="email" type="email" placeholder="votre.email@institution.ml" maxLength={254} autoComplete="email"/></label></div><label>Objet<input name="subject" placeholder="Sujet de votre demande" maxLength={200}/></label><label>Message<textarea name="message" rows={2} placeholder="Décrivez votre demande, question ou besoin..." maxLength={5000}/></label>
      <input name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" style={{ position: 'absolute', left: '-9999px', width: 1, height: 1, opacity: 0 }}/>
      <label className="consent"><input type="checkbox" name="consent" required/> Je consens au traitement de mes données conformément à la politique de confidentialité</label>{state.error && <p className="error" role="alert">{state.error}</p>}{state.sent && <p className="success" role="status">Votre demande a bien été envoyée. Nous vous répondrons sous 24-48h ouvrées.</p>}<Button type="submit">{state.busy ? 'Envoi en cours…' : '⌁　Envoyer le message'}</Button><small>Nous répondons généralement sous 24-48h ouvrées.</small></form></section></PublicLayout>
}

/* ------------------------------------------------------------------ Listing */
interface CardView { key: string; category: string; date: string; title: string; text: string; href: string }
type ListType = 'Actualités' | 'Publications' | 'Institutions'
const SUBS: Record<ListType, string> = { Actualités: 'Les dernières nouvelles du réseau', Publications: 'Documents, guides et rapports', Institutions: 'Les membres et partenaires du réseau' }

export function Listing({ type }: { type: ListType }) {
  const pick = usePick()
  const fmt = useFormatDate()
  const path = type === 'Actualités' ? '/public/news' : type === 'Publications' ? '/public/publications' : '/public/institutions'
  const base = type === 'Actualités' ? '/actualites' : type === 'Publications' ? '/publications' : '/institutions'
  const res = useAsync(() => api<{ items: AnyItem[] }>(path), [path])
  let cards: CardView[] = []
  if (res.data) {
    cards = res.data.items.map((x) => type === 'Actualités'
      ? { key: x.id, category: x.category, date: fmt(x.publishedAt), title: pick(x.titleFr, x.titleEn), text: pick(x.excerptFr, x.excerptEn), href: `${base}/${x.slug}` }
      : type === 'Publications'
        ? { key: x.id, category: x.category, date: x.dateLabel || fmt(x.publishedAt), title: pick(x.titleFr, x.titleEn), text: pick(x.summaryFr, x.summaryEn), href: `${base}/${x.slug}` }
        : { key: x.id, category: x.kind === 'partner' ? 'Partenaire' : 'Membre', date: x.city, title: x.name, text: pick(x.descriptionFr, x.descriptionEn), href: `${base}/${x.slug}` })
  } else if (res.error && STATIC_FALLBACK && type === 'Actualités') {
    cards = fallbackNews.map((n) => ({ key: String(n.id), category: n.category, date: n.date, title: n.title, text: n.text, href: `${base}/${n.id}` }))
  }
  return <PublicLayout><PageHero title={type} sub={SUBS[type]}/><section className="section container">{res.loading && !res.data ? <Loading/> : res.error && !cards.length ? <Unavailable/> : cards.length ? <div className="three-grid">{cards.map(x => <article className="panel" key={x.key}><span className="tag green">{x.category}</span><small>{x.date}</small><h2>{x.title}</h2><p>{x.text}</p><Button kind="link" onClick={() => go(x.href)}>Consulter <Icon name="arrow"/></Button></article>)}</div> : <Empty>Aucun contenu disponible pour le moment.</Empty>}</section></PublicLayout>
}

/* ------------------------------------------------------------------ Detail */
export function Detail() {
  const pick = usePick()
  const fmt = useFormatDate()
  const [, section, ref] = location.pathname.split('/')
  const kind = section === 'evenements' ? 'events' : section === 'publications' ? 'publications' : section === 'institutions' ? 'institutions' : 'news'
  const res = useAsync(() => api<AnyItem>(`/public/${kind}/${encodeURIComponent(ref ?? '')}`), [kind, ref])
  const back = `/${section}`
  const backLabel = kind === 'events' ? 'Événements' : kind === 'publications' ? 'Publications' : kind === 'institutions' ? 'Institutions' : 'Actualités'

  if (res.loading && !res.data) return <PublicLayout><article className="article container"><Loading/></article></PublicLayout>
  if (res.error || !res.data) {
    // API unreachable: old static news items are still readable.
    const f = kind === 'news' ? fallbackNews.find((n) => String(n.id) === ref) : undefined
    if (STATIC_FALLBACK && f && res.error && !/not found/i.test(res.error)) return <PublicLayout><Article crumb={backLabel} back={back} category={f.category} title={f.title} lead={`${f.date} · Équipe MaliREN`} body={[f.text]}/></PublicLayout>
    return <PublicLayout><section className="not-found"><b>404</b><h1>Contenu introuvable</h1><p>La ressource demandée est introuvable ou a été déplacée.</p><Button onClick={() => go(back)}>Retour</Button></section></PublicLayout>
  }
  const d = res.data
  if (kind === 'news') return <PublicLayout><Article crumb={backLabel} back={back} category={d.category} title={pick(d.titleFr, d.titleEn)} lead={`${fmt(d.publishedAt)} · Équipe MaliREN`} cover={d.coverMediaId ? mediaUrl(d.coverMediaId) : undefined} body={paragraphs(pick(d.bodyFr, d.bodyEn))}/></PublicLayout>
  if (kind === 'events') return <PublicLayout><Article crumb={backLabel} back={back} category="Événement" title={pick(d.titleFr, d.titleEn)} lead={[d.dateLabel || fmt(d.startsAt), pick(d.subtitleFr, d.subtitleEn), d.location].filter(Boolean).join(' · ')} body={paragraphs(pick(d.descriptionFr, d.descriptionEn))}/></PublicLayout>
  if (kind === 'publications') {
    const href = d.fileMediaId ? mediaUrl(d.fileMediaId) : isHttp(d.externalUrl) ? d.externalUrl : ''
    return <PublicLayout><Article crumb={backLabel} back={back} category={d.category} title={pick(d.titleFr, d.titleEn)} lead={d.dateLabel || fmt(d.publishedAt)} body={paragraphs(pick(d.summaryFr, d.summaryEn))}>{href && <a className="btn primary" href={href} target="_blank" rel="noopener noreferrer"><Icon name="download"/> Télécharger</a>}</Article></PublicLayout>
  }
  return <PublicLayout><Article crumb={backLabel} back={back} category={d.kind === 'partner' ? 'Partenaire' : 'Membre'} title={d.name} lead={d.city} body={paragraphs(pick(d.descriptionFr, d.descriptionEn))}>{isHttp(d.websiteUrl) && <a className="btn primary" href={d.websiteUrl} target="_blank" rel="noopener noreferrer"><Icon name="globe"/> Visiter le site</a>}</Article></PublicLayout>
}

function Article({ crumb, back, category, title, lead, cover, body, children }: { crumb: string; back: string; category: string; title: string; lead: string; cover?: string; body: string[]; children?: ReactNode }) {
  return <article className="article container"><p className="crumb"><button onClick={() => go(back)}>{crumb}</button> / {category}</p><span className="tag green">{category}</span><h1>{title}</h1><p className="lead">{lead}</p><div className="article-cover">{cover ? <img src={cover} alt="" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'cover' }}/> : <Icon name="globe" size={72}/>}</div>{body.map((p, i) => <p key={i}>{p}</p>)}{children}<Button onClick={() => go('/contact')}>Contacter l’équipe</Button></article>
}

/* ------------------------------------------------------------------ Search */
export function SearchPage() {
  const pick = usePick()
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])
  const [busy, setBusy] = useState(false)
  const seq = useRef(0)
  useEffect(() => {
    const term = q.trim()
    if (term.length < 2) { setHits([]); return }
    const id = ++seq.current
    setBusy(true)
    const t = setTimeout(() => {
      api<{ results: SearchHit[] }>('/public/search', { query: { q: term } }).then((r) => { if (id === seq.current) setHits(r.results) }).catch(() => { if (id === seq.current) setHits([]) }).finally(() => { if (id === seq.current) setBusy(false) })
    }, 250)
    return () => clearTimeout(t)
  }, [q])
  const svc = q.trim().length >= 2 ? services.filter((s) => (s[0] + s[1]).toLowerCase().includes(q.trim().toLowerCase())) : []
  const route = (h: SearchHit) => `/${h.type === 'news' ? 'actualites' : h.type === 'events' ? 'evenements' : h.type}/${h.slug}`
  const total = hits.length + svc.length
  return <PublicLayout><PageHero title="Recherche" sub="Recherchez dans les contenus MaliREN"/><section className="section container search-page"><label><Icon name="search"/><input autoFocus value={q} onChange={e => setQ(e.target.value)} maxLength={100} placeholder="Actualités, services, ressources…"/></label><p>{q ? (busy ? 'Recherche en cours…' : `${total} résultat(s) pour « ${q} »`) : 'Saisissez un terme pour commencer.'}</p>
    {hits.map(h => <button className="search-result" key={h.type + h.slug} onClick={() => go(route(h))}><span>{h.category}</span><h3>{pick(h.titleFr, h.titleEn)}</h3><p>{pick(h.textFr, h.textEn)}</p></button>)}
    {svc.map(s => <button className="search-result" key={s[0]} onClick={() => go('/services')}><span>Service</span><h3>{s[0]}</h3><p>{s[1]}</p></button>)}</section></PublicLayout>
}

/* ------------------------------------------------------------------ Legal */
export function Legal() {
  const pick = usePick()
  const slug = location.pathname.includes('confidentialite') ? 'confidentialite' : 'mentions'
  const res = useAsync(() => api<PageItem>(`/public/pages/${slug}`), [slug])
  const title = slug === 'confidentialite' ? 'Politique de confidentialité' : 'Mentions légales'
  const page = res.data
  return <PublicLayout><PageHero title={page ? pick(page.titleFr, page.titleEn) : title} sub="Informations légales  contenu éditable"/><article className="article container">
    {(!page || page.isDemo) && <div className="notice">Contenu de démonstration à valider et remplacer par le texte officiel de MaliREN.</div>}
    {res.loading && !page ? <Loading/> : page ? paragraphs(pick(page.bodyFr, page.bodyEn)).map((p, i) => <p key={i}>{p}</p>) : <><h2>Objet</h2><p>Cette page présente les informations générales relatives au site MaliREN. Les textes définitifs seront publiés après validation institutionnelle.</p></>}
  </article></PublicLayout>
}

