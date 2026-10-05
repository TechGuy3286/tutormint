/**
 * scripts/dataop-pause-test-accounts.ts
 *
 * DATA-OP (owner, 5 Oct 2026, Browse-tutors cleanup §3): PAUSE every test
 * account that never made a successful payment — never delete anything.
 *
 * WHO. An account whose display name contains the whole word "test"
 * (case-insensitive: "Test Tutor 6", "Tutor Test 5", "Test Parent",
 * "Parent Test 6") or is exactly "New User". Matched by name alone, so the
 * BEFORE table must be read by a person before --apply.
 *
 * SKIPPED, AND LISTED. An account with a successful payment (payments.status =
 * 'approved') is never paused here — it is listed in the output for the owner.
 * Staff, the owner, the team account and a banned account are refused outright.
 * An already-paused account is left as it is (its open tuitions are still moved
 * to the pause state).
 *
 * "Pause" is the platform's existing reversible account pause,
 * `profiles.is_suspended` (lib/moderation.ts suspendMember: "suspension is a
 * reversible pause, a ban is for fraud"), mirrored exactly here so the effects
 * are the ones the app already enforces:
 *
 *   • hidden from Browse / search / sitemap — tutor_directory and
 *     tutor_visible_profiles both exclude is_suspended (a suspended tutor's URL
 *     is the branded 404, which is noindex); the public parent card hides on
 *     is_suspended;
 *   • the dashboards redirect to /suspended and getEntitlements() returns
 *     nothing, so the accounts can do nothing while paused;
 *   • their OPEN tuitions are paused with the tuition pause state (jobs.status
 *     = 'paused', paused_at) — out of browse, matching and the sitemap, the
 *     page 200 + noindex (PR28).
 *
 * Nothing is deleted. Reversal is the ordinary Reinstate on /admin/users/[id]
 * and Resume on each tuition.
 *
 *   npx tsx --env-file=.env.local scripts/dataop-pause-test-accounts.ts            # STEP 1: SELECT only
 *   npx tsx --env-file=.env.local scripts/dataop-pause-test-accounts.ts --apply    # STEP 2: pause, then re-SELECT
 *
 * Every write is audit-logged under the owner's account (member.suspend /
 * job.pause) and timelined, exactly as the admin screens would. The DB URL is
 * read from env and never printed.
 */
// @ts-expect-error pg ships no bundled types; dev-only data-op script.
import pg from 'pg'

const APPLY = process.argv.includes('--apply')
const dbUrl = process.env.SUPABASE_DB_URL
if (!dbUrl) {
  console.error('SUPABASE_DB_URL not set (run with: npx tsx --env-file=.env.local …)')
  process.exit(1)
}

const REASON = 'Test account paused by the owner (5 Oct 2026). Nothing has been deleted.'

type Row = {
  id: string
  full_name: string
  role: string
  email: string | null
  created_at: string
  is_suspended: boolean
  is_banned: boolean
  admin_role: string | null
  is_team_account: boolean
  verification_status: string | null
  has_successful_payment: boolean
  open_jobs: number
  paused_jobs: number
}

// Whole word "test" (any case) anywhere in the name, or exactly "New User".
// `\m` / `\M` are PostgreSQL's word-boundary escapes; passed as a parameter so
// no quoting layer can eat the backslashes.
const PATTERN = '\\mtest\\M'

const SELECT = `
  select p.id, p.full_name, p.role, p.email, p.created_at,
         coalesce(p.is_suspended,false) as is_suspended,
         coalesce(p.is_banned,false)    as is_banned,
         p.admin_role,
         coalesce(p.is_team_account,false) as is_team_account,
         tp.verification_status,
         exists (select 1 from public.payments pay where pay.user_id = p.id and pay.status = 'approved') as has_successful_payment,
         (select count(*) from public.jobs j where j.parent_id = p.id and j.status = 'open')::int   as open_jobs,
         (select count(*) from public.jobs j where j.parent_id = p.id and j.status = 'paused')::int as paused_jobs
    from public.profiles p
    left join public.tutor_profiles tp on tp.id = p.id
   where p.full_name ~* $1 or lower(btrim(p.full_name)) = 'new user'
   order by p.created_at`

function show(label: string, rows: Row[]) {
  console.log(`\n${label} — ${rows.length} account(s)`)
  console.table(
    rows.map((r) => ({
      id: r.id,
      name: r.full_name,
      role: r.role,
      created_at: r.created_at,
      status: r.is_banned ? 'banned' : r.is_suspended ? 'paused' : 'active',
      successful_payment: r.has_successful_payment ? 'YES' : 'no',
      tutor_status: r.verification_status ?? '',
      open_jobs: r.open_jobs,
      paused_jobs: r.paused_jobs,
    })),
  )
}

async function main() {
  const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } })
  await client.connect()
  try {
    const before = (await client.query(SELECT, [PATTERN])).rows as Row[]
    show('BEFORE', before)

    const problems: string[] = []
    for (const r of before) {
      if (r.admin_role) problems.push(`${r.full_name} (${r.id}) is staff (${r.admin_role}) — refusing`)
      if (r.is_team_account) problems.push(`${r.full_name} (${r.id}) is the team account — refusing`)
      if (r.is_banned) problems.push(`${r.full_name} (${r.id}) is banned — refusing`)
    }
    if (problems.length) {
      console.log('\nSTOP — this step is not applied:')
      for (const p of problems) console.log('  • ' + p)
      process.exitCode = 2
      return
    }

    const paid = before.filter((r) => r.has_successful_payment)
    const toPause = before.filter((r) => !r.has_successful_payment && !r.is_suspended)
    const already = before.filter((r) => !r.has_successful_payment && r.is_suspended)
    console.log(`\nSKIPPED (successful payment on record — left active, listed for the owner): ${paid.length}`)
    for (const r of paid) console.log(`  • ${r.full_name} (${r.role}, ${r.id})`)
    console.log(`Already paused: ${already.length}`)
    for (const r of already) console.log(`  • ${r.full_name} (${r.role}, ${r.id})`)
    console.log(`To pause now: ${toPause.length}`)
    for (const r of toPause) console.log(`  • ${r.full_name} (${r.role}, ${r.id})`)

    if (!APPLY) {
      console.log('\nDry run only. Re-run with --apply to pause them.')
      return
    }

    const { rows: owners } = await client.query(
      `select id, email, admin_role from public.profiles where role = 'admin' and admin_role = 'owner' limit 1`,
    )
    if (owners.length !== 1) throw new Error('owner account not found — refusing to act with no actor')
    const owner = owners[0] as { id: string; email: string | null; admin_role: string }

    await client.query('begin')
    try {
      for (const r of before) {
        if (r.has_successful_payment) continue
        if (!r.is_suspended) {
          await client.query(
            `update public.profiles
                set is_suspended = true, suspension_reason = $2, suspended_at = now(), suspended_by = $3
              where id = $1`,
            [r.id, REASON, owner.id],
          )
          // End any open session, as suspendMember does (PR48 §4).
          try {
            await client.query('select public.revoke_user_sessions($1::uuid)', [r.id])
          } catch (e) {
            console.log(`  (revoke_user_sessions unavailable for ${r.id}: ${(e as Error).message})`)
          }
          if (r.role === 'tutor') {
            await client.query(
              `update public.tutor_profiles set verification_status = 'suspended', is_featured = false where id = $1`,
              [r.id],
            )
          }
          await client.query(
            `insert into public.penalties_log (user_id, kind, reason, issued_by, report_id) values ($1, 'suspension', $2, $3, null)`,
            [r.id, REASON, owner.id],
          )
          await client.query(
            `insert into public.admin_audit_log (actor_id, actor_role, actor_email, action, target_type, target_id, detail)
             values ($1, $2, $3, 'member.suspend', 'profile', $4, $5::jsonb)`,
            [owner.id, owner.admin_role, owner.email, r.id, JSON.stringify({ reason: REASON, role: r.role, reportId: null, dataop: 'pause-test-accounts' })],
          )
          await client.query(
            `insert into public.user_activity_log (user_id, event, target_type, target_id, meta) values ($1, 'suspended', 'profile', $1, $2::jsonb)`,
            [r.id, JSON.stringify({ reason: REASON, reportId: null })],
          )
        }
        // Their open tuitions → the tuition pause state (admin pause, PR27/PR28).
        const { rows: jobs } = await client.query(
          `update public.jobs set status = 'paused', paused_at = now() where parent_id = $1 and status = 'open' returning id, title, ref_id`,
          [r.id],
        )
        for (const j of jobs as { id: string; title: string; ref_id: string }[]) {
          await client.query(
            `insert into public.admin_audit_log (actor_id, actor_role, actor_email, action, target_type, target_id, detail)
             values ($1, $2, $3, 'job.pause', 'job', $4, $5::jsonb)`,
            [owner.id, owner.admin_role, owner.email, j.id, JSON.stringify({ reason: REASON, refId: j.ref_id, dataop: 'pause-test-accounts' })],
          )
        }
        console.log(`  paused ${r.full_name} (${r.role}, ${r.id}) — tuitions paused: ${jobs.length}`)
      }
      await client.query('commit')
    } catch (e) {
      await client.query('rollback')
      throw e
    }

    const after = (await client.query(SELECT, [PATTERN])).rows as Row[]
    show('AFTER', after)
    const notPaused = after.filter((r) => !r.is_suspended && !r.has_successful_payment)
    const stillOpen = after.filter((r) => r.open_jobs > 0 && !r.has_successful_payment)
    console.log(
      notPaused.length === 0 && stillOpen.length === 0
        ? '\nEvery unpaid test account is paused and none has an open tuition. Nothing was deleted.'
        : `\nCHECK: not paused = ${notPaused.length}, with open tuitions = ${stillOpen.length}`,
    )
  } finally {
    await client.end()
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
