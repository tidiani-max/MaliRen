import jwt from 'jsonwebtoken'
import type { Env } from '../config/env'
import type { Role } from '../db/schema'

export interface AccessClaims { sub: string; role: Role; sid: string }

export function signAccessToken(env: Env, claims: AccessClaims): string {
  return jwt.sign(claims, env.JWT_SECRET, { algorithm: 'HS256', expiresIn: env.ACCESS_TOKEN_TTL_MIN * 60, issuer: 'maliren-api' })
}

export function verifyAccessToken(env: Env, token: string): AccessClaims | null {
  try {
    const p = jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'], issuer: 'maliren-api' }) as jwt.JwtPayload
    return { sub: String(p.sub), role: p.role as Role, sid: String(p.sid) }
  } catch {
    return null
  }
}
