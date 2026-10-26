import { Router, type Request, type RequestHandler, type Response } from 'express'
import { z, type ZodType } from 'zod'
import { authenticate, requirePermission, type AuthUser } from '../auth/middleware'
import type { Permission } from '../auth/rbac'
import type { AppContext } from '../context'
import { badRequest, forbidden } from '../lib/errors'

export type AuthMode = 'public' | 'authenticated' | Permission

export interface RouteCtx<P, Q, B> {
  req: Request
  res: Response
  user: AuthUser
  params: P
  query: Q
  body: B
}

export class Created<T> { constructor(public data: T) {} }
export class Raw { }
export const RAW = new Raw()

export interface RouteDef<P, Q, B> {
  method: 'get' | 'post' | 'put' | 'patch' | 'delete'
  path: string
  summary: string
  auth: AuthMode
  params?: ZodType<P>
  query?: ZodType<Q>
  body?: ZodType<B>
  middleware?: RequestHandler[]
  /** Allow users flagged mustChangePassword (only the password-change endpoint needs this). */
  allowPasswordChangePending?: boolean
  handler: (c: RouteCtx<P, Q, B>) => Promise<unknown>
}

export const openApiDoc: { openapi: string; info: object; servers: object[]; tags: object[]; paths: Record<string, Record<string, unknown>>; components: object } = {
  openapi: '3.0.3',
  info: {
    title: 'MaliREN API',
    version: '1.0.0',
    description: 'REST API for the MaliREN website and administration. Admin endpoints require `Authorization: Bearer <accessToken>` obtained from `POST /auth/login`.',
  },
  servers: [{ url: '/api/v1' }],
  tags: [],
  paths: {},
  components: { securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } } },
}

function toSchema(s: ZodType): Record<string, unknown> {
  try {
    const j = z.toJSONSchema(s, { unrepresentable: 'any', io: 'input' }) as Record<string, unknown>
    delete j.$schema
    return j
  } catch {
    return {}
  }
}

function describeParams(where: 'path' | 'query', schema?: ZodType) {
  if (!schema) return []
  const js = toSchema(schema) as { properties?: Record<string, object>; required?: string[] }
  return Object.entries(js.properties ?? {}).map(([name, sch]) => ({ name, in: where, required: where === 'path' || !!js.required?.includes(name), schema: sch }))
}

export function createRouter(ctx: AppContext, prefix: string, tag: string) {
  const router = Router()
  if (!openApiDoc.tags.some((t) => (t as { name: string }).name === tag)) openApiDoc.tags.push({ name: tag })

  function route<P = unknown, Q = unknown, B = unknown>(def: RouteDef<P, Q, B>) {
    const docPath = (prefix + def.path).replace(/:([A-Za-z]+)/g, '{$1}')
    ;(openApiDoc.paths[docPath] ??= {})[def.method] = {
      tags: [tag],
      summary: def.summary,
      security: def.auth === 'public' ? [] : [{ bearerAuth: [] }],
      description: def.auth === 'public' ? 'Public endpoint.' : def.auth === 'authenticated' ? 'Requires a signed-in user.' : `Requires permission \`${def.auth}\`.`,
      parameters: [...describeParams('path', def.params), ...describeParams('query', def.query)],
      ...(def.body ? { requestBody: { required: true, content: { 'application/json': { schema: toSchema(def.body) } } } } : {}),
      responses: { '200': { description: 'OK' }, '400': { description: 'Validation error' }, ...(def.auth === 'public' ? {} : { '401': { description: 'Not authenticated' }, '403': { description: 'Forbidden' } }) },
    }

    const wrapped: RequestHandler = async (req, res) => {
      let user = null as AuthUser | null
      if (def.auth !== 'public') {
        user = await authenticate(ctx, req)
        if (user.mustChangePassword && !def.allowPasswordChangePending) throw forbidden('Password change required before continuing')
        if (def.auth !== 'authenticated') requirePermission(user, def.auth)
      }
      const parse = <T>(schema: ZodType<T> | undefined, value: unknown, label: string): T => {
        if (!schema) return undefined as T
        const r = schema.safeParse(value)
        if (!r.success) throw badRequest(`Invalid ${label}`, r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })))
        return r.data
      }
      const params = parse(def.params, req.params, 'path parameters')
      const query = parse(def.query, req.query, 'query parameters')
      const body = parse(def.body, req.body, 'request body')
      const out = await def.handler({ req, res, user: user as AuthUser, params, query, body })
      if (out === RAW || res.headersSent) return
      if (out instanceof Created) return void res.status(201).json(out.data)
      if (out === undefined) return void res.status(204).end()
      res.json(out)
    }
    router[def.method](def.path, ...(def.middleware ?? []), wrapped)
  }
  return { router, route }
}
