import type { Pool } from 'pg'
import type { Env } from './config/env'
import type { Db } from './db/client'
import type { Logger } from './logger'
import type { Mailer } from './services/mailer'

export interface AppContext {
  env: Env
  db: Db
  pool: Pool
  logger: Logger
  mailer: Mailer
}
