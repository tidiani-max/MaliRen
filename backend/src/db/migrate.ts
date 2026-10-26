import 'dotenv/config'
import fs from 'node:fs'
import path from 'node:path'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { createDb, type Db } from './client'
import { loadEnv } from '../config/env'

/** Works from both src/db (tsx) and dist/src/db (compiled). */
function migrationsFolder() {
  for (const rel of ['../../migrations', '../../../migrations']) {
    const p = path.resolve(__dirname, rel)
    if (fs.existsSync(path.join(p, 'meta', '_journal.json'))) return p
  }
  throw new Error('Migrations folder not found')
}

export async function runMigrations(db: Db) {
  await migrate(db, { migrationsFolder: migrationsFolder() })
}

if (require.main === module) {
  const env = loadEnv()
  const { db, pool } = createDb(env.DATABASE_URL, 2)
  runMigrations(db)
    .then(() => console.log('✔ Migrations applied'))
    .catch((e) => {
      console.error('✖ Migration failed', e)
      process.exitCode = 1
    })
    .finally(() => pool.end())
}
