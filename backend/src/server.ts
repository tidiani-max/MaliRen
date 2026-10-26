import 'dotenv/config'
import fs from 'node:fs/promises'
import { createApp } from './app'
import { createContext } from './bootstrap'
import { startWorker } from './automation/worker'

async function main() {
  const ctx = createContext()
  await fs.mkdir(ctx.env.UPLOAD_DIR, { recursive: true })
  const app = createApp(ctx)
  const server = app.listen(ctx.env.PORT, () => ctx.logger.info(`MaliREN API listening on :${ctx.env.PORT}  docs at /docs`))
  const stopWorker = ctx.env.EMBEDDED_WORKER ? startWorker(ctx) : () => undefined
  const shutdown = (sig: string) => {
    ctx.logger.info(`${sig} received, shutting down`)
    stopWorker()
    server.close(() => ctx.pool.end().finally(() => process.exit(0)))
    setTimeout(() => process.exit(1), 10_000).unref()
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))
}
main().catch((e) => { console.error(e); process.exit(1) })
