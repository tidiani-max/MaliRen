import { and, count, eq, gte, lt, sql } from 'drizzle-orm'
import type { Db } from '../db/client'
import { auditLog, events, institutions, news, pages, publications, submissions } from '../db/schema'

const iso = (d: Date) => d.toISOString()

/** Everything shown on the Reports page and in digests is computed from live data. */
export async function buildSummary(db: Db, from: Date, to: Date) {
  const inRange = (col: Parameters<typeof gte>[0]) => and(gte(col, from), lt(col, to))
  const [subByStatus, subTotal, handled, byMonth, contentCounts, instCounts, topActions] = await Promise.all([
    db.select({ status: submissions.status, n: count() }).from(submissions).where(inRange(submissions.createdAt)).groupBy(submissions.status),
    db.select({ n: count() }).from(submissions).where(inRange(submissions.createdAt)),
    db.select({ avgHours: sql<number | null>`avg(extract(epoch from (${submissions.handledAt} - ${submissions.createdAt})) / 3600)` }).from(submissions).where(and(eq(submissions.status, 'handled'), inRange(submissions.createdAt))),
    db.execute(sql`select to_char(date_trunc('month', created_at), 'YYYY-MM') as month, count(*)::int as n from submissions where created_at >= ${from} and created_at < ${to} group by 1 order by 1`),
    Promise.all([news, events, publications, pages].map(async (t, i) => {
      const rows = await db.select({ status: t.status, n: count() }).from(t).groupBy(t.status)
      return { type: ['news', 'events', 'publications', 'pages'][i], byStatus: Object.fromEntries(rows.map((r) => [r.status, r.n])) }
    })),
    db.select({ kind: institutions.kind, status: institutions.status, n: count() }).from(institutions).groupBy(institutions.kind, institutions.status),
    db.select({ action: auditLog.action, n: count() }).from(auditLog).where(inRange(auditLog.createdAt)).groupBy(auditLog.action).orderBy(sql`count(*) desc`).limit(8),
  ])
  const [open] = await db.select({ n: count() }).from(submissions).where(sql`${submissions.status} in ('new','in_progress')`)
  return {
    period: { from: iso(from), to: iso(to) },
    submissions: {
      total: subTotal[0].n,
      byStatus: Object.fromEntries(subByStatus.map((r) => [r.status, r.n])),
      openNow: open.n,
      avgHoursToHandle: handled[0].avgHours === null ? null : Math.round(Number(handled[0].avgHours) * 10) / 10,
      byMonth: byMonth.rows as { month: string; n: number }[],
    },
    content: contentCounts,
    institutions: instCounts,
    topActions,
  }
}

export type Summary = Awaited<ReturnType<typeof buildSummary>>

export function summaryToText(title: string, s: Summary): string {
  const st = s.submissions.byStatus as Record<string, number>
  const c = (type: string) => (s.content.find((x) => x.type === type)?.byStatus ?? {}) as Record<string, number>
  return [
    title,
    `Période : ${s.period.from.slice(0, 10)} → ${s.period.to.slice(0, 10)}`,
    '',
    `Demandes reçues : ${s.submissions.total} (nouvelles ${st.new ?? 0}, en cours ${st.in_progress ?? 0}, traitées ${st.handled ?? 0}, indésirables ${st.spam ?? 0})`,
    `Demandes encore ouvertes : ${s.submissions.openNow}`,
    `Délai moyen de traitement : ${s.submissions.avgHoursToHandle ?? 'n/a'} h`,
    '',
    `Actualités publiées : ${c('news').published ?? 0} · brouillons : ${c('news').draft ?? 0}`,
    `Événements publiés : ${c('events').published ?? 0} · brouillons : ${c('events').draft ?? 0}`,
    `Publications publiées : ${c('publications').published ?? 0} · brouillons : ${c('publications').draft ?? 0}`,
  ].join('\n')
}
