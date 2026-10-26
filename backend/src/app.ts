import cookieParser from 'cookie-parser'
import cors from 'cors'
import express, { type ErrorRequestHandler, type NextFunction, type Request, type Response } from 'express'
import rateLimit from 'express-rate-limit'
import helmet from 'helmet'
import { pinoHttp } from 'pino-http'
import swaggerUi from 'swagger-ui-express'
import type { AppContext } from './context'
import { HttpError } from './lib/errors'
import { openApiDoc } from './openapi/registry'
import { adminMiscRoutes } from './routes/admin-misc'
import { authRoutes } from './routes/auth'
import { contentRoutes } from './routes/content'
import { mediaRoutes } from './routes/media'
import { publicRoutes } from './routes/public'
import { submissionRoutes } from './routes/submissions'
import { userRoutes } from './routes/users'

export function createApp(ctx: AppContext) {
  const app = express()
  const { env } = ctx
  app.disable('x-powered-by')
  app.set('trust proxy', env.TRUST_PROXY)

  app.use(pinoHttp({ logger: ctx.logger, quietReqLogger: true, autoLogging: { ignore: (r) => r.url === '/health' } }))
  app.use(helmet({
    // The API only returns JSON/files; Swagger UI needs inline styles/scripts so relax CSP for /docs only.
    contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  }))
  app.use(cors({
    origin: (origin, cb) => cb(null, !origin || env.corsOrigins.includes(origin)),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    maxAge: 600,
  }))
  app.use(rateLimit({ windowMs: 60_000, limit: env.GLOBAL_RATE_LIMIT_MAX, standardHeaders: 'draft-7', legacyHeaders: false }))
  app.use(express.json({ limit: '100kb' }))
  app.use(cookieParser())

  app.get('/health', async (_req, res) => {
    try {
      await ctx.pool.query('select 1')
      res.json({ status: 'ok', db: 'up', uptime: Math.round(process.uptime()) })
    } catch {
      res.status(503).json({ status: 'degraded', db: 'down' })
    }
  })

  const api = express.Router()
  api.use('/auth', authRoutes(ctx))
  const media = mediaRoutes(ctx)
  api.use('/public', publicRoutes(ctx), media.publicFiles)
  api.use('/admin', contentRoutes(ctx), media.admin, adminMiscRoutes(ctx))
  const users = userRoutes(ctx)
  api.use('/admin/users', users.users)
  api.use('/admin/notifications', users.notifications)
  api.use('/admin/submissions', submissionRoutes(ctx))
  api.get('/openapi.json', (_req, res) => void res.json(openApiDoc))
  app.use('/api/v1', api)

  // Swagger UI needs its own relaxed CSP.
  app.use('/docs', (_req: Request, res: Response, next: NextFunction) => { res.removeHeader('Content-Security-Policy'); next() }, swaggerUi.serve, swaggerUi.setup(openApiDoc as never, { customSiteTitle: 'MaliREN API docs' }))

  app.use((_req, _res, next) => next(new HttpError(404, 'not_found', 'Route not found')))

  const onError: ErrorRequestHandler = (err, req, res, _next) => {
    if (err instanceof HttpError) {
      return void res.status(err.status).json({ error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) } })
    }
    const e = err as { type?: string; code?: string; name?: string; status?: number; message?: string }
    if (e.type === 'entity.too.large') return void res.status(413).json({ error: { code: 'payload_too_large', message: 'Request body too large' } })
    if (e.type === 'entity.parse.failed') return void res.status(400).json({ error: { code: 'bad_json', message: 'Malformed JSON body' } })
    if (e.name === 'MulterError') return void res.status(e.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: { code: 'upload_error', message: e.code === 'LIMIT_FILE_SIZE' ? `File exceeds ${env.MAX_UPLOAD_MB} MB` : (e.message ?? 'Upload error') } })
    const pg = (err as { cause?: { code?: string } }).cause?.code ?? e.code
    if (pg === '23505') return void res.status(409).json({ error: { code: 'conflict', message: 'A record with the same unique value already exists' } })
    if (pg === '23503') return void res.status(400).json({ error: { code: 'bad_reference', message: 'A referenced record does not exist' } })
    if (pg === '22P02') return void res.status(400).json({ error: { code: 'bad_request', message: 'Malformed identifier' } })
    req.log?.error({ err }, 'unhandled error')
    res.status(500).json({ error: { code: 'internal_error', message: 'Internal server error' } })
  }
  app.use(onError)
  return app
}
