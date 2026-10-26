import { and, inArray, eq } from 'drizzle-orm'
import type { Db } from '../db/client'
import { notifications, users } from '../db/schema'
import { getSetting } from './settings'
import type { Env } from '../config/env'

/** Active staff who should hear about operational events (everyone except read-only reviewers). */
export async function staffRecipients(db: Db, env: Env) {
  const cfg = await getSetting(db, 'notifications')
  const staff = cfg.notifyAdmins
    ? await db.select({ id: users.id, email: users.email }).from(users).where(and(eq(users.active, true), inArray(users.role, ['super_admin', 'admin', 'editor'])))
    : []
  const extra = [...cfg.recipients, ...env.ADMIN_NOTIFY_EMAIL.split(',').map((s) => s.trim()).filter(Boolean)]
  const emails = [...new Set([...staff.map((s) => s.email.toLowerCase()), ...extra.map((e) => e.toLowerCase())])].slice(0, 20)
  return { userIds: staff.map((s) => s.id), emails, cfg }
}

export async function notifyUsers(
  db: Db,
  userIds: string[],
  n: { type: string; title: string; body?: string; link?: string; dedupeKey: string },
) {
  if (!userIds.length) return 0
  const rows = await db
    .insert(notifications)
    .values(userIds.map((userId) => ({ userId, type: n.type, title: n.title, body: n.body ?? '', link: n.link ?? '', dedupeKey: n.dedupeKey })))
    .onConflictDoNothing()
    .returning({ id: notifications.id })
  return rows.length
}
