/**
 * scripts/seed-dev.ts — development seed cast.  Run with `npm run seed:dev`.
 *
 * Creates a fixed cast of tutors and parents plus the jobs, applications,
 * threads, demo requests, subscriptions and profile views needed to exercise
 * T3–T6 by hand.
 *
 * SAFETY
 *   1. Refuses to run when NODE_ENV === 'production'.
 *   2. Refuses to run unless BOTH SUPABASE_DB_URL and NEXT_PUBLIC_SUPABASE_URL
 *      point at the known dev project ref (see DEV_PROJECT_REF). This is what
 *      stops the script ever touching another project's data.
 *   3. Only ever deletes users whose email matches seed+*@tutormint.dev.
 *      Everything else in the database is left alone.
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

const DEV_PROJECT_REF = 'flhiraqouizzwnasuraj'
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

function die(msg: string): never {
  console.error(`\n✗ ${msg}\n`)
  process.exit(1)
}

function refOf(url: string | undefined, kind: 'db' | 'api'): string | null {
  if (!url) return null
  try {
    const u = new URL(url)
    // API: https://<ref>.supabase.co   DB: postgres.<ref>@...pooler.supabase.com
    return kind === 'api' ? u.hostname.split('.')[0] : (u.username.split('.')[1] ?? null)
  } catch {
    return null
  }
}

// ------------------------------------------------------------------ the cast
type TutorSpec = {
  name: string
  fullName: string
  city: string
  area: string
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
}

const TUTORS: TutorSpec[] = [
  {
    name: 'featured-ali', fullName: 'Ali Raza', city: 'Lahore', area: 'DHA Phase 5',
    headline: 'O/A Level Physics & Mathematics specialist',
    completion: 100, verification: 'verified', videoStatus: 'approved',
    plan: 'featured', rating: 4.9, ratingCount: 27,
    subjects: [['IGCSE', 'O Levels', 'Physics'], ['IGCSE', 'O Levels', 'Mathematics'], ['IGCSE', 'AS & A Levels', 'Physics']],
  },
  {
    name: 'premium-sara', fullName: 'Sara Khan', city: 'Karachi', area: 'Clifton',
    headline: 'A Level Chemistry and Mathematics tutor',
    completion: 100, verification: 'verified', videoStatus: 'approved',
    plan: 'premium', rating: 4.7, ratingCount: 14,
    subjects: [['IGCSE', 'AS & A Levels', 'Chemistry'], ['IGCSE', 'AS & A Levels', 'Mathematics']],
  },
  {
    name: 'verified-usman', fullName: 'Usman Tariq', city: 'Islamabad', area: 'F-8',
    headline: 'Matric Science tutor, 6 years experience',
    completion: 100, verification: 'verified', videoStatus: 'approved',
    plan: 'verified', rating: 4.5, ratingCount: 9,
    subjects: [['Matriculation', 'Grade 9 & 10 - Science', 'Physics'], ['Matriculation', 'Grade 9 & 10 - Science', 'Mathematics']],
  },
  {
    name: 'free-hina', fullName: 'Hina Aslam', city: 'Lahore', area: 'Gulberg',
    headline: 'Primary years English and Maths',
    completion: 100, verification: 'verified', videoStatus: 'approved',
    plan: null, rating: 4.6, ratingCount: 11,
    subjects: [['Primary', 'Grade 1 to 5', 'English'], ['Primary', 'Grade 1 to 5', 'Mathematics']],
  },
  {
    name: 'incomplete-bilal', fullName: 'Bilal Ahmed', city: 'Rawalpindi', area: 'Satellite Town',
    headline: '', completion: 40, verification: 'pending', videoStatus: 'none',
    plan: null, rating: 0, ratingCount: 0,
    subjects: [['Matriculation', 'Grade 9 & 10 - Arts', 'Mathematics']],
  },
  {
    name: 'suspended-omar', fullName: 'Omar Sheikh', city: 'Multan', area: 'Bosan Road',
    headline: 'Mathematics tutor',
    completion: 100, verification: 'suspended', videoStatus: 'rejected',
    plan: null, rating: 3.2, ratingCount: 4,
    subjects: [['Primary', 'Grade 1 to 5', 'Mathematics']],
  },
]

const PARENTS: ParentSpec[] = [
  { name: 'unverified-zain', fullName: 'Zain Malik', city: 'Lahore', cnicVerified: false, addressVerified: false, plan: null },
  { name: 'verified-fatima', fullName: 'Fatima Noor', city: 'Lahore', cnicVerified: true, addressVerified: true, plan: null },
  { name: 'featured-ayesha', fullName: 'Ayesha Siddiqui', city: 'Karachi', cnicVerified: true, addressVerified: true, plan: 'parent_featured' },
  { name: 'verified-kamran', fullName: 'Kamran Butt', city: 'Islamabad', cnicVerified: true, addressVerified: true, plan: null },
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

  if (process.env.NODE_ENV === 'production') {
    die('NODE_ENV is "production". This script only runs against a dev project.')
  }

  const dbRef = refOf(env.SUPABASE_DB_URL, 'db')
  const apiRef = refOf(env.NEXT_PUBLIC_SUPABASE_URL, 'api')

  if (dbRef !== DEV_PROJECT_REF || apiRef !== DEV_PROJECT_REF) {
    die(
      `Refusing to run against an unknown Supabase project.\n` +
        `  expected ref : ${DEV_PROJECT_REF}\n` +
        `  SUPABASE_DB_URL ref          : ${dbRef ?? '(unset/unparseable)'}\n` +
        `  NEXT_PUBLIC_SUPABASE_URL ref : ${apiRef ?? '(unset/unparseable)'}`,
    )
  }

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

  console.log(`\nSeeding dev project ${DEV_PROJECT_REF}\n`)

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
  console.log(`  created ${TUTORS.length} tutors + ${PARENTS.length} parents`)

  // ---- 3. flesh out tutor rows -------------------------------------------
  for (const t of TUTORS) {
    const id = ids[t.name]
    await db.from('profiles').update({ profile_completion: t.completion, city: t.city }).eq('id', id)

    await db
      .from('tutor_profiles')
      .update({
        slug: t.name,
        headline: t.headline,
        bio: t.headline ? `${t.fullName} — ${t.headline}.` : null,
        city: t.city,
        area: t.area,
        area_name: t.area,
        verification_status: t.verification,
        video_status: t.videoStatus,
        video_youtube_id: t.videoStatus === 'approved' ? `seedvid_${t.name}` : null,
        rating_avg: t.rating,
        rating_count: t.ratingCount,
        is_featured: t.plan === 'featured',
        hourly_rate_pkr: 2000,
        experience_years: 5,
        degrees: ['BS Physics — Punjab University (2019)'],
      })
      .eq('id', id)

    const masterIds = await resolveMasterIds(db, t.subjects)
    for (const master_id of masterIds) {
      await db.from('tutor_subjects').insert({ tutor_id: id, master_id })
    }

    if (t.plan) {
      await db.from('subscriptions').insert({
        user_id: id,
        plan_code: t.plan,
        starts_at: daysFromNow(-28),
        // featured-ali expires in 2 days, for the T-3 reminder path.
        expires_at: t.name === 'featured-ali' ? daysFromNow(2) : daysFromNow(30),
        status: 'active',
      })
    }
  }

  // ---- 4. flesh out parent rows ------------------------------------------
  for (const p of PARENTS) {
    const id = ids[p.name]
    await db
      .from('profiles')
      .update({
        city: p.city,
        cnic_number: p.cnicVerified ? '35202-0000000-0' : null,
        cnic_verified_at: p.cnicVerified ? new Date().toISOString() : null,
        address_verified_at: p.addressVerified ? new Date().toISOString() : null,
        address: p.addressVerified ? `House 1, ${p.city}` : null,
        profile_completion: p.cnicVerified ? 100 : 30,
      })
      .eq('id', id)

    if (p.plan) {
      await db.from('subscriptions').insert({
        user_id: id, plan_code: p.plan,
        starts_at: daysFromNow(-5), expires_at: daysFromNow(25), status: 'active',
      })
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
    await db.from('job_subjects').insert({ job_id: data.id, master_id: masterId })
  }

  // ---- 6. applications ----------------------------------------------------
  const APPLICATIONS: [string, string, string][] = [
    ['O Level Physics tutor needed, DHA', 'featured-ali', 'shortlisted'],
    ['O Level Physics tutor needed, DHA', 'premium-sara', 'applied'],
    ['A Level Chemistry tutor, Clifton', 'premium-sara', 'applied'],
    ['Matric Science tutor (filled)', 'verified-usman', 'hired'],
  ]
  for (const [title, tutor, status] of APPLICATIONS) {
    await db.from('applications').insert({
      job_id: jobIds[title],
      tutor_id: ids[tutor],
      status,
      message: 'Seeded application for development testing.',
    })
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
  await db.from('messages').insert({
    thread_id: thread.id,
    sender_id: ids['verified-fatima'],
    body,
    // legacy NOT NULL columns, dropped in T8
    job_id: 'SEED-JOB-001',
    sender: emailFor('verified-fatima'),
    recipient: emailFor('featured-ali'),
    message: body,
  })

  // ---- 8. demo request, profile views -------------------------------------
  await db.from('demo_requests').insert({
    parent_id: ids['verified-fatima'],
    tutor_id: ids['featured-ali'],
    status: 'pending',
  })

  for (const [tutor, desc] of [
    ['featured-ali', 'A parent searching O-Level Physics in DHA Phase 5 viewed your profile'],
    ['featured-ali', 'A parent searching A-Level Physics in Gulberg viewed your profile'],
    ['free-hina', 'A parent searching Primary Maths in Gulberg viewed your profile'],
  ] as const) {
    await db.from('profile_views').insert({
      tutor_id: ids[tutor], viewer_description: desc, time_ago: '2 hours ago',
    })
  }

  // ---- 9. summary ---------------------------------------------------------
  const pad = (s: string, n: number) => s.padEnd(n)
  console.log('\n  ' + pad('ACCOUNT', 26) + pad('ROLE', 8) + pad('PLAN', 17) + pad('STATE', 22) + 'SUBJECTS')
  console.log('  ' + '-'.repeat(96))
  for (const t of TUTORS) {
    console.log(
      '  ' + pad(emailFor(t.name), 26) + pad('tutor', 8) + pad(t.plan ?? 'none', 17) +
        pad(`${t.verification}, ${t.completion}%`, 22) + t.subjects.map((s) => s[2] ?? s[1]).join(', '),
    )
  }
  for (const p of PARENTS) {
    const state = p.cnicVerified ? 'CNIC+address verified' : 'unverified'
    console.log('  ' + pad(emailFor(p.name), 26) + pad('parent', 8) + pad(p.plan ?? 'free', 17) + pad(state, 22) + '—')
  }

  console.log('\n  ' + pad('OBJECT', 26) + 'COUNT')
  console.log('  ' + '-'.repeat(96))
  const counts: [string, number][] = [
    ['jobs', JOBS.length],
    ['  open', JOBS.filter((j) => j.status === 'open').length],
    ['  featured', JOBS.filter((j) => j.featured).length],
    ['  hired', JOBS.filter((j) => j.status === 'hired').length],
    ['applications', APPLICATIONS.length],
    ['threads', 1],
    ['messages (1 w/ phone no.)', 1],
    ['demo_requests (pending)', 1],
    ['subscriptions', TUTORS.filter((t) => t.plan).length + PARENTS.filter((p) => p.plan).length],
    ['profile_views', 3],
  ]
  for (const [k, v] of counts) console.log('  ' + pad(k, 26) + v)

  console.log(`\n  All passwords: ${SEED_PASSWORD}`)
  console.log('  featured-ali subscription expires in 2 days (T-3 reminder path)\n')
}

main().catch((e) => die(e instanceof Error ? e.message : String(e)))
