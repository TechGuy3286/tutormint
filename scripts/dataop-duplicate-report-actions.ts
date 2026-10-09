/**
 * scripts/dataop-duplicate-report-actions.ts — DATA-OP (owner, 10 Oct 2026).
 *
 * Acts on the duplicate-member report (scripts/report-duplicate-members.ts):
 *   1. Sidra Aziz — DELETE the EMAIL-signup account (039b07dd…). An approved
 *      exception to "never delete": it holds no information (0%, one
 *      'registered' activity row, nothing else). Storage, every dependent row,
 *      the profile and the auth user go; /tutor/sidra-aziz-tutor then 404s and
 *      leaves the sitemap. Her MOBILE account (aa2ae8cd…) is not touched.
 *   2. Tehreem Sohail — PAUSE the newer account (52152470…, later created_at)
 *      with the platform's account pause (is_suspended, mirrored from
 *      lib/moderation.ts suspendMember exactly as dataop-pause-test-accounts.ts
 *      does). The older one (4ffcb86c…) is untouched.
 *   3. Ali Sabeer (8127b7c1…) and Ehtasham Abbasi (bb803138…) are TEST
 *      accounts: both get profiles.hidden_from_public = true (migration 126 —
 *      the one flag that hides a test account from Browse, search, landing and
 *      city pages and the sitemap, and makes the profile URL the branded
 *      not-found page, noindex). Ehtasham is paused; Ali is already paused and
 *      his payments are not touched.
 *
 * GUARD. Before writing, every fact the owner approved is re-checked (ids,
 * completion, pause state, fee, and the counts that define "holds no
 * information"). Any difference → STOP, nothing is written.
 *
 *   npx tsx --env-file=.env.local scripts/dataop-duplicate-report-actions.ts            # check only
 *   npx tsx --env-file=.env.local scripts/dataop-duplicate-report-actions.ts --apply    # act, then re-check
 */
// @ts-expect-error pg ships no bundled types; dev-only data-op script.
import pg from 'pg'
import { createClient } from '@supabase/supabase-js'

import { linkedCounts } from './report-dup-action-facts'

const APPLY = process.argv.includes('--apply')
const dbUrl = process.env.SUPABASE_DB_URL
if (!dbUrl) { console.error('SUPABASE_DB_URL not set'); process.exit(1) }

const SIDRA_EMAIL = '039b07dd-2010-4b58-b533-e0066f51827e'
const SIDRA_MOBILE = 'aa2ae8cd-fd5c-472e-af40-0285e4406aec'
const TEHREEM_OLD = '4ffcb86c-ecaf-4663-918a-995faf82dc62'
const TEHREEM_NEW = '52152470-463a-4fda-9b8c-fd0c0ee23a0a'
const ALI = '8127b7c1-6f99-4a6c-82e5-a9abfecd003f'
const EHTASHAM = 'bb803138-ed30-4862-a1d3-b11a38f9ad02'
const ALL = [SIDRA_EMAIL, SIDRA_MOBILE, TEHREEM_OLD, TEHREEM_NEW, ALI, EHTASHAM]

const PAUSE_REASON = 'Duplicate account paused by the owner (10 Oct 2026). Nothing has been deleted.'
const TEST_REASON = 'Test account paused by the owner (10 Oct 2026). Nothing has been deleted.'

type Facts = {
  id: string; full_name: string; created_at: Date; completion: number; signup: string
  paused: boolean; banned: boolean; hidden: boolean; fee_paid: boolean; slug: string | null
  activity: number; on_browse: boolean
}

async function facts(c: pg.Client): Promise<Map<string, Facts>> {
  const { rows } = await c.query(`
    select p.id, p.full_name, p.created_at, p.profile_completion as completion,
      case when p.email ilike '%@users.tutormint.org' then 'mobile' else 'email' end as signup,
      coalesce(p.is_suspended,false) paused, coalesce(p.is_banned,false) banned, coalesce(p.hidden_from_public,false) hidden,
      tp.verified_fee_paid_at is not null fee_paid, tp.slug,
      ((select count(*) from user_activity_log a where a.user_id=p.id) + (select count(*) from applications x where x.tutor_id=p.id)
        + (select count(*) from jobs j where j.parent_id=p.id) + (select count(*) from messages g where g.sender_id=p.id))::int as activity,
      exists(select 1 from tutor_directory d where d.id=p.id) on_browse
    from profiles p left join tutor_profiles tp on tp.id=p.id where p.id = any($1::uuid[])`, [ALL])
  return new Map((rows as Facts[]).map((r) => [r.id, r]))
}

// What the owner approved, as reported on 9–10 Oct.
const EXPECT: Record<string, Partial<Facts> & { name: string }> = {
  [SIDRA_EMAIL]: { name: 'Sidra Aziz', signup: 'email', completion: 0, activity: 1, paused: false, fee_paid: false },
  [SIDRA_MOBILE]: { name: 'Sidra Aziz', signup: 'mobile', completion: 73, activity: 22, paused: false, fee_paid: false, on_browse: true },
  [TEHREEM_OLD]: { name: 'Tehreem Sohail', completion: 0, activity: 1, paused: false, fee_paid: false },
  [TEHREEM_NEW]: { name: 'Tehreem Sohail', completion: 0, activity: 1, paused: false, fee_paid: false },
  [ALI]: { name: 'Ali Sabeer', completion: 100, activity: 102, paused: true, fee_paid: true },
  [EHTASHAM]: { name: 'Ehtasham Abbasi', completion: 93, activity: 58, paused: false, fee_paid: false },
}

// "Holds no information": nothing but the one registration row, the profile pair and the auth user.
const SIDRA_EMAIL_ALLOWED = new Set(['profiles.id', 'tutor_profiles.id', 'user_activity_log.user_id', 'user_activity_log.target_id', 'auth.users'])

async function check(c: pg.Client): Promise<string[]> {
  const f = await facts(c)
  const problems: string[] = []
  for (const [id, e] of Object.entries(EXPECT)) {
    const r = f.get(id)
    if (!r) { problems.push(`${e.name} ${id} not found`); continue }
    if (r.full_name !== e.name) problems.push(`${id}: name is "${r.full_name}", expected "${e.name}"`)
    for (const k of ['signup', 'completion', 'activity', 'paused', 'fee_paid', 'on_browse'] as const) {
      if (k in e && (e as Record<string, unknown>)[k] !== r[k]) problems.push(`${e.name} ${id}: ${k} is ${r[k]}, expected ${(e as Record<string, unknown>)[k]}`)
    }
    if (r.banned) problems.push(`${e.name} ${id} is banned`)
  }
  const tNew = f.get(TEHREEM_NEW), tOld = f.get(TEHREEM_OLD)
  if (tNew && tOld && !(tNew.created_at > tOld.created_at)) problems.push('Tehreem: the account to pause is not the newer one')
  const linked = await linkedCounts(c, SIDRA_EMAIL)
  for (const [k, n] of Object.entries(linked)) if (!SIDRA_EMAIL_ALLOWED.has(k)) problems.push(`Sidra email account has ${n} row(s) in ${k}`)
  if ((linked['user_activity_log.user_id'] ?? 0) !== 1) problems.push(`Sidra email account: ${linked['user_activity_log.user_id'] ?? 0} activity rows, expected 1`)
  return problems
}

async function main() {
  const c = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } })
  await c.connect()
  try {
    const problems = await check(c)
    if (problems.length) {
      console.log('STOP — the accounts are not exactly as reported; nothing written:')
      for (const p of problems) console.log('  • ' + p)
      process.exitCode = 2
      return
    }
    console.log('CHECK — all six accounts are exactly as reported.')
    if (!APPLY) { console.log('Dry run only. Re-run with --apply.'); return }

    const { rows: owners } = await c.query(`select id, email, admin_role from profiles where role='admin' and admin_role='owner' limit 1`)
    if (owners.length !== 1) throw new Error('owner account not found — refusing to act with no actor')
    const owner = owners[0] as { id: string; email: string | null; admin_role: string }
    const audit = (action: string, target: string, detail: object) =>
      c.query(`insert into admin_audit_log (actor_id, actor_role, actor_email, action, target_type, target_id, detail)
               values ($1,$2,$3,$4,'profile',$5,$6::jsonb)`, [owner.id, owner.admin_role, owner.email, action, target, JSON.stringify({ ...detail, dataop: 'duplicate-report-actions' })])

    const pause = async (id: string, reason: string) => {
      await c.query(`update profiles set is_suspended = true, suspension_reason = $2, suspended_at = now(), suspended_by = $3 where id = $1`, [id, reason, owner.id])
      try { await c.query('select public.revoke_user_sessions($1::uuid)', [id]) } catch (e) { console.log(`  (revoke_user_sessions: ${(e as Error).message})`) }
      await c.query(`update tutor_profiles set verification_status = 'suspended', is_featured = false where id = $1`, [id])
      await c.query(`insert into penalties_log (user_id, kind, reason, issued_by, report_id) values ($1,'suspension',$2,$3,null)`, [id, reason, owner.id])
      await audit('member.suspend', id, { reason, role: 'tutor', reportId: null })
      await c.query(`insert into user_activity_log (user_id, event, target_type, target_id, meta) values ($1,'suspended','profile',$3,$2::jsonb)`, [id, JSON.stringify({ reason, reportId: null }), id])
      const { rows: jobs } = await c.query(`update jobs set status='paused', paused_at=now() where parent_id=$1 and status='open' returning id`, [id])
      if (jobs.length) console.log(`  paused ${jobs.length} open tuition(s)`)
    }

    await c.query('begin')
    try {
      // 2. Tehreem — pause the newer account.
      await pause(TEHREEM_NEW, PAUSE_REASON)
      console.log('paused Tehreem Sohail (newer, 52152470…)')
      // 3. Test accounts — the one public-hiding flag, then pause Ehtasham.
      for (const id of [ALI, EHTASHAM]) {
        await c.query(`update profiles set hidden_from_public = true where id = $1`, [id])
        await audit('member.hide_public', id, { reason: 'Test account (owner, 10 Oct 2026).' })
      }
      console.log('marked Ali Sabeer (8127b7c1…) and Ehtasham Abbasi (bb803138…) as test (hidden_from_public)')
      await pause(EHTASHAM, TEST_REASON)
      console.log('paused Ehtasham Abbasi')
      // 1. Sidra (email) — every dependent row, then the profile pair. Audit row kept.
      await audit('member.delete', SIDRA_EMAIL, { reason: 'Duplicate empty email-signup account (owner-approved exception, 10 Oct 2026).', keptAccount: SIDRA_MOBILE })
      const ual = await c.query(`delete from user_activity_log where user_id = $1::uuid or target_id = $2`, [SIDRA_EMAIL, SIDRA_EMAIL])
      const tp = await c.query(`delete from tutor_profiles where id = $1`, [SIDRA_EMAIL])
      const pr = await c.query(`delete from profiles where id = $1`, [SIDRA_EMAIL])
      console.log(`deleted Sidra email account rows: activity ${ual.rowCount}, tutor_profiles ${tp.rowCount}, profiles ${pr.rowCount}`)
      await c.query('commit')
    } catch (e) { await c.query('rollback'); throw e }

    // Auth user last (identities/sessions cascade in GoTrue). Storage held nothing (checked above).
    const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
    const { error } = await admin.auth.admin.deleteUser(SIDRA_EMAIL)
    if (error) throw new Error(`deleteUser: ${error.message}`)
    console.log('deleted Sidra email auth user')

    console.log('\nAFTER:')
    const f = await facts(c)
    for (const id of ALL) {
      const r = f.get(id)
      console.log(r ? `  ${r.full_name} ${id.slice(0, 8)} · ${r.completion}% · activity ${r.activity} · paused ${r.paused} · test ${r.hidden} · on Browse ${r.on_browse}` : `  ${id.slice(0, 8)} — gone`)
    }
    const left = await linkedCounts(c, SIDRA_EMAIL)
    console.log('  Sidra email account rows left: ' + JSON.stringify(left))
  } finally {
    await c.end()
  }
}
main()
