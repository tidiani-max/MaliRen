import type { Request } from 'express'
import { auditLog } from '../db/schema'
import type { DbOrTx } from '../db/client'

export interface Actor { id: string | null; label: string }

export const SYSTEM: Actor = { id: null, label: 'system' }

export async function audit(
  db: DbOrTx,
  actor: Actor,
  action: string,
  entity: string,
  entityId: string | null,
  summary = '',
  meta?: unknown,
  req?: Request,
) {
  await db.insert(auditLog).values({
    actorId: actor.id,
    actorLabel: actor.label,
    action,
    entity,
    entityId,
    summary: summary.slice(0, 500),
    meta: meta === undefined ? null : meta,
    ip: req?.ip ?? null,
  })
}

/** Shallow diff of changed keys, with long strings truncated, for audit metadata. */
export function diff(before: Record<string, unknown>, patch: Record<string, unknown>) {
  const out: Record<string, { from: unknown; to: unknown }> = {}
  const cut = (v: unknown) => (typeof v === 'string' && v.length > 200 ? v.slice(0, 200) + '…' : v instanceof Date ? v.toISOString() : v)
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue
    const a = before[k]
    if (JSON.stringify(a) !== JSON.stringify(v)) out[k] = { from: cut(a), to: cut(v) }
  }
  return out
}
