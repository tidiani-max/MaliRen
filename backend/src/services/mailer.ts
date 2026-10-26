import nodemailer from 'nodemailer'
import { eq, sql } from 'drizzle-orm'
import type { Env } from '../config/env'
import type { Db } from '../db/client'
import type { Logger } from '../logger'
import { emailLog } from '../db/schema'

export interface Mailer {
  mode: 'log' | 'smtp'
  send(msg: { to: string; subject: string; text: string }): Promise<'sent' | 'logged'>
}

export function createMailer(env: Env, logger: Logger): Mailer {
  if (env.MAIL_MODE === 'log') {
    return {
      mode: 'log',
      async send(msg) {
        logger.info({ to: msg.to, subject: msg.subject }, `[mail:log] ${msg.subject}\n${msg.text}`)
        return 'logged'
      },
    }
  }
  const transport = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
  })
  return {
    mode: 'smtp',
    async send(msg) {
      await transport.sendMail({ from: env.MAIL_FROM, to: msg.to, subject: msg.subject, text: msg.text })
      return 'sent'
    },
  }
}

/**
 * Idempotent send: a row with the same dedupeKey that is already sent/logged is never sent again,
 * so job retries and double-enqueues cannot spam recipients. Failed rows are retried.
 */
export async function sendEmail(
  ctx: { db: Db; mailer: Mailer; logger: Logger },
  msg: { to: string; subject: string; text: string; dedupeKey: string },
): Promise<'sent' | 'logged' | 'skipped' | 'failed'> {
  const inserted = await ctx.db
    .insert(emailLog)
    .values({ toAddress: msg.to, subject: msg.subject, body: msg.text, dedupeKey: msg.dedupeKey })
    .onConflictDoNothing({ target: emailLog.dedupeKey })
    .returning({ id: emailLog.id })
  let rowId = inserted[0]?.id
  if (!rowId) {
    const [existing] = await ctx.db.select().from(emailLog).where(eq(emailLog.dedupeKey, msg.dedupeKey))
    if (!existing || existing.status === 'sent' || existing.status === 'logged') return 'skipped'
    rowId = existing.id
  }
  try {
    const status = await ctx.mailer.send(msg)
    await ctx.db.update(emailLog).set({ status, sentAt: new Date(), error: null, attempts: sql`${emailLog.attempts} + 1` }).where(eq(emailLog.id, rowId))
    return status
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    await ctx.db.update(emailLog).set({ status: 'failed', error, attempts: sql`${emailLog.attempts} + 1` }).where(eq(emailLog.id, rowId))
    ctx.logger.warn({ to: msg.to, error }, 'email failed')
    return 'failed'
  }
}
