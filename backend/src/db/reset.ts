import 'dotenv/config'
import { sql } from 'drizzle-orm'
import { createDb } from './client'
import { loadEnv } from '../config/env'
import { runMigrations } from './migrate'

/** Destroys ALL data: drops the schema, re-applies migrations. Run `npm run db:seed` afterwards. */
async function main() {
  const env = loadEnv()
  if (env.isProd) throw new Error('Refusing to reset a production database.')
  if (!process.argv.includes('--yes')) throw new Error('This deletes ALL data. Re-run with: npm run db:reset -- --yes')
  const { db, pool } = createDb(env.DATABASE_URL, 2)
  try {
    await db.execute(sql`drop schema if exists public cascade`)
    await db.execute(sql`drop schema if exists drizzle cascade`)
    await db.execute(sql`create schema public`)
    await runMigrations(db)
    console.log('✔ Database reset and migrated. Now run: npm run db:seed')
  } finally {
    await pool.end()
  }
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1 })
