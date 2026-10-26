import { sql } from 'drizzle-orm'
import { createDb } from '../src/db/client'
import { runMigrations } from '../src/db/migrate'

/** Fresh schema once per test run, using the real migration files. */
export default async function setup() {
  const url = process.env.TEST_DATABASE_URL ?? 'postgresql://maliren:maliren@localhost:5432/maliren_test'
  const { db, pool } = createDb(url, 2)
  await db.execute(sql`drop schema if exists public cascade`)
  await db.execute(sql`drop schema if exists drizzle cascade`)
  await db.execute(sql`create schema public`)
  await runMigrations(db)
  await pool.end()
}
