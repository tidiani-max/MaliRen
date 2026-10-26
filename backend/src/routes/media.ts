import fs from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { and, desc, eq, ilike, isNull, or, sql, type SQL } from 'drizzle-orm'
import multer from 'multer'
import { z } from 'zod'
import { authenticate, requirePermission } from '../auth/middleware'
import type { AppContext } from '../context'
import { media } from '../db/schema'
import { badRequest, notFound } from '../lib/errors'
import { detectFileType, INLINE_MIMES, safeDownloadName } from '../lib/filetype'
import { idParam, likeTerm, offset, paged, pageQuery } from '../lib/http'
import { sha256 } from '../lib/crypto'
import { cleanText } from '../lib/text'
import { createRouter, Created, RAW } from '../openapi/registry'
import { audit } from '../services/audit'

export function mediaRoutes(ctx: AppContext) {
  const { router, route } = createRouter(ctx, '/admin', 'Admin · Media')
  const uploadRoot = path.resolve(ctx.env.UPLOAD_DIR)
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: ctx.env.MAX_UPLOAD_MB * 1024 * 1024, files: 1 } })
  const abs = (key: string) => {
    const p = path.resolve(uploadRoot, key)
    if (!p.startsWith(uploadRoot + path.sep)) throw badRequest('Invalid storage key')
    return p
  }

  route({
    method: 'get', path: '/media', auth: 'media:read', summary: 'List media library',
    query: pageQuery.extend({ temporary: z.enum(['true', 'false']).optional(), type: z.enum(['image', 'document']).optional() }),
    handler: async ({ query }) => {
      const conds: SQL[] = []
      if (query.q) conds.push(or(ilike(media.originalName, likeTerm(query.q)), ilike(media.altFr, likeTerm(query.q)), ilike(media.caption, likeTerm(query.q)))!)
      if (query.temporary === 'true') conds.push(sql`${media.expiresAt} is not null`)
      if (query.temporary === 'false') conds.push(isNull(media.expiresAt))
      if (query.type === 'image') conds.push(ilike(media.mimeType, 'image/%'))
      if (query.type === 'document') conds.push(sql`${media.mimeType} not like 'image/%'`)
      const where = conds.length ? and(...conds) : undefined
      const [items, [{ n }]] = await Promise.all([
        db().select().from(media).where(where).orderBy(desc(media.createdAt)).limit(query.pageSize).offset(offset(query.page, query.pageSize)),
        db().select({ n: sql<number>`count(*)::int` }).from(media).where(where),
      ])
      return paged(items.map((m) => ({ ...m, url: `/api/v1/public/media/${m.id}` })), n, query.page, query.pageSize)
    },
  })

  // multipart upload: validated by hand (zod cannot describe multipart), documented in the summary.
  route({
    method: 'post', path: '/media', auth: 'media:write', summary: 'Upload a file (multipart/form-data, field "file"; optional field "temporary=true" keeps it 24h)',
    middleware: [
      async (req, res, next) => {
        try {
          const u = await authenticate(ctx, req)
          requirePermission(u, 'media:write')
          next()
        } catch (e) { next(e) }
      },
      upload.single('file'),
    ],
    handler: async ({ req, user }) => {
      const file = req.file
      if (!file) throw badRequest('No file received (field name must be "file")')
      const detected = detectFileType(file.buffer, file.originalname)
      if (!detected) throw badRequest('Unsupported file type. Allowed: JPEG, PNG, GIF, WebP, PDF, DOCX, XLSX, PPTX')
      const key = path.join(String(new Date().getFullYear()), `${randomUUID()}${detected.ext}`)
      await fs.mkdir(path.dirname(abs(key)), { recursive: true })
      await fs.writeFile(abs(key), file.buffer, { flag: 'wx', mode: 0o640 })
      const temporary = req.body?.temporary === 'true'
      const originalName = safeDownloadName(Buffer.from(file.originalname, 'latin1').toString('utf8'))
      const [row] = await db().insert(media).values({
        storageKey: key, originalName, mimeType: detected.mime, sizeBytes: file.size, sha256: sha256(file.buffer),
        uploadedBy: user.id, expiresAt: temporary ? new Date(Date.now() + 24 * 3600_000) : null,
      }).returning()
      await audit(db(), { id: user.id, label: user.email }, 'upload', 'media', row.id, `Uploaded ${originalName} (${file.size} B)`, undefined, req)
      return new Created({ ...row, url: `/api/v1/public/media/${row.id}` })
    },
  })

  route({
    method: 'patch', path: '/media/:id', auth: 'media:write', summary: 'Edit media metadata (alt text, caption) or keep a temporary upload',
    params: idParam,
    body: z.object({ altFr: z.string().max(300).transform(cleanText), altEn: z.string().max(300).transform(cleanText), caption: z.string().max(500).transform(cleanText), keep: z.literal(true) }).partial(),
    handler: async ({ req, user, params, body }) => {
      const { keep, ...rest } = body
      const [row] = await db().update(media).set({ ...rest, ...(keep ? { expiresAt: null } : {}) }).where(eq(media.id, params.id)).returning()
      if (!row) throw notFound('Media')
      await audit(db(), { id: user.id, label: user.email }, 'update', 'media', row.id, `Updated media metadata for ${row.originalName}`, undefined, req)
      return { ...row, url: `/api/v1/public/media/${row.id}` }
    },
  })

  route({
    method: 'delete', path: '/media/:id', auth: 'media:delete', summary: 'Delete a file and its metadata', params: idParam,
    handler: async ({ req, user, params }) => {
      const [row] = await db().delete(media).where(eq(media.id, params.id)).returning()
      if (!row) throw notFound('Media')
      await fs.rm(abs(row.storageKey), { force: true })
      await audit(db(), { id: user.id, label: user.email }, 'delete', 'media', row.id, `Deleted media ${row.originalName}`, undefined, req)
      return undefined
    },
  })

  // Public file delivery (non-temporary files only). Served with nosniff + sandboxing CSP.
  const pub = createRouter(ctx, '/public', 'Public')
  pub.route({
    method: 'get', path: '/media/:id', auth: 'public', summary: 'Download a published media file', params: idParam,
    handler: async ({ res, params }) => {
      const [row] = await db().select().from(media).where(and(eq(media.id, params.id), isNull(media.expiresAt)))
      if (!row) throw notFound('Media')
      const inline = INLINE_MIMES.has(row.mimeType)
      res.setHeader('Content-Type', row.mimeType)
      res.setHeader('Content-Length', String(row.sizeBytes))
      res.setHeader('X-Content-Type-Options', 'nosniff')
      res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox")
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin')
      res.setHeader('Cache-Control', 'public, max-age=3600')
      res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${safeDownloadName(row.originalName)}"`)
      await new Promise<void>((resolve, reject) => {
        const s = createReadStream(abs(row.storageKey))
        s.on('error', reject).on('end', resolve)
        s.pipe(res)
      })
      return RAW
    },
  })

  function db() { return ctx.db }
  return { admin: router, publicFiles: pub.router }
}
