import 'dotenv/config'
import { createContext } from './bootstrap'
import { startWorker } from './automation/worker'

const ctx = createContext()
const stop = startWorker(ctx)
const shutdown = () => { stop(); ctx.pool.end().finally(() => process.exit(0)); setTimeout(() => process.exit(1), 10_000).unref() }
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
