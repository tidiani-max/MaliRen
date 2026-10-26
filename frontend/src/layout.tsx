import { ReactNode, useContext, useEffect, useState } from 'react'
import { EN, FR, Language } from './i18n'
import { Icon, LanguageContext, Logo, go } from './ui'
import { useSite, usePartners } from './api/hooks'

export type Route = { path: string; label: string }
export const NAV: Route[] = [
  { path: '/', label: 'Accueil' }, { path: '/a-propos', label: 'À propos' },
  { path: '/evenements', label: 'Événement' }, { path: '/realisations', label: 'Réalisation' },
  { path: '/ressources', label: 'Ressource' }, { path: '/services', label: 'Services' },
  { path: '/contact', label: 'Contact' },
]

export function Header() {
  const [open, setOpen] = useState(false)
  const {lang,setLang}=useContext(LanguageContext)
  return <header className="header"><div className="nav-wrap"><Logo/><button className="mobile-toggle" onClick={() => setOpen(!open)} aria-label="Ouvrir le menu"><Icon name={open ? 'close' : 'menu'}/></button>
    <nav className={open ? 'open' : ''} aria-label="Navigation principale">{NAV.map(n => <button key={n.path} className={location.pathname === n.path ? 'active' : ''} onClick={() => {go(n.path);setOpen(false)}}>{lang==='en'?(EN[n.label]||n.label):n.label}</button>)}
      <button className="search-btn" onClick={() => go('/recherche')} aria-label="Rechercher"><Icon name="search"/></button>
    </nav><div className="languages" aria-label="Language"><button className={lang==='fr'?'active':''} onClick={()=>setLang('fr')} aria-pressed={lang==='fr'}>FR</button><button className={lang==='en'?'active':''} onClick={()=>setLang('en')} aria-pressed={lang==='en'}>EN</button></div></div></header>
}

export function Footer() {
  const site = useSite()
  const partners = usePartners()
  return <footer><div className="footer-main container"><div><h3>Partenaires</h3><div className="partners">{partners.map(p => <span key={p}>{p}</span>)}</div></div><div><h3>Contacts</h3><p><b>Contact Technique</b>  {`${site.technicalContactName} ☎ ${site.technicalContactPhone}`}</p><p><b>Contact CEO</b>  {`${site.ceoName}　　✉ ${site.ceoEmail}`}</p></div></div><div className="footer-bottom">© 2024 MaliREN  Réseau National d’Éducation et de Recherche du Mali　•　Tous droits réservés　•　<button onClick={() => go('/mentions')}>Mentions légales</button>　•　<button onClick={() => go('/confidentialite')}>Politique de confidentialité</button></div></footer>
}

export function PublicLayout({ children }: { children: ReactNode }) { return <><Header/><main>{children}</main><Footer/></> }

export function PageHero({ title, sub }: { title: string; sub: string }) { return <section className="page-hero container"><p className="crumb"><button onClick={() => go('/')}>Accueil</button> / {title}</p><h1>{title}</h1><p>{sub}</p><i/></section> }

/**
 * Static strings are translated by dictionary. Because pages now load data asynchronously, the pass is re-run
 * (debounced) whenever the DOM subtree changes. Admin and login screens are French-only and are skipped.
 */
export function Localizer({ lang, path }: { lang: Language; path: string }) {
  useEffect(() => {
    document.documentElement.lang = lang
    const dictionary: Record<string, string> = lang === 'en' ? EN : FR
    const translate = () => {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
      let node: Node | null
      while ((node = walker.nextNode())) {
        const parent = node.parentElement
        if (!parent || ['SCRIPT', 'STYLE', 'OPTION', 'TEXTAREA'].includes(parent.tagName) || parent.closest('.admin, .login')) continue
        const text = node.nodeValue || '', key = text.trim()
        if (dictionary[key]) node.nodeValue = text.replace(key, dictionary[key])
      }
      document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('[placeholder]').forEach(el => {
        if (el.closest('.admin, .login')) return
        const original = el.dataset.ph || el.placeholder
        const fr = FR[original] ? FR[original] : original
        el.dataset.ph = fr
        el.placeholder = lang === 'en' ? (EN[fr] || fr) : fr
      })
    }
    translate()
    let raf = 0
    const observer = new MutationObserver(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(translate) })
    observer.observe(document.body, { childList: true, subtree: true })
    return () => { observer.disconnect(); cancelAnimationFrame(raf) }
  }, [lang, path])
  return null
}
