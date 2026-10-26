import type { Role } from '../api/types'

/** UI hints only  the server enforces every permission independently. */
export type Perm =
  | 'content:read' | 'content:write' | 'content:delete' | 'submissions:read' | 'submissions:write' | 'submissions:delete'
  | 'media:read' | 'media:write' | 'media:delete' | 'users:read' | 'users:write' | 'settings:read' | 'settings:write'
  | 'automation:read' | 'automation:manage' | 'reports:read' | 'reports:generate' | 'audit:read'

const READ: Perm[] = ['content:read', 'submissions:read', 'media:read', 'reports:read']
const EDIT: Perm[] = [...READ, 'content:write', 'submissions:write', 'media:write']
const ADMIN: Perm[] = [...EDIT, 'content:delete', 'submissions:delete', 'media:delete', 'users:read', 'users:write', 'settings:read', 'settings:write', 'automation:read', 'reports:generate', 'audit:read']
const MATRIX: Record<Role, Set<Perm>> = { reviewer: new Set(READ), editor: new Set(EDIT), admin: new Set(ADMIN), super_admin: new Set<Perm>([...ADMIN, 'automation:manage']) }

export const can = (role: Role | undefined, perm: Perm) => !!role && MATRIX[role].has(perm)
export const ROLE_LABEL: Record<Role, string> = { super_admin: 'Super administrateur', admin: 'Administrateur', editor: 'Éditeur', reviewer: 'Lecture seule' }
export const ROLE_RANK: Record<Role, number> = { reviewer: 1, editor: 2, admin: 3, super_admin: 4 }
