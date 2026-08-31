/**
 * scripts/verify-schema.ts
 *
 * Read-only verification of the T1 schema. Runs SELECTs only -- it never
 * writes, alters or drops anything.
 *
 * Usage (no local psql needed; uses the postgres:17 image):
 *   npx tsx scripts/verify-schema.ts
 * or, as it is dependency-free at runtime, via the docker helper in the repo
 * notes. It reads SUPABASE_DB_URL from .env.local.
 */

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

type Check = { group: string; name: string; pass: boolean; detail: string }

const EXPECTED_TABLES: Record<string, string[]> = {
  profiles: [
    'id', 'role', 'account_type', 'full_name', 'email', 'phone_number', 'whatsapp',
    'phone_verified_at', 'city', 'province', 'address', 'cnic_number',
    'cnic_image_path', 'cnic_verified_at', 'address_verified_at', 'avatar_url',
    'profile_completion', 'created_at',
  ],
  tutor_profiles: [
    'id', 'slug', 'headline', 'bio', 'subjects', 'class_levels', 'degrees',
    'teaching_mode', 'online_platforms', 'area', 'hourly_rate_pkr',
    'experience_years', 'video_youtube_id', 'video_status', 'verification_status',
    'rating_avg', 'rating_count',
  ],
  plans: [
    'code', 'audience', 'name', 'price_pkr', 'duration_days', 'monthly_quota',
    'displayed_quota', 'can_view_contact', 'can_whatsapp', 'can_initiate_message',
    'search_rank', 'badges', 'tag_label',
  ],
  subscriptions: ['id', 'user_id', 'plan_code', 'starts_at', 'expires_at', 'status', 'payment_id'],
  payments: [
    'id', 'user_id', 'plan_code', 'amount_pkr', 'method', 'reference',
    'screenshot_path', 'status', 'reviewed_by', 'reviewed_at', 'created_at',
  ],
  usage_counters: ['user_id', 'period', 'jobs_applied', 'jobs_posted', 'messages_initiated'],
  jobs: [
    'id', 'job_tx_id', 'parent_id', 'title', 'subjects', 'class_level', 'city',
    'area', 'teaching_mode', 'budget_pkr', 'description', 'status',
    'hired_tutor_id', 'is_featured', 'created_at',
  ],
  applications: ['id', 'job_id', 'tutor_id', 'message', 'status', 'created_at'],
  threads: ['id', 'job_id', 'participant_a', 'participant_b', 'initiated_by'],
  messages: ['id', 'thread_id', 'sender_id', 'body', 'created_at'],
  reviews: ['id', 'tutor_id', 'parent_id', 'rating', 'comment', 'created_at'],
  phone_otps: ['phone', 'expires_at', 'consumed_at', 'attempts'],
  shortlists: ['user_id', 'tutor_id'],
  demo_requests: ['id', 'parent_id', 'tutor_id', 'status', 'created_at'],
  tutor_subjects: ['tutor_id', 'subject_slug'],
  job_subjects: ['job_id', 'subject_slug'],
}

const EXPECTED_PLANS = ['verified', 'premium', 'featured', 'parent_verified', 'parent_featured']

const EXPECTED_TAXONOMY: Record<string, number> = {
  taxonomy_categories: 13,
  taxonomy_levels: 133,
  taxonomy_subjects: 363,
  taxonomy_master: 896,
}

const EXPECTED_BUCKETS: Record<string, boolean> = {
  avatars: true,
  'identity-docs': false,
}

function dbUrl(): string {
  const env = readFileSync('.env.local', 'utf8')
  const line = env.split(/\r?\n/).find((l) => l.startsWith('SUPABASE_DB_URL='))
  if (!line) throw new Error('SUPABASE_DB_URL missing from .env.local')
  return line.slice('SUPABASE_DB_URL='.length).trim().replace(/^["']|["']$/g, '')
}

/** Run one read-only SQL statement and return the raw rows. */
function query(sql: string): string[][] {
  const dir = mkdtempSync(join(tmpdir(), 'verify-'))
  const envFile = join(dir, 'db.env')
  const sqlFile = join(dir, 'q.sql')
  writeFileSync(envFile, `SUPABASE_DB_URL=${dbUrl()}\n`)
  writeFileSync(sqlFile, sql)
  const out = execFileSync(
    'docker',
    [
      'run', '--rm', '-i', '--env-file', envFile, 'postgres:17',
      'sh', '-c', 'psql "$SUPABASE_DB_URL" -At -F "" -f -',
    ],
    { input: readFileSync(sqlFile), encoding: 'utf8', env: { ...process.env, MSYS_NO_PATHCONV: '1' } },
  )
  return out.trim().split('\n').filter(Boolean).map((r) => r.split(''))
}

function main() {
  const checks: Check[] = []

  // --- tables and columns ---------------------------------------------------
  const colRows = query(
    `select table_name, column_name from information_schema.columns
     where table_schema='public' order by table_name, column_name;`,
  )
  const actual = new Map<string, Set<string>>()
  for (const [t, c] of colRows) {
    if (!actual.has(t)) actual.set(t, new Set())
    actual.get(t)!.add(c)
  }

  for (const [table, cols] of Object.entries(EXPECTED_TABLES)) {
    const have = actual.get(table)
    if (!have) {
      checks.push({ group: 'table', name: table, pass: false, detail: 'table missing' })
      continue
    }
    const missing = cols.filter((c) => !have.has(c))
    checks.push({
      group: 'table',
      name: table,
      pass: missing.length === 0,
      detail: missing.length ? `missing: ${missing.join(', ')}` : `${cols.length} cols ok`,
    })
  }

  // --- RLS ------------------------------------------------------------------
  const rlsOff = query(
    `select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
     where n.nspname='public' and c.relkind='r' and not c.relrowsecurity order by 1;`,
  ).map((r) => r[0])
  checks.push({
    group: 'rls',
    name: 'every public table',
    pass: rlsOff.length === 0,
    detail: rlsOff.length ? `RLS OFF on: ${rlsOff.join(', ')}` : 'RLS on for all',
  })

  // --- plans ----------------------------------------------------------------
  const planCodes = query(`select code from public.plans order by code;`).map((r) => r[0])
  const missingPlans = EXPECTED_PLANS.filter((p) => !planCodes.includes(p))
  checks.push({
    group: 'seed',
    name: 'plans = 5',
    pass: planCodes.length === 5 && missingPlans.length === 0,
    detail: missingPlans.length
      ? `missing: ${missingPlans.join(', ')}`
      : `${planCodes.length} rows: ${planCodes.join(', ')}`,
  })

  // --- taxonomy counts ------------------------------------------------------
  for (const [table, want] of Object.entries(EXPECTED_TAXONOMY)) {
    if (!actual.has(table)) {
      checks.push({ group: 'taxonomy', name: table, pass: false, detail: 'table missing' })
      continue
    }
    const got = Number(query(`select count(*) from public.${table};`)[0][0])
    checks.push({
      group: 'taxonomy',
      name: table,
      pass: got === want,
      detail: `expected ${want}, got ${got}`,
    })
  }

  // --- storage buckets ------------------------------------------------------
  const buckets = new Map(query(`select id, public from storage.buckets order by id;`).map((r) => [r[0], r[1] === 't']))
  for (const [id, wantPublic] of Object.entries(EXPECTED_BUCKETS)) {
    const got = buckets.get(id)
    checks.push({
      group: 'storage',
      name: `bucket ${id}`,
      pass: got === wantPublic,
      detail: got === undefined ? 'missing' : `public=${got} (want ${wantPublic})`,
    })
  }

  // --- report ---------------------------------------------------------------
  const w1 = Math.max(...checks.map((c) => c.name.length), 20)
  const w2 = Math.max(...checks.map((c) => c.group.length), 8)
  console.log('')
  console.log(`| ${'GROUP'.padEnd(w2)} | ${'CHECK'.padEnd(w1)} | RESULT | DETAIL`)
  console.log(`|${'-'.repeat(w2 + 2)}|${'-'.repeat(w1 + 2)}|--------|--------`)
  for (const c of checks) {
    console.log(
      `| ${c.group.padEnd(w2)} | ${c.name.padEnd(w1)} | ${c.pass ? ' PASS ' : ' FAIL '} | ${c.detail}`,
    )
  }
  const failed = checks.filter((c) => !c.pass)
  console.log('')
  console.log(`${checks.length - failed.length}/${checks.length} passed, ${failed.length} failed`)
  process.exit(failed.length === 0 ? 0 : 1)
}

main()
