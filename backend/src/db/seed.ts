import 'dotenv/config'
import { sql } from 'drizzle-orm'
import { createDb, type Db } from './client'
import { events, institutions, news, pages, publications, users, type Role } from './schema'
import { loadEnv, type Env } from '../config/env'
import { hashPassword } from '../lib/crypto'
import { ensureSchedules } from '../automation/schedules'
import { putSetting, siteSettingsSchema, notificationSettingsSchema } from '../services/settings'

/**
 * Content below is the text supplied with the approved frontend prototype. Nothing is invented:
 * every row is flagged is_demo=true so administrators can see it must be reviewed/replaced.
 * Seeding is idempotent (existing slugs are left untouched, edits are never overwritten).
 */
const BODY_FR_TAIL = '\n\nCette publication présente une actualité de démonstration. Son contenu sera remplacé par les informations officielles fournies par l’équipe MaliREN.\n\nLe programme accompagne progressivement les institutions membres avec une infrastructure mutualisée et des services adaptés à leurs besoins.'
const BODY_EN_TAIL = '\n\nThis is a demonstration news item. Its content will be replaced by the official information provided by the MaliREN team.\n\nThe programme gradually supports member institutions with shared infrastructure and services tailored to their needs.'

const NEWS = [
  { slug: 'noc-point-g-operationnel', category: 'Réseau', titleFr: 'Le NOC Point G est désormais opérationnel', titleEn: 'The Point G NOC is now operational', excerptFr: 'Une infrastructure nationale au service de la recherche et de l’éducation.', excerptEn: 'A national infrastructure serving research and education.', at: '2026-02-12' },
  { slug: 'convention-afribone', category: 'Partenariat', titleFr: 'Convention de collaboration avec Afribone', titleEn: 'Collaboration agreement with Afribone', excerptFr: 'Une nouvelle étape pour renforcer l’interconnexion des établissements membres.', excerptEn: 'A new step to strengthen the interconnection of member institutions.', at: '2026-01-28' },
  { slug: 'ateliers-eduroam-campus-pilotes', category: 'Formation', titleFr: 'Ateliers eduroam pour les campus pilotes', titleEn: 'eduroam workshops for pilot campuses', excerptFr: 'Formation technique et déploiement dans les établissements pilotes.', excerptEn: 'Technical training and deployment in the pilot institutions.', at: '2025-10-22' },
]
const EVENTS = [
  { slug: 'convention-afribone-mou-2026', titleFr: 'Convention Afribone  MoU 2026', titleEn: 'Afribone Convention  MoU 2026', dateLabel: 'Janvier 2026', subtitleFr: 'Signature du protocole de collaboration', subtitleEn: 'Signature of the collaboration protocol', descriptionFr: 'Renforcement du partenariat pour l’interconnexion et la recherche au Mali  coopération & infrastructures et accès fédéré.', descriptionEn: 'Strengthening the partnership for interconnection and research in Mali  cooperation, infrastructure and federated access.', startsAt: '2026-01-01' },
  { slug: 'lancement-pilotes-zoom', titleFr: 'Lancement pilotes Zoom', titleEn: 'Zoom pilots launch', dateLabel: '15 décembre 2025', subtitleFr: 'Déploiement pilote visioconférence pour établissements membres', subtitleEn: 'Pilot videoconferencing deployment for member institutions', descriptionFr: 'Tests des salles virtuelles sécurisées Zoom pour l’enseignement à distance et réunions techniques.', descriptionEn: 'Testing of secure Zoom virtual rooms for distance learning and technical meetings.', startsAt: '2025-12-15' },
  { slug: 'ateliers-eduroam-2025', titleFr: 'Ateliers eduroam 2025', titleEn: 'eduroam workshops 2025', dateLabel: '22–24 octobre 2025', subtitleFr: 'Atelier technique et déploiement', subtitleEn: 'Technical workshop and deployment', descriptionFr: 'Formation des administrateurs locaux à la fédération EduID et gestion des accès académiques.', descriptionEn: 'Training of local administrators in the EduID federation and academic access management.', startsAt: '2025-10-22', endsAt: '2025-10-24' },
  { slug: 'ateliers-eduroam-2025-sessions-pratiques', titleFr: 'Ateliers eduroam 2025', titleEn: 'eduroam workshops 2025', dateLabel: '22–24 octobre 2025', subtitleFr: 'Atelier technique et déploiement', subtitleEn: 'Technical workshop and deployment', descriptionFr: 'Sessions pratiques sur le déploiement eduroam dans les campus universitaires de Bamako.', descriptionEn: 'Hands-on sessions on eduroam deployment in the university campuses of Bamako.', startsAt: '2025-10-22', endsAt: '2025-10-24' },
  { slug: 'formation-eduid', titleFr: 'Formation EduID', titleEn: 'EduID training', dateLabel: '10 septembre 2025', subtitleFr: 'Formation à l’identité électronique', subtitleEn: 'Electronic identity training', descriptionFr: 'Formation des administrateurs locaux à la fédération EduID et gestion des accès académiques.', descriptionEn: 'Training of local administrators in the EduID federation and academic access management.', startsAt: '2025-09-10' },
  { slug: 'journees-noc-inauguration-mlix', titleFr: 'Journées NOC  Point G inauguration MLIX', titleEn: 'NOC Days  Point G MLIX inauguration', dateLabel: '05 juillet 2025', subtitleFr: 'Inauguration du Point d’échange Internet MLIX', subtitleEn: 'Inauguration of the MLIX Internet Exchange Point', descriptionFr: 'Inauguration du Mali Internet Exchange (MLIX) au Point G, FMOS  échanges techniques et démonstrations NOC.', descriptionEn: 'Inauguration of the Mali Internet Exchange (MLIX) at Point G, FMOS  technical exchanges and NOC demonstrations.', startsAt: '2025-07-05' },
]
const PUBLICATIONS = [
  { slug: 'rapport-activite-2025', category: 'Rapport', titleFr: 'Rapport d’activité MaliREN 2025', titleEn: 'MaliREN activity report 2025', summaryFr: 'Bilan annuel du réseau et perspectives.', summaryEn: 'Annual review of the network and outlook.', dateLabel: 'Décembre 2025' },
  { slug: 'guide-connexion-eduid', category: 'Guide', titleFr: 'Guide de connexion EduID', titleEn: 'EduID connection guide', summaryFr: 'Guide pratique destiné aux établissements.', summaryEn: 'Practical guide for institutions.', dateLabel: 'Octobre 2025' },
]
const PILOT = { fr: 'Site pilote connecté au réseau MaliREN.', en: 'Pilot site connected to the MaliREN network.' }
const INSTITUTIONS = [
  { slug: 'usttb-fst', name: 'USTTB-FST', kind: 'pilot' as const, city: 'Bamako', d: PILOT, sortOrder: 1 },
  { slug: 'usttb-fmos-faph', name: 'USTTB-FMOS&FAPH', kind: 'pilot' as const, city: 'Bamako', d: { fr: 'Site pilote et hôte du NOC Point G.', en: 'Pilot site and host of the Point G NOC.' }, sortOrder: 2 },
  { slug: 'lcv', name: 'LCV', kind: 'pilot' as const, city: '', d: PILOT, sortOrder: 3 },
  { slug: 'ier', name: 'IER', kind: 'pilot' as const, city: '', d: PILOT, sortOrder: 4 },
  { slug: 'eni-abt', name: 'ENI-ABT', kind: 'pilot' as const, city: '', d: PILOT, sortOrder: 5 },
  { slug: 'wacren', name: 'WACREN', kind: 'partner' as const, city: '', d: { fr: '', en: '' }, sortOrder: 10 },
  { slug: 'geant', name: 'GÉANT', kind: 'partner' as const, city: '', d: { fr: '', en: '' }, sortOrder: 11 },
  { slug: 'afribone', name: 'Afribone', kind: 'partner' as const, city: '', d: { fr: '', en: '' }, sortOrder: 12 },
  { slug: 'isoc-mali', name: 'ISOC-Mali', kind: 'partner' as const, city: '', d: { fr: '', en: '' }, sortOrder: 13 },
]
const PAGES = [
  { slug: 'mentions', titleFr: 'Mentions légales', titleEn: 'Legal notice', bodyFr: 'Cette page présente les informations générales relatives au site MaliREN. Les textes définitifs seront publiés après validation institutionnelle.', bodyEn: 'This page presents general information about the MaliREN website. The final texts will be published after institutional validation.' },
  { slug: 'confidentialite', titleFr: 'Politique de confidentialité', titleEn: 'Privacy policy', bodyFr: 'Les messages envoyés via le formulaire de contact sont enregistrés sur les serveurs de MaliREN afin de traiter votre demande. Le texte définitif de la politique de confidentialité sera publié après validation institutionnelle.', bodyEn: 'Messages sent through the contact form are stored on MaliREN servers in order to handle your request. The final privacy policy text will be published after institutional validation.' },
]

export async function seedContent(db: Db) {
  const at = (d: string) => new Date(`${d}T09:00:00Z`)
  const now = new Date()
  const common = { status: 'published' as const, isDemo: true, publishedAt: now, publishAt: now }
  for (const n of NEWS) {
    await db.insert(news).values({ ...common, slug: n.slug, category: n.category, titleFr: n.titleFr, titleEn: n.titleEn, excerptFr: n.excerptFr, excerptEn: n.excerptEn, bodyFr: n.excerptFr + BODY_FR_TAIL, bodyEn: n.excerptEn + BODY_EN_TAIL, publishedAt: at(n.at), publishAt: at(n.at) }).onConflictDoNothing()
  }
  for (const e of EVENTS) {
    await db.insert(events).values({ ...common, ...e, startsAt: at(e.startsAt), endsAt: e.endsAt ? at(e.endsAt) : null, location: 'Point G, FMOS  Bamako, Mali' }).onConflictDoNothing()
  }
  for (const p of PUBLICATIONS) await db.insert(publications).values({ ...common, ...p }).onConflictDoNothing()
  for (const i of INSTITUTIONS) {
    await db.insert(institutions).values({ slug: i.slug, name: i.name, kind: i.kind, status: 'active', city: i.city, descriptionFr: i.d.fr, descriptionEn: i.d.en, sortOrder: i.sortOrder, isDemo: true }).onConflictDoNothing()
  }
  for (const p of PAGES) await db.insert(pages).values({ ...common, ...p }).onConflictDoNothing()
  // Contact details exactly as printed in the prototype footer and contact page.
  const [hasSite] = (await db.execute(sql`select 1 from settings where key = 'site'`)).rows
  if (!hasSite) {
    await putSetting(db, 'site', siteSettingsSchema.parse({
      technicalContactName: 'Cheickné H. DIAWARA', technicalContactPhone: '73489490 / 60397355', technicalContactEmail: 'cheick.diawara@usttb.edu.ml',
      ceoName: 'Pierre Claver B. Traore', ceoEmail: 'pcbako.traore@usttb.edu.ml', supportEmail: 'support@maliren.ml',
      addressLine: 'NOC Point G  Faculté de Médecine et d’Odontostomatologie, Bamako, Mali', asn: 'AS328318', ipv4Block: '196.50.16.0/22', peering: 'MLIX',
    }), null)
  }
  const [hasNotif] = (await db.execute(sql`select 1 from settings where key = 'notifications'`)).rows
  if (!hasNotif) await putSetting(db, 'notifications', notificationSettingsSchema.parse({}), null)
}

export const DEMO_USERS: { email: string; name: string; role: Role }[] = [
  { email: 'admin@maliren.ml', name: 'Super administrateur (démo)', role: 'super_admin' },
  { email: 'manager@maliren.ml', name: 'Administrateur (démo)', role: 'admin' },
  { email: 'editor@maliren.ml', name: 'Éditeur (démo)', role: 'editor' },
  { email: 'reviewer@maliren.ml', name: 'Lecture seule (démo)', role: 'reviewer' },
]

export async function seedUsers(db: Db, env: Env) {
  const created: string[] = []
  const add = async (email: string, name: string, role: Role, password: string, mustChange: boolean) => {
    const r = await db.insert(users).values({ email, name, role, passwordHash: await hashPassword(password, env.SCRYPT_N), mustChangePassword: mustChange }).onConflictDoNothing().returning({ id: users.id })
    if (r.length) created.push(email)
  }
  if (!env.isProd || env.ALLOW_DEMO_SEED) for (const u of DEMO_USERS) await add(u.email, u.name, u.role, env.DEMO_PASSWORD, false)
  if (env.SEED_ADMIN_EMAIL && env.SEED_ADMIN_PASSWORD) await add(env.SEED_ADMIN_EMAIL.toLowerCase(), 'Administrateur', 'super_admin', env.SEED_ADMIN_PASSWORD, true)
  return created
}

if (require.main === module) {
  const env = loadEnv()
  const { db, pool } = createDb(env.DATABASE_URL, 2)
  ;(async () => {
    // `--if-empty` (used by Docker Compose on every start) seeds only a brand-new database, so content that an
    // administrator deleted is never resurrected by a restart.
    if (process.argv.includes('--if-empty')) {
      const [row] = (await db.execute(sql`select (select count(*) from users)::int as u, (select count(*) from settings)::int as s`)).rows as { u: number; s: number }[]
      if (row.u > 0 || row.s > 0) { console.log('✔ Database already initialised  seed skipped.'); return }
    }
    await seedContent(db)
    await ensureSchedules(db)
    const created = await seedUsers(db, env)
    console.log('✔ Seed complete.')
    if (created.length) console.log(`  Users created: ${created.join(', ')}`)
    if (created.some((e) => e.endsWith('@maliren.ml'))) console.log(`  Demo password: ${env.DEMO_PASSWORD}  (DEMO ONLY  never use in production)`)
    if (env.isProd && !created.length) console.warn('  ⚠ Production: no users created. Set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD and re-run.')
  })().catch((e) => { console.error('✖ Seed failed', e); process.exitCode = 1 }).finally(() => pool.end())
}
