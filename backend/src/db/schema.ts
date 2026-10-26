import { sql } from 'drizzle-orm'
import {
  boolean, index, integer, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid,
} from 'drizzle-orm/pg-core'

export const roleEnum = pgEnum('role', ['super_admin', 'admin', 'editor', 'reviewer'])
export const contentStatusEnum = pgEnum('content_status', ['draft', 'scheduled', 'published', 'archived'])
export const institutionStatusEnum = pgEnum('institution_status', ['pending', 'active', 'inactive'])
export const institutionKindEnum = pgEnum('institution_kind', ['pilot', 'member', 'partner'])
export const submissionStatusEnum = pgEnum('submission_status', ['new', 'in_progress', 'handled', 'spam'])
export const jobStatusEnum = pgEnum('job_status', ['queued', 'running', 'succeeded', 'failed', 'dead'])

const id = () => uuid('id').primaryKey().defaultRandom()
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()

/* ------------------------------------------------------------------ users & sessions */
export const users = pgTable(
  'users',
  {
    id: id(),
    email: text('email').notNull(),
    name: text('name').notNull(),
    passwordHash: text('password_hash').notNull(),
    role: roleEnum('role').notNull().default('editor'),
    active: boolean('active').notNull().default(true),
    mustChangePassword: boolean('must_change_password').notNull().default(false),
    failedLogins: integer('failed_logins').notNull().default(0),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('users_email_lower_uq').on(sql`lower(${t.email})`)],
)

export const sessions = pgTable(
  'sessions',
  {
    id: id(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    /** sha256 of the opaque refresh token – the token itself is never stored. */
    tokenHash: text('token_hash').notNull(),
    /** All rotated tokens of one login share a family; reuse of a rotated token revokes the family. */
    familyId: uuid('family_id').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    userAgent: text('user_agent'),
    ip: text('ip'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('sessions_token_uq').on(t.tokenHash), index('sessions_user_idx').on(t.userId), index('sessions_family_idx').on(t.familyId)],
)

/* ------------------------------------------------------------------ media */
export const media = pgTable('media', {
  id: id(),
  storageKey: text('storage_key').notNull(),
  originalName: text('original_name').notNull(),
  mimeType: text('mime_type').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  sha256: text('sha256').notNull(),
  altFr: text('alt_fr').notNull().default(''),
  altEn: text('alt_en').notNull().default(''),
  caption: text('caption').notNull().default(''),
  /** Temporary uploads are removed by the cleanup automation unless kept before `expiresAt`. */
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  uploadedBy: uuid('uploaded_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
})

/* ------------------------------------------------------------------ content */
const contentCommon = () => ({
  id: id(),
  slug: text('slug').notNull(),
  status: contentStatusEnum('status').notNull().default('draft'),
  /** When status=scheduled this is the future publication time; when published it is the effective publication time. */
  publishAt: timestamp('publish_at', { withTimezone: true }),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  isDemo: boolean('is_demo').notNull().default(false),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
})

export const pages = pgTable(
  'pages',
  {
    ...contentCommon(),
    titleFr: text('title_fr').notNull(),
    titleEn: text('title_en').notNull().default(''),
    bodyFr: text('body_fr').notNull().default(''),
    bodyEn: text('body_en').notNull().default(''),
  },
  (t) => [uniqueIndex('pages_slug_uq').on(t.slug), index('pages_status_idx').on(t.status)],
)

export const news = pgTable(
  'news',
  {
    ...contentCommon(),
    category: text('category').notNull().default(''),
    titleFr: text('title_fr').notNull(),
    titleEn: text('title_en').notNull().default(''),
    excerptFr: text('excerpt_fr').notNull().default(''),
    excerptEn: text('excerpt_en').notNull().default(''),
    bodyFr: text('body_fr').notNull().default(''),
    bodyEn: text('body_en').notNull().default(''),
    coverMediaId: uuid('cover_media_id').references(() => media.id, { onDelete: 'set null' }),
    reminderSentAt: timestamp('reminder_sent_at', { withTimezone: true }),
  },
  (t) => [uniqueIndex('news_slug_uq').on(t.slug), index('news_status_idx').on(t.status, t.publishedAt)],
)

export const events = pgTable(
  'events',
  {
    ...contentCommon(),
    titleFr: text('title_fr').notNull(),
    titleEn: text('title_en').notNull().default(''),
    subtitleFr: text('subtitle_fr').notNull().default(''),
    subtitleEn: text('subtitle_en').notNull().default(''),
    descriptionFr: text('description_fr').notNull().default(''),
    descriptionEn: text('description_en').notNull().default(''),
    /** Free text shown to visitors, e.g. "22–24 octobre 2025". Falls back to a formatted startsAt. */
    dateLabel: text('date_label').notNull().default(''),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }),
    location: text('location').notNull().default(''),
    reminderSentAt: timestamp('reminder_sent_at', { withTimezone: true }),
  },
  (t) => [uniqueIndex('events_slug_uq').on(t.slug), index('events_starts_idx').on(t.startsAt)],
)

export const publications = pgTable(
  'publications',
  {
    ...contentCommon(),
    category: text('category').notNull().default(''),
    titleFr: text('title_fr').notNull(),
    titleEn: text('title_en').notNull().default(''),
    summaryFr: text('summary_fr').notNull().default(''),
    summaryEn: text('summary_en').notNull().default(''),
    dateLabel: text('date_label').notNull().default(''),
    fileMediaId: uuid('file_media_id').references(() => media.id, { onDelete: 'set null' }),
    externalUrl: text('external_url').notNull().default(''),
    reminderSentAt: timestamp('reminder_sent_at', { withTimezone: true }),
  },
  (t) => [uniqueIndex('publications_slug_uq').on(t.slug), index('publications_status_idx').on(t.status)],
)

export const institutions = pgTable(
  'institutions',
  {
    id: id(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    kind: institutionKindEnum('kind').notNull().default('member'),
    status: institutionStatusEnum('status').notNull().default('pending'),
    city: text('city').notNull().default(''),
    descriptionFr: text('description_fr').notNull().default(''),
    descriptionEn: text('description_en').notNull().default(''),
    websiteUrl: text('website_url').notNull().default(''),
    sortOrder: integer('sort_order').notNull().default(0),
    isDemo: boolean('is_demo').notNull().default(false),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('institutions_slug_uq').on(t.slug), index('institutions_kind_idx').on(t.kind, t.status)],
)

/* ------------------------------------------------------------------ contact submissions */
export const submissions = pgTable(
  'submissions',
  {
    id: id(),
    name: text('name').notNull(),
    email: text('email').notNull(),
    subject: text('subject').notNull(),
    message: text('message').notNull(),
    locale: text('locale').notNull().default('fr'),
    consent: boolean('consent').notNull().default(false),
    status: submissionStatusEnum('status').notNull().default('new'),
    assignedTo: uuid('assigned_to').references(() => users.id, { onDelete: 'set null' }),
    followUpAt: timestamp('follow_up_at', { withTimezone: true }),
    handledAt: timestamp('handled_at', { withTimezone: true }),
    reminderCount: integer('reminder_count').notNull().default(0),
    lastReminderAt: timestamp('last_reminder_at', { withTimezone: true }),
    /** sha256(ip + secret-less salt) – lets admins spot floods without storing raw IPs. */
    ipHash: text('ip_hash'),
    isDemo: boolean('is_demo').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('submissions_status_idx').on(t.status, t.createdAt), index('submissions_assigned_idx').on(t.assignedTo)],
)

export const submissionNotes = pgTable(
  'submission_notes',
  {
    id: id(),
    submissionId: uuid('submission_id').notNull().references(() => submissions.id, { onDelete: 'cascade' }),
    authorId: uuid('author_id').references(() => users.id, { onDelete: 'set null' }),
    authorName: text('author_name').notNull(),
    body: text('body').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('submission_notes_sub_idx').on(t.submissionId)],
)

/* ------------------------------------------------------------------ settings, notifications, audit */
export const settings = pgTable('settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
  updatedAt: updatedAt(),
})

export const notifications = pgTable(
  'notifications',
  {
    id: id(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull().default(''),
    link: text('link').notNull().default(''),
    dedupeKey: text('dedupe_key'),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('notifications_user_idx').on(t.userId, t.readAt), uniqueIndex('notifications_dedupe_uq').on(t.userId, t.dedupeKey)],
)

export const auditLog = pgTable(
  'audit_log',
  {
    id: id(),
    actorId: uuid('actor_id'),
    actorLabel: text('actor_label').notNull(),
    action: text('action').notNull(),
    entity: text('entity').notNull(),
    entityId: text('entity_id'),
    summary: text('summary').notNull().default(''),
    meta: jsonb('meta'),
    ip: text('ip'),
    createdAt: createdAt(),
  },
  (t) => [index('audit_created_idx').on(t.createdAt), index('audit_entity_idx').on(t.entity, t.entityId)],
)

/* ------------------------------------------------------------------ automation */
export const jobs = pgTable(
  'jobs',
  {
    id: id(),
    type: text('type').notNull(),
    payload: jsonb('payload').notNull().default({}),
    status: jobStatusEnum('status').notNull().default('queued'),
    runAt: timestamp('run_at', { withTimezone: true }).notNull().defaultNow(),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(5),
    lastError: text('last_error'),
    result: jsonb('result'),
    /** Unique while set: enqueueing the same logical job twice is a no-op (idempotency). */
    dedupeKey: text('dedupe_key'),
    lockedAt: timestamp('locked_at', { withTimezone: true }),
    createdAt: createdAt(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => [index('jobs_due_idx').on(t.status, t.runAt), uniqueIndex('jobs_dedupe_uq').on(t.dedupeKey)],
)

export const automationSchedules = pgTable('automation_schedules', {
  name: text('name').primaryKey(),
  enabled: boolean('enabled').notNull().default(true),
  /** interval | daily | weekly */
  kind: text('kind').notNull(),
  intervalMinutes: integer('interval_minutes'),
  atHour: integer('at_hour'),
  atMinute: integer('at_minute').default(0),
  weekday: integer('weekday'),
  config: jsonb('config').notNull().default({}),
  lastRunAt: timestamp('last_run_at', { withTimezone: true }),
  nextRunAt: timestamp('next_run_at', { withTimezone: true }).notNull(),
  updatedAt: updatedAt(),
})

export const emailLog = pgTable(
  'email_log',
  {
    id: id(),
    toAddress: text('to_address').notNull(),
    subject: text('subject').notNull(),
    body: text('body').notNull().default(''),
    /** pending | sent | logged | failed */
    status: text('status').notNull().default('pending'),
    error: text('error'),
    attempts: integer('attempts').notNull().default(0),
    dedupeKey: text('dedupe_key'),
    createdAt: createdAt(),
    sentAt: timestamp('sent_at', { withTimezone: true }),
  },
  (t) => [uniqueIndex('email_log_dedupe_uq').on(t.dedupeKey), index('email_log_created_idx').on(t.createdAt)],
)

/* ------------------------------------------------------------------ reports */
export const reports = pgTable('reports', {
  id: id(),
  type: text('type').notNull(),
  title: text('title').notNull(),
  periodStart: timestamp('period_start', { withTimezone: true }).notNull(),
  periodEnd: timestamp('period_end', { withTimezone: true }).notNull(),
  data: jsonb('data').notNull(),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
})

export type User = typeof users.$inferSelect
export type Role = (typeof roleEnum.enumValues)[number]
export type ContentStatus = (typeof contentStatusEnum.enumValues)[number]
