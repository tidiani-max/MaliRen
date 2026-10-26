export type Role = 'super_admin' | 'admin' | 'editor' | 'reviewer'
export type ContentStatus = 'draft' | 'scheduled' | 'published' | 'archived'
export type SubmissionStatus = 'new' | 'in_progress' | 'handled' | 'spam'

export interface User { id: string; email: string; name: string; role: Role; mustChangePassword: boolean; active?: boolean; lastLoginAt?: string | null; createdAt?: string; lockedUntil?: string | null }
export interface Paged<T> { items: T[]; total: number; page: number; pageSize: number }

export interface NewsItem { id: string; slug: string; status: ContentStatus; category: string; titleFr: string; titleEn: string; excerptFr: string; excerptEn: string; bodyFr: string; bodyEn: string; coverMediaId: string | null; publishedAt: string | null; publishAt: string | null; isDemo: boolean; updatedAt: string; createdAt: string }
export interface EventItem { id: string; slug: string; status: ContentStatus; titleFr: string; titleEn: string; subtitleFr: string; subtitleEn: string; descriptionFr: string; descriptionEn: string; dateLabel: string; startsAt: string; endsAt: string | null; location: string; publishAt: string | null; isDemo: boolean; updatedAt: string }
export interface PublicationItem { id: string; slug: string; status: ContentStatus; category: string; titleFr: string; titleEn: string; summaryFr: string; summaryEn: string; dateLabel: string; fileMediaId: string | null; externalUrl: string; publishedAt: string | null; publishAt: string | null; isDemo: boolean; updatedAt: string }
export interface PageItem { id: string; slug: string; status: ContentStatus; titleFr: string; titleEn: string; bodyFr: string; bodyEn: string; publishAt: string | null; isDemo: boolean; updatedAt: string }
export interface InstitutionItem { id: string; slug: string; name: string; kind: 'pilot' | 'member' | 'partner'; status: 'pending' | 'active' | 'inactive'; city: string; descriptionFr: string; descriptionEn: string; websiteUrl: string; sortOrder: number; isDemo: boolean; updatedAt: string }

export interface SiteSettings { technicalContactName: string; technicalContactPhone: string; technicalContactEmail: string; ceoName: string; ceoEmail: string; supportEmail: string; addressLine: string; asn: string; ipv4Block: string; peering: string }
export interface NotificationSettings { recipients: string[]; notifyAdmins: boolean; notifyOnContact: boolean }

export interface Submission { id: string; name: string; email: string; subject: string; message: string; locale: string; status: SubmissionStatus; assignedTo: string | null; assigneeName: string | null; followUpAt: string | null; handledAt: string | null; createdAt: string; reminderCount: number }
export interface SubmissionNote { id: string; authorName: string; body: string; createdAt: string }
export interface MediaItem { id: string; originalName: string; mimeType: string; sizeBytes: number; altFr: string; altEn: string; caption: string; expiresAt: string | null; createdAt: string; url: string }
export interface NotificationItem { id: string; type: string; title: string; body: string; link: string; readAt: string | null; createdAt: string }
export interface AuditEntry { id: string; actorLabel: string; action: string; entity: string; entityId: string | null; summary: string; createdAt: string; ip: string | null; meta: unknown }
export interface JobItem { id: string; type: string; status: string; attempts: number; maxAttempts: number; lastError: string | null; runAt: string; finishedAt: string | null; result: unknown; createdAt: string }
export interface EmailLogItem { id: string; toAddress: string; subject: string; status: string; error: string | null; createdAt: string }
export interface ScheduleItem { name: string; label: string; description: string; enabled: boolean; kind: 'interval' | 'daily' | 'weekly'; intervalMinutes: number | null; atHour: number | null; atMinute: number | null; weekday: number | null; config: Record<string, number | string | boolean>; lastRunAt: string | null; nextRunAt: string }
export interface SummaryReport { period: { from: string; to: string }; submissions: { total: number; byStatus: Record<string, number>; openNow: number; avgHoursToHandle: number | null; byMonth: { month: string; n: number }[] }; content: { type: string; byStatus: Record<string, number> }[]; institutions: { kind: string; status: string; n: number }[]; topActions: { action: string; n: number }[] }
export interface DigestReport { id: string; title: string; type: string; createdAt: string; periodStart: string; periodEnd: string; data: SummaryReport }
export interface Dashboard { metrics: { published: number; drafts: number; upcomingEvents: number; newSubmissions: number; unreadNotifications: number }; publicationActivity: { month: string; published: number }[]; recentSubmissions: { id: string; name: string; subject: string; status: SubmissionStatus; createdAt: string }[]; recentContent: { id: string; title: string; status: ContentStatus; updatedAt: string; type: string }[] }
export interface SearchHit { type: 'news' | 'events' | 'publications' | 'institutions'; slug: string; category: string; titleFr: string; titleEn: string; textFr: string; textEn: string }
