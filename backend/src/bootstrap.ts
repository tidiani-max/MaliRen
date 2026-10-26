import { loadEnv, type Env } from './config/env'
import { createDb } from './db/client'
import { createLogger } from './logger'
import { createMailer } from './services/mailer'
import type { AppContext } from './context'

export function createContext(env: Env = loadEnv()): AppContext {
  const logger = createLogger(env)
  const { db, pool } = createDb(env.DATABASE_URL)
  return { env, db, pool, logger, mailer: createMailer(env, logger) }
}
