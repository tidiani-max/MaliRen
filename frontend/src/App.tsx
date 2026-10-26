import { useEffect, useMemo, useState } from 'react'
import { AdminApp } from './admin/AdminApp'
import { AuthProvider } from './admin/auth'
import { LoginPage } from './admin/Login'
import type { Language } from './i18n'
import { Localizer, PublicLayout } from './layout'
import { Contact, Detail, EventsPage, Home, Legal, Listing, SearchPage } from './pages'
import { About, Achievements, Resources, Services } from './staticPages'
import { Button, LanguageContext, go } from './ui'

function NotFound() {
  return <PublicLayout><section className="not-found"><b>404</b><h1>Cette page n’existe pas</h1><p>La ressource demandée est introuvable ou a été déplacée.</p><Button onClick={() => go('/')}>Retour à l’accueil</Button></section></PublicLayout>
}

function App() {
  const [path, setPath] = useState(location.pathname)
  const [lang, setLanguage] = useState<Language>(() => localStorage.getItem('maliren-language') === 'en' ? 'en' : 'fr')
  const setLang = (value: Language) => { localStorage.setItem('maliren-language', value); setLanguage(value) }
  useEffect(() => { const f = () => setPath(location.pathname); addEventListener('popstate', f); return () => removeEventListener('popstate', f) }, [])
  const page = useMemo(() => {
    if (path === '/') return <Home/>
    if (path === '/a-propos') return <About/>
    if (path === '/services') return <Services/>
    if (path === '/ressources') return <Resources/>
    if (path === '/evenements') return <EventsPage/>
    if (path === '/realisations') return <Achievements/>
    if (path === '/contact') return <Contact/>
    if (path === '/actualites') return <Listing type="Actualités"/>
    if (path === '/publications') return <Listing type="Publications"/>
    if (path === '/institutions') return <Listing type="Institutions"/>
    if (path === '/recherche') return <SearchPage/>
    // One AuthProvider for every /admin screen so signing in does not remount (and re-authenticate) the session.
    if (path === '/admin' || path.startsWith('/admin/')) return <AuthProvider>{path === '/admin/login' ? <LoginPage/> : <AdminApp/>}</AuthProvider>
    if (path === '/confidentialite' || path === '/mentions') return <Legal/>
    if (/^\/(actualites|evenements|publications|institutions)\/[^/]+$/.test(path)) return <Detail key={path}/>
    return <NotFound/>
  }, [path])
  return <LanguageContext.Provider value={{ lang, setLang }}><Localizer lang={lang} path={path}/>{page}</LanguageContext.Provider>
}
export default App
