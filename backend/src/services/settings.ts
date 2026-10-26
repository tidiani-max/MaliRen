import { eq } from 'drizzle-orm'
import { z } from 'zod'
import type { DbOrTx } from '../db/client'
import { settings } from '../db/schema'

export const siteSettingsSchema = z.object({
  technicalContactName: z.string().max(120).default(''),
  technicalContactPhone: z.string().max(80).default(''),
  technicalContactEmail: z.string().max(200).default(''),
  ceoName: z.string().max(120).default(''),
  ceoEmail: z.string().max(200).default(''),
  supportEmail: z.string().max(200).default(''),
  addressLine: z.string().max(300).default(''),
  asn: z.string().max(40).default(''),
  ipv4Block: z.string().max(60).default(''),
  peering: z.string().max(60).default(''),
})
export type SiteSettings = z.infer<typeof siteSettingsSchema>

export const notificationSettingsSchema = z.object({
  /** Extra e-mail recipients (besides active admins when `notifyAdmins` is true). */
  recipients: z.array(z.string().email()).max(20).default([]),
  notifyAdmins: z.boolean().default(true),
  notifyOnContact: z.boolean().default(true),
})
export type NotificationSettings = z.infer<typeof notificationSettingsSchema>

export const SETTING_SCHEMAS = { site: siteSettingsSchema, notifications: notificationSettingsSchema } as const
export type SettingKey = keyof typeof SETTING_SCHEMAS

export async function getSetting<K extends SettingKey>(db: DbOrTx, key: K): Promise<z.infer<(typeof SETTING_SCHEMAS)[K]>> {
  const [row] = await db.select().from(settings).where(eq(settings.key, key))
  return SETTING_SCHEMAS[key].parse(row?.value ?? {}) as z.infer<(typeof SETTING_SCHEMAS)[K]>
}

export async function putSetting(db: DbOrTx, key: SettingKey, value: unknown, userId: string | null) {
  await db
    .insert(settings)
    .values({ key, value: value as object, updatedBy: userId })
    .onConflictDoUpdate({ target: settings.key, set: { value: value as object, updatedBy: userId, updatedAt: new Date() } })
}
