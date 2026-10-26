import { z } from 'zod'

const bool = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1')

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  DATABASE_URL: z.string().url().default('postgresql://maliren:maliren@localhost:5432/maliren'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  /** Comma separated list of allowed browser origins (CORS + CSRF origin check). */
  CORS_ORIGINS: z.string().default('http://localhost:5173,http://localhost:8080'),
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),
  PUBLIC_SITE_URL: z.string().url().default('http://localhost:5173'),

  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters').default('dev-only-secret-change-me-dev-only-secret'),
  ACCESS_TOKEN_TTL_MIN: z.coerce.number().int().min(1).max(120).default(15),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(7),
  COOKIE_SECURE: bool.optional(),
  COOKIE_SAMESITE: z.enum(['lax', 'strict', 'none']).default('lax'),
  COOKIE_DOMAIN: z.string().optional(),
  /** scrypt cost (N). 32768 with r=8,p=3 is an OWASP-accepted configuration. Lowered only in tests. */
  SCRYPT_N: z.coerce.number().int().min(1024).default(32768),

  LOGIN_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(10),
  LOGIN_RATE_LIMIT_WINDOW_MIN: z.coerce.number().int().min(1).default(15),
  CONTACT_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(5),
  CONTACT_RATE_LIMIT_WINDOW_MIN: z.coerce.number().int().min(1).default(60),
  GLOBAL_RATE_LIMIT_MAX: z.coerce.number().int().min(10).default(600),
  MAX_FAILED_LOGINS: z.coerce.number().int().min(3).default(5),
  LOCKOUT_MINUTES: z.coerce.number().int().min(1).default(15),

  UPLOAD_DIR: z.string().default('./uploads'),
  MAX_UPLOAD_MB: z.coerce.number().min(1).max(100).default(10),

  MAIL_MODE: z.enum(['log', 'smtp']).default('log'),
  MAIL_FROM: z.string().default('MaliREN <no-reply@maliren.ml>'),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().default(587),
  SMTP_SECURE: bool.default(false),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  /** Fallback recipient(s) for notifications when none are configured in Settings (comma separated). */
  ADMIN_NOTIFY_EMAIL: z.string().default(''),

  EMBEDDED_WORKER: bool.default(true),
  WORKER_POLL_SECONDS: z.coerce.number().int().min(1).default(5),
  AUTOMATIONS_ENABLED: bool.default(true),

  ALLOW_DEMO_SEED: bool.default(false),
  DEMO_PASSWORD: z.string().min(10).default('Maliren#Demo2026'),
  SEED_ADMIN_EMAIL: z.string().email().optional(),
  SEED_ADMIN_PASSWORD: z.string().min(12).optional(),
})

export type Env = z.infer<typeof schema> & { corsOrigins: string[]; cookieSecure: boolean; isProd: boolean }

/** Treat empty strings (common in .env files) as "not set". */
function clean(source: Record<string, string | undefined>) {
  return Object.fromEntries(Object.entries(source).filter(([, v]) => v !== undefined && v !== ''))
}

export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const parsed = schema.safeParse(clean(source))
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n')
    throw new Error(`Invalid environment configuration:\n${msg}`)
  }
  const e = parsed.data
  const isProd = e.NODE_ENV === 'production'
  if (isProd && e.JWT_SECRET.startsWith('dev-only')) {
    throw new Error('Refusing to start in production with the default JWT_SECRET. Generate one: openssl rand -hex 48')
  }
  if (e.MAIL_MODE === 'smtp' && !e.SMTP_HOST) throw new Error('MAIL_MODE=smtp requires SMTP_HOST')
  const cookieSecure = e.COOKIE_SECURE ?? isProd
  if (e.COOKIE_SAMESITE === 'none' && !cookieSecure) throw new Error('COOKIE_SAMESITE=none requires COOKIE_SECURE=true')
  return {
    ...e,
    isProd,
    cookieSecure,
    corsOrigins: e.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean),
  }
}
