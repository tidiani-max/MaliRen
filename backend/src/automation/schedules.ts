import type { Db } from '../db/client'
import { automationSchedules } from '../db/schema'

export interface ScheduleDef {
  name: string
  label: string
  description: string
  kind: 'interval' | 'daily' | 'weekly'
  intervalMinutes?: number
  atHour?: number
  atMinute?: number
  weekday?: number
  enabled: boolean
  config: Record<string, unknown>
}

/** Defaults. Everything can be disabled/changed in Admin → Paramètres → Automatisations or with AUTOMATIONS_ENABLED=false. */
export const DEFAULT_SCHEDULES: ScheduleDef[] = [
  { name: 'publish_scheduled', label: 'Publication programmée', description: 'Publie automatiquement les contenus dont la date de publication est atteinte.', kind: 'interval', intervalMinutes: 1, enabled: true, config: {} },
  { name: 'unhandled_submission_reminder', label: 'Rappel des demandes non traitées', description: 'Un seul e-mail récapitulatif par destinataire et par jour pour les demandes en attente.', kind: 'interval', intervalMinutes: 60, enabled: true, config: { afterHours: 48, cooldownHours: 24, maxReminders: 3 } },
  { name: 'upcoming_reminder', label: 'Rappel événements & publications', description: 'Prévient les équipes des événements proches et des publications programmées.', kind: 'daily', atHour: 8, atMinute: 0, enabled: true, config: { eventDaysAhead: 7, publicationHoursAhead: 48 } },
  { name: 'digest', label: 'Rapport périodique (digest)', description: 'Génère un rapport (quotidien ou hebdomadaire) et l’envoie aux destinataires configurés. Désactivé par défaut.', kind: 'weekly', weekday: 1, atHour: 7, atMinute: 0, enabled: false, config: { frequency: 'weekly' } },
  { name: 'cleanup', label: 'Nettoyage', description: 'Supprime les téléversements temporaires expirés, les sessions expirées et les anciennes tâches.', kind: 'daily', atHour: 3, atMinute: 0, enabled: true, config: { jobRetentionDays: 30 } },
]

type Sched = Pick<ScheduleDef, 'kind' | 'intervalMinutes' | 'atHour' | 'atMinute' | 'weekday'>

/** Next occurrence strictly after `from`. Daily/weekly times are UTC (Mali is UTC+0 all year). */
export function computeNextRun(s: Sched, from: Date): Date {
  if (s.kind === 'interval') return new Date(from.getTime() + Math.max(1, s.intervalMinutes ?? 60) * 60_000)
  const next = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate(), s.atHour ?? 0, s.atMinute ?? 0, 0, 0))
  if (s.kind === 'daily') {
    if (next <= from) next.setUTCDate(next.getUTCDate() + 1)
    return next
  }
  const wd = s.weekday ?? 1
  let add = (wd - next.getUTCDay() + 7) % 7
  if (add === 0 && next <= from) add = 7
  next.setUTCDate(next.getUTCDate() + add)
  return next
}

export async function ensureSchedules(db: Db, now = new Date()) {
  for (const d of DEFAULT_SCHEDULES) {
    await db
      .insert(automationSchedules)
      .values({ name: d.name, enabled: d.enabled, kind: d.kind, intervalMinutes: d.intervalMinutes ?? null, atHour: d.atHour ?? null, atMinute: d.atMinute ?? 0, weekday: d.weekday ?? null, config: d.config, nextRunAt: computeNextRun(d, now) })
      .onConflictDoNothing({ target: automationSchedules.name })
  }
}
