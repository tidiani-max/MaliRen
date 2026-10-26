import { z } from 'zod'

export const idParam = z.object({ id: z.string().uuid() })

export const pageQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().max(100).optional(),
  sort: z.enum(['newest', 'oldest', 'title']).default('newest'),
})

export interface Paged<T> { items: T[]; total: number; page: number; pageSize: number }
export const paged = <T>(items: T[], total: number, page: number, pageSize: number): Paged<T> => ({ items, total, page, pageSize })
export const offset = (page: number, pageSize: number) => (page - 1) * pageSize

/** Escape % and _ so user text cannot act as ILIKE wildcards. */
export const likeTerm = (q: string) => `%${q.replace(/[\\%_]/g, (m) => '\\' + m)}%`
