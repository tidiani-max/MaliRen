import type { Role } from '../db/schema'

export type Permission =
  | 'content:read' | 'content:write' | 'content:delete'
  | 'submissions:read' | 'submissions:write' | 'submissions:delete'
  | 'media:read' | 'media:write' | 'media:delete'
  | 'users:read' | 'users:write'
  | 'settings:read' | 'settings:write'
  | 'automation:read' | 'automation:manage'
  | 'reports:read' | 'reports:generate'
  | 'audit:read'

const READ: Permission[] = ['content:read', 'submissions:read', 'media:read', 'reports:read']
const EDIT: Permission[] = [...READ, 'content:write', 'submissions:write', 'media:write']
const ADMIN: Permission[] = [
  ...EDIT, 'content:delete', 'submissions:delete', 'media:delete', 'users:read', 'users:write',
  'settings:read', 'settings:write', 'automation:read', 'reports:generate', 'audit:read',
]

export const PERMISSIONS: Record<Role, ReadonlySet<Permission>> = {
  reviewer: new Set(READ),
  editor: new Set(EDIT),
  admin: new Set(ADMIN),
  super_admin: new Set<Permission>([...ADMIN, 'automation:manage']),
}

export const can = (role: Role, perm: Permission) => PERMISSIONS[role].has(perm)

/** Rank used to stop users from managing accounts above their own level. */
export const ROLE_RANK: Record<Role, number> = { reviewer: 1, editor: 2, admin: 3, super_admin: 4 }
