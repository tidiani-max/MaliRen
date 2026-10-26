import { createContext, ReactNode } from 'react'
import type { Language } from './i18n'

export const LanguageContext = createContext<{lang:Language;setLang:(value:Language)=>void}>({lang:'fr',setLang:()=>{}})

export function Icon({ name, size = 20 }: { name: string; size?: number }) {
  const paths: Record<string, ReactNode> = {
    menu: <><path d="M4 7h16M4 12h16M4 17h16" /></>,
    close: <><path d="m6 6 12 12M18 6 6 18" /></>,
    arrow: <><path d="M5 12h14m-5-5 5 5-5 5" /></>,
    check: <><path d="m5 12 4 4L19 6" /></>,
    globe: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18" /></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M8 3v4m8-4v4M3 10h18" /></>,
    file: <><path d="M6 3h8l4 4v14H6zM14 3v5h5M9 13h6m-6 4h6" /></>,
    search: <><circle cx="10" cy="10" r="6" /><path d="m15 15 5 5" /></>,
    mail: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></>,
    chart: <><path d="M4 20V10m6 10V4m6 16v-7m4 7H2" /></>,
    users: <><circle cx="9" cy="8" r="3" /><circle cx="17" cy="9" r="2" /><path d="M3 20c0-4 2-7 6-7s6 3 6 7m0-5c3 0 5 2 5 5" /></>,
    edit: <><path d="M4 20h4L19 9l-4-4L4 16zM13 7l4 4" /></>,
    trash: <><path d="M4 7h16M10 11v6m4-6v6M6 7l1 13h10l1-13M9 7V4h6v3" /></>,
    bell: <><path d="M6 17V11a6 6 0 0 1 12 0v6l2 2H4zM10 21h4" /></>,
    plus: <><path d="M12 5v14M5 12h14" /></>,
    logout: <><path d="M10 4H5v16h5M15 8l4 4-4 4M19 12H9" /></>,
    download: <><path d="M12 4v11m-5-4 5 5 5-5M5 20h14" /></>,
    upload: <><path d="M12 16V5m-5 4 5-5 5 5M5 20h14" /></>,
    image: <><rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="9" cy="10" r="1.5" /><path d="m4 18 5-5 4 3 3-3 4 4" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="M12 3v3m0 12v3M3 12h3m12 0h3M5.6 5.6l2.1 2.1m8.6 8.6 2.1 2.1m0-12.8-2.1 2.1M7.7 16.3l-2.1 2.1" /></>,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    eye: <><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>,
    shield: <><path d="M12 3 5 6v6c0 4 3 7 7 9 4-2 7-5 7-9V6z" /></>,
    refresh: <><path d="M20 11a8 8 0 0 0-14-4M4 4v4h4M4 13a8 8 0 0 0 14 4m2 3v-4h-4" /></>,
  }
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name] || paths.arrow}</svg>
}

export function Logo({ light = false }: { light?: boolean }) {
  return <button className={`logo ${light ? 'light' : ''}`} onClick={() => go('/') } aria-label="MaliREN  Accueil"><img src="/assets/maliren-logo.jpg" alt="MaliREN"/></button>
}
export function go(path: string) { history.pushState({}, '', path); window.dispatchEvent(new PopStateEvent('popstate')); scrollTo(0, 0) }

export function Button({ children, onClick, kind = 'primary', type = 'button' }: { children: ReactNode; onClick?: () => void; kind?: string; type?: 'button'|'submit' }) { return <button type={type} className={`btn ${kind}`} onClick={onClick}>{children}</button> }
