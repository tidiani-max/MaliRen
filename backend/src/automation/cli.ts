import 'dotenv/config'
import { createDb } from '../db/client'
import { loadEnv } from '../config/env'
import { createLogger } from '../logger'
import { createMailer } from '../services/mailer'
import type { AppContext } from '../context'
import { AUTOMATION_NAMES, handlers } from './handlers'
import { ensureSchedules } from './schedules'

/**
 * Usage: npm run automation:run -- <name|all|list> [--dry-run] [--now=2026-12-01T09:00:00Z]
 * Runs an automation immediately (bypassing the queue). --dry-run reports what would happen and changes nothing.
 * --now simulates the current time, so reminders can be demonstrated without waiting.
 */
async function main() {
  const [target, ...flags] = process.argv.slice(2)
  const dryRun = flags.includes('--dry-run')
  const nowFlag = flags.find((f) => f.startsWith('--now='))?.slice(6)
  const now = nowFlag ? new Date(nowFlag) : undefined
  if (now && Number.isNaN(now.getTime())) throw new Error('Invalid --now value')
  if (!target || target === 'list') {
    console.log('Available automations:', AUTOMATION_NAMES.join(', '), '\nExample: npm run automation:run -- unhandled_submission_reminder --dry-run')
    return
  }
  const env = loadEnv()
  const logger = createLogger({ ...env, LOG_LEVEL: 'warn' })
  const { db, pool } = createDb(env.DATABASE_URL, 2)
  const ctx = { env, db, pool, logger, mailer: createMailer(env, logger) } as AppContext
  try {
    await ensureSchedules(db)
    const names = target === 'all' ? AUTOMATION_NAMES : [target]
    for (const n of names) {
      const h = handlers[`automation:${n}`]
      if (!h) throw new Error(`Unknown automation "${n}". Use: ${AUTOMATION_NAMES.join(', ')}`)
      const result = await h(ctx, {}, { dryRun, now })
      console.log(`\n▶ ${n}${dryRun ? ' (dry-run)' : ''}\n`, JSON.stringify(result, null, 2))
    }
  } finally {
    await pool.end()
  }
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1 })
