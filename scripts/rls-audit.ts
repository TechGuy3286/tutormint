/**
 * scripts/rls-audit.ts
 *
 * The CI gate for row-level security. Exits non-zero if anything outside an
 * explicit, hand-maintained allowlist is readable or writable by an anonymous
 * caller holding nothing but the publishable key.
 *
 *   npm run rls:audit
 *
 * Two halves, because neither one alone is sufficient:
 *
 *   READS are probed live over HTTPS with the anon key. This is exactly what an
 *   attacker with the publishable key can do, and it is the only way to be sure:
 *   the key is in every browser bundle, so "what does that key see" is a
 *   question with a real answer and no need to guess at policy expressions.
 *
 *   WRITES are checked structurally against pg_policies, and NOT probed. A live
 *   write probe would work fine today and would insert a row on the day the
 *   audit finally has something to catch -- the exact day you least want the
 *   test suite writing to your database. So the rule is applied to the policy
 *   text instead: a permissive write policy must constrain the row to the
 *   caller (auth.uid()) or to staff (is_admin / is_admin_with). A policy that
 *   references neither admits anon, because auth.uid() is null for anon and any
 *   expression that never looks at it cannot tell the two apart.
 *
 * The write half needs SUPABASE_DB_URL. Pass --http-only to run just the read
 * probe (useful from a machine without database credentials); CI runs both.
 *
 * T8a, after the audit that found `parent_jobs` and `parents` accepting
 * anonymous INSERTs -- policies named "Enable insert for authenticated users"
 * that carried no TO clause and checked (true). That is the class of mistake
 * this script exists to catch: it reads as though it is scoped, and is not.
 */

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdtempSync, existsSync } from 'node:fs'
import { resolveTarget, PRODUCTION_PROJECT_REF } from './target'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// ---------------------------------------------------------------------------
// The allowlists. Everything here is a deliberate decision with a reason, and
// adding a line is the thing a reviewer should notice.
// ---------------------------------------------------------------------------

/**
 * Tables and views an anonymous visitor is SUPPOSED to be able to read.
 *
 * TutorMint's whole product philosophy is that browsing is free and the public
 * pages are the organic-search surface, so this list is not short -- but every
 * entry is data we would print on a page for a stranger.
 */
const PUBLIC_READ: Record<string, string> = {
  // Reference data. Powers the taxonomy selector and the packages page for
  // signed-out visitors.
  plans: 'package names and prices, shown on /tutor/packages and /parent/packages',
  taxonomy_categories: 'subject taxonomy, rendered in the selector and filters',
  taxonomy_levels: 'subject taxonomy',
  taxonomy_subjects: 'subject taxonomy',
  taxonomy_master: 'subject taxonomy: the allowed (category, level, subject) set',

  // The public browse and profile surface.
  tutor_directory: 'the listing view -- already filtered to complete, unsuspended, claimed tutors',
  jobs: 'open tuitions on /browse/tuitions; RLS restricts the rows to open jobs',
  job_subjects: 'which subjects a job wants, for the job cards',
  tutor_subjects: 'which subjects a tutor teaches, for the tutor cards',
  reviews: 'ratings shown on public tutor profiles',
  posts:
    'blog posts on /blog; the SELECT policy returns published rows only (drafts are gated behind is_admin()), so anon reads published content — exactly what the pages render',
  landing_combinations:
    'listed-tutor and open-tuition counts per (city, subject) for the T9.1 landing pages; a security_invoker view, so anon sees only what it already can (listed tutors, open jobs) — counts, no personal data',
  slug_history:
    'retired tutor URLs -> the account they belong to; the redirect map, and exactly what the old URL already told anybody holding it. No write policy at all',
  advertisements: 'the banner rotation; the RLS policy returns only live ads, and created_by is stripped by a column privilege',

  // Payment channel details, shown on the manual-transfer page.
  app_settings: 'bank/JazzCash/Easypaisa account details printed on the manual payment page',
}

/**
 * Permissive write policies allowed to exist without naming auth.uid() or an
 * is_admin helper. Empty, and it should stay that way: a write policy that
 * cannot tell one caller from another is the bug this script looks for.
 */
const UNSCOPED_WRITE_OK: Record<string, string> = {}

/**
 * Views that are granted to anon and deliberately run as their owner, so they
 * see past RLS on their base tables. That is the whole point of them -- they
 * ARE the public surface, and the filtering happens in the view body rather
 * than in a policy. Each one has to be read column by column before it goes on
 * this list, because a definer view is the one place a stray column becomes a
 * public column.
 */
const VIEW_DEFINER_OK: Record<string, string> = {
  tutor_directory:
    'the listing rule, in one place: complete + unsuspended + (not an unclaimed import). ' +
    'Exposes public profile columns only — no phone, email, CNIC, address or document path.',
}

/**
 * Tables that legitimately have no policies at all. RLS is on, nothing has
 * access, and only the service role reads them.
 */
const NO_POLICY_OK: Record<string, string> = {
  _t1_degrees_unconverted: 'T1 migration receipt',
  _t1_unmatched_subjects: 'T1 migration receipt',
  _t1_unmigrated_messages: 'T1 migration receipt',
  _t1_unmigrated_rows: 'T1 migration receipt',
  _t2_remapped_subjects: 'T2 migration receipt',
  phone_otps: 'OTP codes: written and consumed by the server only, never read by a client',
  ad_events: 'impressions and clicks: server-written, admin-read via the service role',
  tutor_rank_snapshots:
    'where each tutor stood the last time the position widget ran, one row each. ' +
    'Written and read through the service role only: a tutor learns nothing from their own row ' +
    'that the widget does not already show them, and a readable table is a feed of where every ' +
    'listed tutor ranks.',
  rate_limits:
    'request counters: written only through consume_rate_limit(), which is granted to service_role alone. ' +
    'Readable by nobody with a client key on purpose — the counters would tell an attacker how much budget is left.',
}

// ---------------------------------------------------------------------------
// psql plumbing, same shape as scripts/verify-schema.ts.
// ---------------------------------------------------------------------------

const SEP = '\u0001'

function loadEnv(): Record<string, string> {
  const out: Record<string, string> = { ...(process.env as Record<string, string>) }
  for (const f of ['.env.local', '.env']) {
    if (!existsSync(f)) continue
    for (const line of readFileSync(f, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
      if (m && !process.env[m[1]]) out[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  }
  return out
}

const env = loadEnv()

function findPsql(): string | null {
  for (const c of [
    'psql',
    'C:/Program Files/PostgreSQL/17/bin/psql.exe',
    'C:/Program Files/PostgreSQL/16/bin/psql.exe',
    '/usr/bin/psql',
    '/usr/local/bin/psql',
  ]) {
    try {
      execFileSync(c, ['--version'], { stdio: 'ignore' })
      return c
    } catch {
      /* try the next one */
    }
  }
  return null
}

const PSQL = findPsql()

function query(sql: string): string[][] {
  const url = env.SUPABASE_DB_URL
  if (!url) throw new Error('SUPABASE_DB_URL is not set')

  let out: string
  if (PSQL) {
    out = execFileSync(PSQL, [url, '-At', '-F', SEP, '-f', '-'], { input: sql, encoding: 'utf8' })
  } else {
    const dir = mkdtempSync(join(tmpdir(), 'rls-'))
    const envFile = join(dir, 'db.env')
    writeFileSync(envFile, `SUPABASE_DB_URL=${url}\n`)
    out = execFileSync(
      'docker',
      [
        'run', '--rm', '-i', '--env-file', envFile, 'postgres:17',
        'sh', '-c', `psql "$SUPABASE_DB_URL" -At -F "${SEP}" -f -`,
      ],
      { input: sql, encoding: 'utf8', env: { ...process.env, MSYS_NO_PATHCONV: '1' } },
    )
  }
  return out
    .replace(/\r/g, '')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((l) => l.split(SEP))
}

// ---------------------------------------------------------------------------

type Finding = { severity: 'FAIL' | 'OK'; area: string; subject: string; detail: string }
const findings: Finding[] = []

const fail = (area: string, subject: string, detail: string) =>
  findings.push({ severity: 'FAIL', area, subject, detail })
const ok = (area: string, subject: string, detail: string) =>
  findings.push({ severity: 'OK', area, subject, detail })

// --- 1. live read probe with the anon key ----------------------------------

async function probeReads(names: string[]) {
  const url = env.NEXT_PUBLIC_SUPABASE_URL
  const key = env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) throw new Error('NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY are not set')

  for (const name of names) {
    let res: Response
    try {
      res = await fetch(`${url}/rest/v1/${name}?select=*&limit=1`, {
        headers: { apikey: key, Authorization: `Bearer ${key}` },
      })
    } catch (e) {
      fail('read', name, `probe failed: ${e instanceof Error ? e.message : String(e)}`)
      continue
    }

    // A 404 means PostgREST does not expose it at all -- as good as denied.
    const body = res.ok ? ((await res.json()) as unknown[]) : []
    const readable = res.ok && Array.isArray(body) && body.length > 0

    if (name in PUBLIC_READ) {
      // Allowlisted. Nothing to fail on; note whether it actually returned a
      // row, because an allowlist entry that reads nothing is dead weight.
      ok('read', name, `public by design (${readable ? 'returned a row' : 'empty'}) — ${PUBLIC_READ[name]}`)
    } else if (readable) {
      fail('read', name, `anon read ${body.length} row(s) and is not on PUBLIC_READ`)
    } else {
      ok('read', name, `anon read denied or empty (HTTP ${res.status})`)
    }
  }
}

// --- 2. structural write check ---------------------------------------------

/** Does this policy expression tie the row to a specific caller? */
function isScoped(expr: string): boolean {
  return /auth\.uid\(\)|auth\.jwt\(\)|is_admin\s*\(|is_admin_with\s*\(|owns_thread\s*\(|can_review_tutor\s*\(/i.test(
    expr,
  )
}

function checkWritePolicies() {
  const rows = query(`
    -- Policy expressions are pretty-printed across several lines. This output
    -- is split on newlines, so flatten them here (translate, not a regex:
    -- a backslash class inside a TS template literal is eaten before it
    -- ever reaches Postgres) or every multi-line policy arrives truncated
    -- and gets reported as unscoped.
    select tablename, policyname, cmd, permissive,
           translate(coalesce(qual, ''), chr(10) || chr(13) || chr(9), '   '),
           translate(coalesce(with_check, ''), chr(10) || chr(13) || chr(9), '   ')
    from pg_policies
    where schemaname = 'public' and cmd <> 'SELECT'
    order by tablename, policyname
  `)

  for (const [table, policy, cmd, permissive, qual, check] of rows) {
    if (permissive !== 'PERMISSIVE') continue // restrictive policies only narrow
    const expr = `${qual} ${check}`.trim()
    const key = `${table}.${policy}`

    if (!expr || !isScoped(expr)) {
      if (key in UNSCOPED_WRITE_OK) {
        ok('write', key, `unscoped but allowlisted — ${UNSCOPED_WRITE_OK[key]}`)
      } else {
        fail('write', key, `${cmd} policy does not reference auth.uid() or an is_admin helper: "${expr || '(empty)'}"`)
      }
    } else {
      ok('write', key, `${cmd} scoped to the caller`)
    }
  }
}

// --- 3. RLS is on, and every table has a policy or a reason ----------------

function checkRlsEnabled() {
  const rows = query(`
    select c.relname, c.relrowsecurity::text,
           (select count(*)::text from pg_policies p
             where p.schemaname='public' and p.tablename = c.relname)
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
    order by c.relname
  `)

  for (const [table, rls, policies] of rows) {
    if (rls !== 'true' && rls !== 't') {
      fail('rls', table, 'row-level security is DISABLED')
      continue
    }
    if (policies === '0' && !(table in NO_POLICY_OK)) {
      fail('rls', table, 'RLS on but no policies and no entry in NO_POLICY_OK — is this deliberate?')
    } else if (policies === '0') {
      ok('rls', table, `no policies, by design — ${NO_POLICY_OK[table]}`)
    } else {
      ok('rls', table, `enabled, ${policies} policies`)
    }
  }
}

/** Views run as their owner unless security_invoker is on. */
function checkViews() {
  const rows = query(`
    select c.relname,
           coalesce((select option_value from pg_options_to_table(c.reloptions)
                      where option_name = 'security_invoker'), 'false'),
           coalesce((select string_agg(distinct r.grantee, ',')
                       from information_schema.role_table_grants r
                      where r.table_schema='public' and r.table_name = c.relname
                        and r.grantee in ('anon','authenticated')), '(none)')
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname='public' and c.relkind = 'v'
    order by c.relname
  `)

  for (const [view, invoker, grantees] of rows) {
    if (grantees === '(none)') {
      ok('view', view, 'not granted to anon or authenticated')
    } else if (invoker !== 'true' && view in VIEW_DEFINER_OK) {
      ok('view', view, `owner-rights view, allowlisted — ${VIEW_DEFINER_OK[view]}`)
    } else if (invoker !== 'true') {
      fail('view', view, `granted to ${grantees} but security_invoker is off — it bypasses RLS on its base tables and is not in VIEW_DEFINER_OK`)
    } else {
      ok('view', view, `security_invoker on, granted to ${grantees}`)
    }
  }
}

// --- 4. allowlist hygiene ---------------------------------------------------

function checkAllowlistIsCurrent(names: string[]) {
  for (const name of Object.keys(PUBLIC_READ)) {
    if (!names.includes(name)) {
      fail('allowlist', name, 'on PUBLIC_READ but no such table or view exists — stale entry')
    }
  }
}

// ---------------------------------------------------------------------------

async function main() {
  // READ-ONLY. Named here anyway: there is one Supabase project and it serves
  // the live site, so knowing which database an audit result describes is not
  // optional information.
  const target = resolveTarget(env)
  console.log(
    `project ${target.apiRef ?? '(unknown)'}${target.apiRef === PRODUCTION_PROJECT_REF ? ' (PRODUCTION)' : ''} - read-only audit
`,
  )

  const httpOnly = process.argv.includes('--http-only')

  let names: string[]
  if (httpOnly) {
    // Without database access, probe what we know about.
    names = Object.keys(PUBLIC_READ)
    console.log('running in --http-only mode: read probe only, over the allowlist\n')
  } else {
    names = query(`
      select c.relname
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r','v')
      order by c.relname
    `).map((r) => r[0])
  }

  await probeReads(names)

  if (!httpOnly) {
    checkWritePolicies()
    checkRlsEnabled()
    checkViews()
    checkAllowlistIsCurrent(names)
  }

  const failures = findings.filter((f) => f.severity === 'FAIL')

  const w = Math.max(...findings.map((f) => f.subject.length), 10)
  console.log(`| ${'AREA'.padEnd(9)} | ${'SUBJECT'.padEnd(w)} | RESULT | DETAIL`)
  console.log(`|${'-'.repeat(11)}|${'-'.repeat(w + 2)}|--------|--------`)
  for (const f of findings) {
    console.log(`| ${f.area.padEnd(9)} | ${f.subject.padEnd(w)} | ${f.severity === 'FAIL' ? ' FAIL ' : '  ok  '} | ${f.detail}`)
  }

  console.log('')
  console.log(`${findings.length - failures.length}/${findings.length} checks passed`)
  if (failures.length > 0) {
    console.log('')
    console.log(`${failures.length} FAILURE(S):`)
    for (const f of failures) console.log(`  ${f.area}: ${f.subject} — ${f.detail}`)
  }
  process.exit(failures.length === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
