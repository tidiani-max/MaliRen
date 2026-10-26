import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import * as schema from './schema'

export type Db = NodePgDatabase<typeof schema>
/** A transaction handle is structurally compatible with Db for our purposes. */
export type DbOrTx = Pick<Db, 'select' | 'insert' | 'update' | 'delete' | 'execute'>

export function createDb(url: string, max = 10): { db: Db; pool: Pool } {
  const pool = new Pool({ connectionString: url, max })
  return { db: drizzle(pool, { schema }), pool }
}
