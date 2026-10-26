import { DependencyList, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { LanguageContext } from '../ui'
import { api } from './client'
import type { InstitutionItem, SiteSettings } from './types'

export interface AsyncState<T> { data: T | null; loading: boolean; error: string | null; reload: () => void }

/** Fetch on mount / when deps change; ignores stale responses. */
export function useAsync<T>(fn: () => Promise<T>, deps: DependencyList): AsyncState<T> {
  const [state, setState] = useState<{ data: T | null; loading: boolean; error: string | null }>({ data: null, loading: true, error: null })
  const [tick, setTick] = useState(0)
  const seq = useRef(0)
  useEffect(() => {
    const id = ++seq.current
    setState((s) => ({ ...s, loading: true, error: null }))
    fn().then(
      (data) => { if (id === seq.current) setState({ data, loading: false, error: null }) },
      (e: Error) => { if (id === seq.current) setState((s) => ({ data: s.data, loading: false, error: e.message || 'Erreur' })) },
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick])
  const reload = useCallback(() => setTick((n) => n + 1), [])
  return { ...state, reload }
}

/** Bilingual field helper: English if requested and present, otherwise French. */
export function usePick() {
  const { lang } = useContext(LanguageContext)
  return useCallback((fr: string, en: string) => (lang === 'en' && en ? en : fr), [lang])
}

export function useFormatDate() {
  const { lang } = useContext(LanguageContext)
  return useCallback((iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString(lang === 'en' ? 'en-GB' : 'fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : ''), [lang])
}

// ---- site settings & institutions are tiny and shared by header/footer/home/contact: fetch once per page load.
export const SITE_DEFAULTS: SiteSettings = {
  technicalContactName: 'Cheickné H. DIAWARA', technicalContactPhone: '73489490 / 60397355', technicalContactEmail: 'cheick.diawara@usttb.edu.ml',
  ceoName: 'Pierre Claver B. Traore', ceoEmail: 'pcbako.traore@usttb.edu.ml', supportEmail: '',
  addressLine: '', asn: 'AS328318', ipv4Block: '196.50.16.0/22', peering: 'MLIX',
}
let sitePromise: Promise<SiteSettings> | null = null
let instPromise: Promise<InstitutionItem[]> | null = null

export function useSite(): SiteSettings {
  const [site, setSite] = useState<SiteSettings>(SITE_DEFAULTS)
  useEffect(() => {
    sitePromise ??= api<SiteSettings>('/public/site').catch((e) => { sitePromise = null; throw e })
    sitePromise.then((s) => setSite({ ...SITE_DEFAULTS, ...Object.fromEntries(Object.entries(s).filter(([, v]) => v !== '')) } as SiteSettings)).catch(() => undefined)
  }, [])
  return site
}

export function useInstitutions(): InstitutionItem[] | null {
  const [items, setItems] = useState<InstitutionItem[] | null>(null)
  useEffect(() => {
    instPromise ??= api<{ items: InstitutionItem[] }>('/public/institutions').then((r) => r.items).catch((e) => { instPromise = null; throw e })
    instPromise.then(setItems).catch(() => setItems(null))
  }, [])
  return items
}

export const FALLBACK_PILOTS = ['USTTB-FST', 'USTTB-FMOS&FAPH', 'LCV', 'IER', 'ENI-ABT']
export const FALLBACK_PARTNERS = ['WACREN', 'GÉANT', 'Afribone', 'ISOC-Mali']
export const usePilots = () => { const i = useInstitutions(); return i ? i.filter((x) => x.kind === 'pilot').map((x) => x.name) : FALLBACK_PILOTS }
export const usePartners = () => { const i = useInstitutions(); const p = i?.filter((x) => x.kind === 'partner').map((x) => x.name); return p && p.length ? p : FALLBACK_PARTNERS }
