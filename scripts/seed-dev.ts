/**
 * scripts/seed-dev.ts — development seed cast.  Run with `npm run seed:dev`.
 *
 * Creates a fixed cast of tutors and parents plus the jobs, applications,
 * threads, demo requests, subscriptions and profile views needed to exercise
 * T3–T6 by hand.
 *
 * SAFETY
 *   1. Refuses to run against the live site (VERCEL_ENV when set, NODE_ENV
 *      otherwise -- the same rule as lib/env.ts and seed-cleanup.ts).
 *   2. Refuses to run when the target is the PRODUCTION project, unless
 *      ALLOW_SEED_ON_PRODUCTION=1 is set for that one invocation AND the
 *      operator types the project ref. See scripts/target.ts.
 *   3. Only ever deletes users whose email matches seed+*@tutormint.dev.
 *      Everything else in the database is left alone.
 *
 * THE GUARD USED TO BE INVERTED. It hardcoded the live project's ref as
 * `DEV_PROJECT_REF` and refused to run unless the target MATCHED it, so what
 * read as a safety rail was in fact a requirement to point at production.
 * There is one Supabase project and it serves tutormint.org; this script
 * writes to it, and now says so before it does.
 *
 * IDEMPOTENT: each run first deletes exactly the seed users; FK cascades from
 * auth.users remove their profiles, jobs, applications, threads, messages,
 * demo requests and subscriptions. profile_views has no FK to auth.users, so
 * it is cleaned explicitly.
 *
 * WHY A SERVICE ROLE KEY IS REQUIRED
 *   Email confirmation is ON, and this project has no working SMTP sender:
 *   supabase.auth.signUp() currently fails outright with "Error sending
 *   confirmation email", so the anon-key route cannot create the cast at all.
 *   supabase.auth.admin.createUser({ email_confirm: true }) creates confirmed
 *   users in one step without sending any email, and needs the service role
 *   key. The key is read from the environment, is never written to a file, and
 *   must never be exposed to the browser (no NEXT_PUBLIC_ prefix).
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import sharp from 'sharp'
import { guardWrites, die, PRODUCTION_PROJECT_REF } from './target'
import { storeDocument } from '../lib/documents'
import { calculateTutorCompletion } from '../lib/profileChecklist'

/**
 * A plain coloured PNG, used as a stand-in avatar and as the "scan" behind the
 * seeded CNIC and degree documents. Generated rather than committed so no
 * image that could be mistaken for a real person's identity document is ever
 * in the repository. The document path still runs the real watermarking, so a
 * seeded certificate preview looks exactly like a live one.
 */
async function solidPng(colour: string): Promise<Uint8Array<ArrayBuffer>> {
  const buf = await sharp({
    create: { width: 600, height: 400, channels: 3, background: colour },
  })
    .png()
    .toBuffer()
  // Copied into a plain ArrayBuffer: File/Blob will not accept a view whose
  // backing store TypeScript widens to SharedArrayBuffer, which is what a
  // Node Buffer's type says.
  const out = new Uint8Array(new ArrayBuffer(buf.byteLength))
  out.set(buf)
  return out
}

const SEED_PREFIX = 'seed+'
const SEED_DOMAIN = '@tutormint.dev'
const SEED_PASSWORD = 'Test1234!'

// ---------------------------------------------------------------- env loading
function loadEnv(): Record<string, string> {
  const env: Record<string, string> = { ...(process.env as Record<string, string>) }
  try {
    for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
      if (!line || line.trimStart().startsWith('#') || !line.includes('=')) continue
      const i = line.indexOf('=')
      const k = line.slice(0, i).trim()
      const v = line.slice(i + 1).trim().replace(/^["']|["']$/g, '')
      if (!(k in env) || !env[k]) env[k] = v
    }
  } catch {
    // .env.local is optional when the vars are already exported.
  }
  return env
}

/**
 * Every write goes through here. An earlier version ignored the error field,
 * so two silent failures (a UNIQUE violation on profiles.cnic_number and a
 * CHECK violation on demo_requests.status) went unnoticed because the summary
 * printed the spec rather than the database. Fail loudly instead.
 */
async function must<T>(what: string, p: PromiseLike<{ data: T; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await p
  if (error) die(`${what}: ${error.message}`)
  return data
}

// ------------------------------------------------------------------ the cast
type TutorSpec = {
  name: string
  fullName: string
  city: string
  area: string
  /** Synthetic dev number, so the contact-reveal path has something to reveal. */
  phone: string
  gender: 'male' | 'female'
  /** Synthetic CNIC. Unique -- profiles.cnic_number carries a UNIQUE index. */
  cnic: string
  /** Spread across the three values so the browse mode filter is testable. */
  teachingMode: 'in_person' | 'online' | 'both'
  headline: string
  completion: number
  verification: 'pending' | 'verified' | 'rejected' | 'suspended'
  videoStatus: 'none' | 'uploaded' | 'approved' | 'rejected'
  plan: 'featured' | 'premium' | 'verified' | null
  rating: number
  ratingCount: number
  /** [category, level, subject|null] triples, resolved to taxonomy_master ids */
  subjects: [string, string, string | null][]
}

type ParentSpec = {
  name: string
  fullName: string
  city: string
  cnicVerified: boolean
  addressVerified: boolean
  plan: 'parent_featured' | null
  /** profiles.cnic_number is UNIQUE, so every verified parent needs its own. */
  cnic: string | null
  /** Children, so a job can reference one and the dashboard has something to show. */
  children?: { name: string; classLevel: string }[]
}

const TUTORS: TutorSpec[] = [
  {
    name: 'featured-ali', teachingMode: 'in_person', gender: 'male', cnic: '35201-2000001-1', phone: '03000000001', fullName: 'Ali Raza', city: 'Lahore', area: 'DHA Phase 5',
    headline: 'O/A Level Physics & Mathematics specialist',
    completion: 100, verification: 'verified', videoStatus: 'approved',
    plan: 'featured', rating: 4.9, ratingCount: 27,
    subjects: [['IGCSE', 'O Levels', 'Physics'], ['IGCSE', 'O Levels', 'Mathematics'], ['IGCSE', 'AS & A Levels', 'Physics']],
  },
  {
    name: 'premium-sara', teachingMode: 'both', gender: 'female', cnic: '42101-2000002-2', phone: '03000000002', fullName: 'Sara Khan', city: 'Karachi', area: 'Clifton',
    headline: 'A Level Chemistry and Mathematics tutor',
    completion: 100, verification: 'verified', videoStatus: 'approved',
    plan: 'premium', rating: 4.7, ratingCount: 14,
    subjects: [['IGCSE', 'AS & A Levels', 'Chemistry'], ['IGCSE', 'AS & A Levels', 'Mathematics']],
  },
  {
    name: 'verified-usman', teachingMode: 'online', gender: 'male', cnic: '61101-2000003-3', phone: '03000000003', fullName: 'Usman Tariq', city: 'Islamabad', area: 'F-8',
    headline: 'Matric Science tutor, 6 years experience',
    completion: 100, verification: 'verified', videoStatus: 'approved',
    plan: 'verified', rating: 4.5, ratingCount: 9,
    subjects: [['Matriculation', 'Grade 9 & 10 - Science', 'Physics'], ['Matriculation', 'Grade 9 & 10 - Science', 'Mathematics']],
  },
  {
    name: 'free-hina', teachingMode: 'both', gender: 'female', cnic: '35202-2000004-4', phone: '03000000004', fullName: 'Hina Aslam', city: 'Lahore', area: 'Gulberg',
    headline: 'Primary years English and Maths',
    completion: 100, verification: 'verified', videoStatus: 'approved',
    plan: null, rating: 4.6, ratingCount: 11,
    subjects: [['Primary', 'Grade 1 to 5', 'English'], ['Primary', 'Grade 1 to 5', 'Mathematics']],
  },
  {
    // The free-but-complete tier. Ranking needs one: without it there is no
    // fixture for tier 0, and "featured > premium > verified > free" cannot be
    // demonstrated end to end. free-hina used to serve this purpose until T3.5
    // granted her Premium for testing.
    name: 'free-nadia', teachingMode: 'both', gender: 'female', cnic: '35201-2000007-7', phone: '03000000007', fullName: 'Nadia Iqbal', city: 'Lahore', area: 'Johar Town',
    headline: 'Matric and O Level Mathematics',
    completion: 100, verification: 'verified', videoStatus: 'approved',
    plan: null, rating: 4.3, ratingCount: 6,
    subjects: [['Matriculation', 'Grade 9 & 10 - Science', 'Mathematics'], ['IGCSE', 'O Levels', 'Mathematics']],
  },
  {
    // Deliberately incomplete: proves that a tutor below 100% is not listed,
    // however good their intentions. Do not "fix" this fixture.
    name: 'incomplete-bilal', teachingMode: 'both', gender: 'male', cnic: '37405-2000005-5', phone: '03000000005', fullName: 'Bilal Ahmed', city: 'Rawalpindi', area: 'Satellite Town',
    headline: '', completion: 40, verification: 'pending', videoStatus: 'none',
    plan: null, rating: 0, ratingCount: 0,
    subjects: [['Matriculation', 'Grade 9 & 10 - Arts', 'Mathematics']],
  },
  {
    name: 'suspended-omar', teachingMode: 'in_person', gender: 'male', cnic: '36302-2000006-6', phone: '03000000006', fullName: 'Omar Sheikh', city: 'Multan', area: 'Bosan Road',
    headline: 'Mathematics tutor',
    completion: 100, verification: 'suspended', videoStatus: 'rejected',
    plan: null, rating: 3.2, ratingCount: 4,
    subjects: [['Primary', 'Grade 1 to 5', 'Mathematics']],
  },
]

const PARENTS: ParentSpec[] = [
  { name: 'unverified-zain', fullName: 'Zain Malik', city: 'Lahore', cnicVerified: false, addressVerified: false, plan: null, cnic: null },
  {
    name: 'verified-fatima', fullName: 'Fatima Noor', city: 'Lahore',
    cnicVerified: true, addressVerified: true, plan: null, cnic: '35202-1000001-1',
    // Two children: enough to prove a job can be tied to one of several, and
    // that the picker is not a single-child special case.
    children: [
      { name: 'Ayaan', classLevel: 'Grade 9 & 10 - Science' },
      { name: 'Zoya', classLevel: 'Grade 1 to 5' },
    ],
  },
  { name: 'featured-ayesha', fullName: 'Ayesha Siddiqui', city: 'Karachi', cnicVerified: true, addressVerified: true, plan: 'parent_featured', cnic: '42101-1000002-2' },
  { name: 'verified-kamran', fullName: 'Kamran Butt', city: 'Islamabad', cnicVerified: true, addressVerified: true, plan: null, cnic: '61101-1000003-3' },
]

// Staff accounts, one per admin_role below owner.
//
// The owner is a real person's account, set by SQL in 08_admin_bootstrap.sql
// and never created here. These exist so the permission matrix can actually be
// tested: "verifier is refused on /admin/payments" is only evidence if there is
// a verifier to refuse. They carry no data of their own.
type StaffSpec = { name: string; fullName: string; adminRole: 'manager' | 'verifier' | 'finance' | 'support' }

const STAFF: StaffSpec[] = [
  { name: 'manager', fullName: 'Manager Admin', adminRole: 'manager' },
  { name: 'verifier', fullName: 'Verifier Admin', adminRole: 'verifier' },
  { name: 'finance', fullName: 'Finance Admin', adminRole: 'finance' },
  { name: 'support', fullName: 'Support Admin', adminRole: 'support' },
]

const emailFor = (name: string) => `${SEED_PREFIX}${name}${SEED_DOMAIN}`

// ------------------------------------------------------------------ helpers
async function resolveMasterIds(
  db: SupabaseClient,
  triples: [string, string, string | null][],
): Promise<number[]> {
  const ids: number[] = []
  for (const [category, level, subject] of triples) {
    // Resolved through slugs rather than PostgREST embeds, so this does not
    // depend on relationship naming. Fails loudly rather than guessing an id.
    const { data: cat } = await db.from('taxonomy_categories').select('slug').eq('name', category).maybeSingle()
    if (!cat) die(`taxonomy category not found: "${category}"`)
    const { data: lvl } = await db
      .from('taxonomy_levels').select('slug').eq('name', level).eq('category_slug', cat.slug).maybeSingle()
    if (!lvl) die(`taxonomy level not found: "${category}" > "${level}"`)

    let query = db
      .from('taxonomy_master')
      .select('id, subject_slug')
      .eq('category_slug', cat.slug)
      .eq('level_slug', lvl.slug)

    if (subject === null) {
      query = query.is('subject_slug', null)
    } else {
      const { data: sub } = await db.from('taxonomy_subjects').select('slug').eq('name', subject).maybeSingle()
      if (!sub) die(`taxonomy subject not found: "${subject}"`)
      query = query.eq('subject_slug', sub.slug)
    }

    const { data: master } = await query.maybeSingle()
    if (!master) die(`taxonomy_master row not found: ${category} > ${level} > ${subject ?? '(level-leaf)'}`)
    ids.push(master.id as number)
  }
  return ids
}

const daysFromNow = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString()

// --------------------------------------------------------------------- main
async function main() {
  const env = loadEnv()

  const vercelEnv = process.env.VERCEL_ENV
  const live = vercelEnv ? vercelEnv === 'production' : process.env.NODE_ENV === 'production'
  if (live) {
    die(
      vercelEnv
        ? `VERCEL_ENV is "${vercelEnv}". This script only runs against a dev project.`
        : 'NODE_ENV is "production". This script only runs against a dev project.',
    )
  }

  const target = await guardWrites({
    scriptName: 'seed:dev -- development seed cast',
    env,
    action:
      'Creates the seed+*@tutormint.dev cast, and first DELETES any that already ' +
      'exist, along with their jobs, applications, threads and messages.',
  })

  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceKey) {
    die(
      'SUPABASE_SERVICE_ROLE_KEY is not set.\n\n' +
        '  Email confirmation is ON and this project has no working SMTP sender, so\n' +
        '  supabase.auth.signUp() fails with "Error sending confirmation email" and\n' +
        '  cannot create the cast. Creating confirmed users without sending email\n' +
        '  needs the service role key:\n\n' +
        '    Supabase dashboard -> Project Settings -> API -> service_role (secret)\n' +
        '    add to .env.local as:  SUPABASE_SERVICE_ROLE_KEY=...\n\n' +
        '  Server-only. Never prefix it with NEXT_PUBLIC_ and never ship it to the browser.',
    )
  }

  const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  console.log(
    `Seeding ${target.isProduction ? `PRODUCTION (${PRODUCTION_PROJECT_REF})` : `project ${target.apiRef}`}`,
  )

  // ---- 1. wipe exactly the seed users ------------------------------------
  const { data: list, error: listErr } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 })
  if (listErr) die(`could not list users: ${listErr.message}`)

  const stale = list.users.filter(
    (u) => u.email?.startsWith(SEED_PREFIX) && u.email.endsWith(SEED_DOMAIN),
  )
  for (const u of stale) {
    await db.from('profile_views').delete().eq('tutor_id', u.id)
    const { error } = await db.auth.admin.deleteUser(u.id)
    if (error) die(`could not delete ${u.email}: ${error.message}`)
  }
  console.log(`  wiped ${stale.length} existing seed user(s)`)

  // ---- 2. create the cast -------------------------------------------------
  const ids: Record<string, string> = {}

  for (const t of TUTORS) {
    const { data, error } = await db.auth.admin.createUser({
      email: emailFor(t.name),
      password: SEED_PASSWORD,
      email_confirm: true, // confirmed without sending an email
      user_metadata: { role: 'tutor', full_name: t.fullName, city: t.city },
    })
    if (error) die(`createUser ${t.name}: ${error.message}`)
    ids[t.name] = data.user.id
  }

  for (const p of PARENTS) {
    const { data, error } = await db.auth.admin.createUser({
      email: emailFor(p.name),
      password: SEED_PASSWORD,
      email_confirm: true,
      user_metadata: { role: 'parent', full_name: p.fullName, city: p.city },
    })
    if (error) die(`createUser ${p.name}: ${error.message}`)
    ids[p.name] = data.user.id
  }
  for (const a of STAFF) {
    const { data, error } = await db.auth.admin.createUser({
      email: emailFor(a.name),
      password: SEED_PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: a.fullName },
    })
    if (error) die(`createUser ${a.name}: ${error.message}`)
    ids[a.name] = data.user.id

    // role and admin_role are deliberately NOT settable from signup metadata
    // (14_handle_new_user.sql refuses), so they are written here with the
    // service key -- the same way the owner's row is written by SQL.
    await must(`staff profile (${a.name})`,
      db.from('profiles').update({
        role: 'admin',
        admin_role: a.adminRole,
        full_name: a.fullName,
      }).eq('id', data.user.id))
  }

  console.log(`  created ${TUTORS.length} tutors + ${PARENTS.length} parents + ${STAFF.length} staff`)

  // ---- 3. flesh out tutor rows -------------------------------------------
  for (const t of TUTORS) {
    const id = ids[t.name]

    // A tutor the spec marks as complete gets every checklist item filled for
    // real. An intentionally incomplete one gets only the basics, so the
    // checklist arrives at a number below 100 on its own merits.
    const wantComplete = t.completion >= 100

    await must(`profiles update (${t.name})`,
      db.from('profiles').update({
        city: t.city,
        cnic_number: wantComplete ? t.cnic : null,
        // Synthetic dev numbers so the contact-reveal path is testable: a
        // Featured parent has to have something to reveal. profiles is the
        // canonical home for these -- it is where the OTP route writes.
        phone_number: t.phone,
        whatsapp: t.phone,
        phone_verified_at: wantComplete ? new Date().toISOString() : null,
      }).eq('id', id).select('id'))

    await must(`tutor_profiles update (${t.name})`, db
      .from('tutor_profiles')
      .update({
        slug: t.name,
        headline: t.headline,
        bio: t.headline ? `${t.fullName} — ${t.headline}.` : null,
        city: t.city,
        area: t.area,
        verification_status: t.verification,
        video_status: t.videoStatus,
        video_youtube_id: t.videoStatus === 'approved' ? `seedvid_${t.name}` : null,
        rating_avg: t.rating,
        rating_count: t.ratingCount,
        is_featured: t.plan === 'featured',
        gender: wantComplete ? t.gender : null,
        teaching_mode: t.teachingMode,
        hourly_rate_pkr: 2000,
        experience_years: 5,
        degrees: ['BS Physics — Punjab University (2019)'],
      })
      .eq('id', id)
      .select('id'))

    // Real documents and a real photo, so profile_completion can be COMPUTED
    // rather than asserted. The seed used to write profile_completion = 100
    // while leaving gender, photo, CNIC and certificates empty; the first time
    // such a tutor opened their dashboard the checklist recomputed against
    // live data and the tutor silently dropped out of the public directory.
    // A fixture that only looks complete is worse than no fixture.
    if (wantComplete) {
    const avatarPath = `${id}/seed-avatar.png`
    const avatarBytes = await solidPng(t.gender === 'female' ? '#d60008' : '#0F172A')
    await db.storage.from('avatars').upload(avatarPath, avatarBytes, {
      contentType: 'image/png',
      upsert: true,
    })
    const avatarUrl = db.storage.from('avatars').getPublicUrl(avatarPath).data.publicUrl

    const { data: existingDocs } = await db
      .from('user_documents')
      .select('id, kind, original_path')
      .eq('user_id', id)

    let cnicPath = (existingDocs ?? []).find((d) => d.kind === 'cnic')?.original_path ?? null

    if (!cnicPath) {
      const cnicDoc = await storeDocument(
        db,
        id,
        'cnic',
        new File([await solidPng('#334155')], 'cnic.png', { type: 'image/png' }),
      )
      if (!cnicDoc.ok) die(`cnic document (${t.name}): ${cnicDoc.error}`)
      cnicPath = cnicDoc.doc.originalPath
    }

    if (!(existingDocs ?? []).some((d) => d.kind === 'degree')) {
      const degreeDoc = await storeDocument(
        db,
        id,
        'degree',
        new File([await solidPng('#059669')], 'degree.png', { type: 'image/png' }),
        'BS Physics — Punjab University (2019)',
      )
      if (!degreeDoc.ok) die(`degree document (${t.name}): ${degreeDoc.error}`)
    }

    await must(`profiles docs (${t.name})`,
      db.from('profiles').update({ cnic_image_path: cnicPath }).eq('id', id).select('id'))
    await must(`tutor_profiles avatar (${t.name})`,
      db.from('tutor_profiles').update({ avatar_url: avatarUrl }).eq('id', id).select('id'))
    }

    const masterIds = await resolveMasterIds(db, t.subjects)
    for (const master_id of masterIds) {
      await must(`tutor_subjects (${t.name})`,
        db.from('tutor_subjects').insert({ tutor_id: id, master_id }).select('master_id'))
    }

    // Now that every item exists, let the shipping checklist decide the number.
    const { data: freshProfile } = await db
      .from('profiles')
      .select('full_name, city, cnic_number, cnic_image_path, phone_verified_at')
      .eq('id', id)
      .maybeSingle()
    const { data: freshTutor } = await db
      .from('tutor_profiles')
      .select('gender, area, avatar_url, headline, bio, experience_years, hourly_rate_pkr, teaching_mode, degrees, video_youtube_id, video_status')
      .eq('id', id)
      .maybeSingle()

    const computed = calculateTutorCompletion({
      profile: freshProfile,
      tutorProfile: freshTutor,
      subjectCount: masterIds.length,
      degreeDocCount: wantComplete ? 1 : 0,
    })

    // Assert the intent, not a magic number: a "complete" fixture must reach
    // 100 through the real checklist, and an incomplete one must not.
    if (wantComplete && computed.percent !== 100) {
      die(
        `${t.name}: expected a complete profile but the checklist says ${computed.percent}%. ` +
          `Missing: ${computed.items.filter((i) => !i.done).map((i) => i.key).join(', ')}`,
      )
    }
    if (!wantComplete && computed.percent >= 100) {
      die(`${t.name}: expected an incomplete profile but the checklist says 100%.`)
    }
    await must(`profile_completion (${t.name})`,
      db.from('profiles').update({ profile_completion: computed.percent }).eq('id', id).select('id'))

    if (t.plan) {
      await must(`subscription (${t.name})`, db.from('subscriptions').insert({
        user_id: id,
        plan_code: t.plan,
        starts_at: daysFromNow(-28),
        // featured-ali expires in 2 days, for the T-3 reminder path.
        expires_at: t.name === 'featured-ali' ? daysFromNow(2) : daysFromNow(30),
        status: 'active',
      }).select('id'))
    }
  }

  // ---- 4. flesh out parent rows ------------------------------------------
  for (const p of PARENTS) {
    const id = ids[p.name]
    await must(
      `profiles update (${p.name})`,
      db
        .from('profiles')
        .update({
          city: p.city,
          cnic_number: p.cnic,
          cnic_verified_at: p.cnicVerified ? new Date().toISOString() : null,
          address_verified_at: p.addressVerified ? new Date().toISOString() : null,
          address: p.addressVerified ? `House 1, ${p.city}` : null,
          profile_completion: p.cnicVerified ? 100 : 30,
        })
        .eq('id', id)
        .select('id'),
    )

    for (const child of p.children ?? []) {
      await must(
        `child ${child.name} (${p.name})`,
        db
          .from('children')
          .insert({ parent_id: id, name: child.name, class_level: child.classLevel })
          .select('id'),
      )
    }

    if (p.plan) {
      await must(
        `subscription (${p.name})`,
        db
          .from('subscriptions')
          .insert({
            user_id: id, plan_code: p.plan,
            starts_at: daysFromNow(-5), expires_at: daysFromNow(25), status: 'active',
          })
          .select('id'),
      )
    }
  }

  // ---- 5. jobs ------------------------------------------------------------
  type JobSpec = {
    parent: string
    title: string
    subject: [string, string, string | null]
    classLevel: string
    city: string
    area: string
    budget: number
    status: 'open' | 'closed' | 'hired'
    featured?: boolean
    hiredTutor?: string
  }

  const JOBS: JobSpec[] = [
    { parent: 'verified-fatima', title: 'O Level Physics tutor needed, DHA', subject: ['IGCSE', 'O Levels', 'Physics'], classLevel: 'O Levels', city: 'Lahore', area: 'DHA Phase 5', budget: 30000, status: 'open' },
    { parent: 'verified-fatima', title: 'Primary Maths help for Grade 3', subject: ['Primary', 'Grade 1 to 5', 'Mathematics'], classLevel: 'Grade 1 to 5', city: 'Lahore', area: 'Gulberg', budget: 15000, status: 'open' },
    { parent: 'verified-fatima', title: 'IELTS preparation, evenings', subject: ['Test Preparations', 'IELTS Preparation', null], classLevel: 'IELTS Preparation', city: 'Lahore', area: 'Model Town', budget: 25000, status: 'open' },
    { parent: 'featured-ayesha', title: 'A Level Chemistry tutor, Clifton', subject: ['IGCSE', 'AS & A Levels', 'Chemistry'], classLevel: 'AS & A Levels', city: 'Karachi', area: 'Clifton', budget: 45000, status: 'open', featured: true },
    { parent: 'verified-kamran', title: 'Matric Science tutor (filled)', subject: ['Matriculation', 'Grade 9 & 10 - Science', 'Physics'], classLevel: 'Grade 9 & 10 - Science', city: 'Islamabad', area: 'F-8', budget: 28000, status: 'hired', hiredTutor: 'verified-usman' },
  ]

  const jobIds: Record<string, string> = {}
  let jobSeq = 0

  for (const j of JOBS) {
    jobSeq += 1
    const [masterId] = await resolveMasterIds(db, [j.subject])
    const subjectName = j.subject[2] ?? j.subject[1]

    const { data, error } = await db
      .from('jobs')
      .insert({
        parent_id: ids[j.parent],
        job_tx_id: `SEED-JOB-${String(jobSeq).padStart(3, '0')}`,
        title: j.title,
        subjects: [subjectName],
        class_level: j.classLevel,
        city: j.city,
        area: j.area,
        budget_pkr: j.budget,
        description: `${j.title}. Seeded row for development.`,
        status: j.status,
        is_featured: j.featured ?? false,
        hired_tutor_id: j.hiredTutor ? ids[j.hiredTutor] : null,
        // legacy NOT NULL columns, dropped in T8
        subject: subjectName, grade: j.classLevel, budget: `${j.budget} PKR / mo`, timings: 'Evenings',
      })
      .select('id')
      .single()

    if (error) die(`job insert (${j.title}): ${error.message}`)
    jobIds[j.title] = data.id
    await must(`job_subjects (${j.title})`,
      db.from('job_subjects').insert({ job_id: data.id, master_id: masterId }).select('master_id'))
  }

  // ---- 6. applications ----------------------------------------------------
  const APPLICATIONS: [string, string, string][] = [
    ['O Level Physics tutor needed, DHA', 'featured-ali', 'shortlisted'],
    ['O Level Physics tutor needed, DHA', 'premium-sara', 'applied'],
    ['A Level Chemistry tutor, Clifton', 'premium-sara', 'applied'],
    ['Matric Science tutor (filled)', 'verified-usman', 'hired'],
  ]
  for (const [title, tutor, status] of APPLICATIONS) {
    await must(`application (${tutor} -> ${title})`, db.from('applications').insert({
      job_id: jobIds[title],
      tutor_id: ids[tutor],
      status,
      message: 'Seeded application for development testing.',
    }).select('id'))
  }

  // ---- 7. thread + message containing a phone number ----------------------
  const { data: thread, error: threadErr } = await db
    .from('threads')
    .insert({
      job_id: jobIds['O Level Physics tutor needed, DHA'],
      participant_a: ids['verified-fatima'],
      participant_b: ids['featured-ali'],
      initiated_by: ids['verified-fatima'],
    })
    .select('id')
    .single()
  if (threadErr) die(`thread insert: ${threadErr.message}`)

  // Body deliberately contains a phone number, for the T5 masking work.
  const body = 'Assalam-o-Alaikum, can you call me on 0321-4567890 to discuss timings?'
  await must('message', db.from('messages').insert({
    thread_id: thread.id,
    sender_id: ids['verified-fatima'],
    body,
    // legacy NOT NULL columns, dropped in T8
    job_id: 'SEED-JOB-001',
    sender: emailFor('verified-fatima'),
    recipient: emailFor('featured-ali'),
    message: body,
  }).select('id'))

  // ---- 8. demo request, profile views -------------------------------------
  // demo_requests.status is CHECKed against
  // requested|accepted|declined|completed|cancelled -- there is no 'pending'.
  // 'requested' is the awaiting-tutor-response state the cast calls for.
  await must(
    'demo_request',
    db
      .from('demo_requests')
      .insert({
        parent_id: ids['verified-fatima'],
        tutor_id: ids['featured-ali'],
        status: 'requested',
      })
      .select('id'),
  )

  for (const [tutor, desc] of [
    ['featured-ali', 'A parent searching O-Level Physics in DHA Phase 5 viewed your profile'],
    ['featured-ali', 'A parent searching A-Level Physics in Gulberg viewed your profile'],
    ['free-hina', 'A parent searching Primary Maths in Gulberg viewed your profile'],
  ] as const) {
    await must('profile_view', db.from('profile_views').insert({
      tutor_id: ids[tutor], viewer_description: desc, time_ago: '2 hours ago',
    }).select('id'))
  }

  // ---- 9. summary ---------------------------------------------------------
  // Read back from the database rather than printing the spec. An earlier
  // version printed what it meant to create, which hid two silent write
  // failures. Everything below is what the database actually holds.
  const pad = (s: string, n: number) => s.padEnd(n)
  const seedEmails = [...TUTORS, ...PARENTS].map((x) => emailFor(x.name))

  const rows = await must(
    'summary: profiles',
    db
      .from('profiles')
      .select('id, email, role, profile_completion, cnic_verified_at, address_verified_at')
      .in('email', seedEmails),
  )
  const subs = await must('summary: subscriptions', db.from('subscriptions').select('user_id, plan_code, expires_at'))
  const tps = await must(
    'summary: tutor_profiles',
    db.from('tutor_profiles').select('id, email, verification_status, video_status, rating_avg').in('email', seedEmails),
  )

  const planOf = (id: string) => subs?.find((s) => s.user_id === id)?.plan_code ?? 'none'
  const W = 36

  console.log('\n  ' + pad('ACCOUNT', W) + pad('ROLE', 8) + pad('PLAN', 17) + pad('STATE', 24) + 'SUBJECTS')
  console.log('  ' + '-'.repeat(108))

  for (const t of TUTORS) {
    const row = rows?.find((r) => r.email === emailFor(t.name))
    const tp = tps?.find((x) => x.email === emailFor(t.name))
    const nSubjects = row
      ? (await must('summary: tutor_subjects', db.from('tutor_subjects').select('master_id').eq('tutor_id', row.id)))?.length ?? 0
      : 0
    console.log(
      '  ' + pad(emailFor(t.name), W) + pad('tutor', 8) + pad(planOf(row!.id), 17) +
        pad(`${tp?.verification_status}, ${row?.profile_completion}%, ★${tp?.rating_avg}`, 24) +
        `${nSubjects} via taxonomy_master`,
    )
  }

  for (const p of PARENTS) {
    const row = rows?.find((r) => r.email === emailFor(p.name))
    const state = row?.cnic_verified_at && row?.address_verified_at ? 'CNIC+address verified' : 'unverified'
    console.log(
      '  ' + pad(emailFor(p.name), W) + pad('parent', 8) + pad(planOf(row!.id), 17) +
        pad(`${state}, ${row?.profile_completion}%`, 24) + '—',
    )
  }

  const countOf = async (table: string, col: string, ids: string[]) =>
    (await must(`summary: ${table}`, db.from(table).select(col).in(col, ids)))?.length ?? 0

  const seedIds = rows!.map((r) => r.id)
  const jobRows = await must('summary: jobs', db.from('jobs').select('id, status, is_featured').in('parent_id', seedIds))
  const jobIdList = jobRows!.map((j) => j.id)

  console.log('\n  ' + pad('OBJECT', W) + 'COUNT (read back from the database)')
  console.log('  ' + '-'.repeat(108))
  const counts: [string, number | string][] = [
    ['jobs', jobRows!.length],
    ['  open', jobRows!.filter((j) => j.status === 'open').length],
    ['  featured tag', jobRows!.filter((j) => j.is_featured).length],
    ['  hired', jobRows!.filter((j) => j.status === 'hired').length],
    ['job_subjects', await countOf('job_subjects', 'job_id', jobIdList)],
    ['tutor_subjects', await countOf('tutor_subjects', 'tutor_id', seedIds)],
    ['applications', await countOf('applications', 'tutor_id', seedIds)],
    ['threads', await countOf('threads', 'participant_a', seedIds)],
    ['messages (1 with a phone no.)', (await must('summary: messages', db.from('messages').select('id, body').in('sender_id', seedIds)))!.length],
    ['demo_requests (requested)', await countOf('demo_requests', 'parent_id', seedIds)],
    ['subscriptions', await countOf('subscriptions', 'user_id', seedIds)],
    ['profile_views', await countOf('profile_views', 'tutor_id', seedIds)],
  ]
  for (const [k, v] of counts) console.log('  ' + pad(k, W) + v)

  const aliSub = subs?.find((s) => s.user_id === rows?.find((r) => r.email === emailFor('featured-ali'))?.id)
  const daysLeft = aliSub ? Math.round((new Date(aliSub.expires_at).getTime() - Date.now()) / 86_400_000) : null

  console.log(`\n  All passwords: ${SEED_PASSWORD}`)
  console.log(`  featured-ali subscription expires in ${daysLeft} day(s) — T-3 reminder path\n`)
}

main().catch((e) => die(e instanceof Error ? e.message : String(e)))
