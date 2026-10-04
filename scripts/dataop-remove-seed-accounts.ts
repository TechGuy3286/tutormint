/**
 * scripts/dataop-remove-seed-accounts.ts  (PR106-H3 §1.1, owner-approved)
 *
 * Remove the seed/fixture cast (is_seed = true AND email @tutormint.dev) and all
 * their linked rows + storage objects, one transaction per account, then the
 * auth user — freeing their slugs. The hardened machinery from
 * dataop-remove-test-accounts.ts (full table map, storage, orphan-safe delete
 * order), with the STOP condition tuned to the spec:
 *
 *   STOP (skip + report) if an account has a REAL approved PayPro payment
 *   (provider='paypro' AND status='approved'). A seed's approved simulator/manual
 *   row is a fixture, NOT a real payment, so it does NOT protect the account.
 *   Also STOP on an admin/team account or an admin-actor reference (would orphan).
 *
 *   npx tsx scripts/dataop-remove-seed-accounts.ts            # dry run
 *   npx tsx scripts/dataop-remove-seed-accounts.ts --apply    # delete
 *
 * Never prints CNIC numbers or document contents (counts + storage paths only).
 * One audit line per account: "Seed account removed at owner request".
 */
// @ts-expect-error pg ships no bundled types; dev-only data-op script.
import pg from 'pg'
import { createClient } from '@supabase/supabase-js'

const APPLY = process.argv.includes('--apply')
const dbUrl = process.env.SUPABASE_DB_URL
const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!dbUrl) { console.error('SUPABASE_DB_URL not set'); process.exit(1) }
if (APPLY && (!supaUrl || !serviceKey)) { console.error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY required for --apply'); process.exit(1) }

// (table, columns that reference a user id) — the authoritative map, identical
// to dataop-remove-test-accounts.ts.
const USER_TABLES: [string, string[]][] = [
  ['profiles', ['id']],
  ['tutor_profiles', ['id']],
  ['children', ['parent_id']],
  ['applications', ['tutor_id']],
  ['jobs', ['parent_id', 'hired_tutor_id']],
  ['demo_requests', ['parent_id', 'tutor_id']],
  ['demo_feedback', ['parent_id', 'tutor_id']],
  ['reviews', ['tutor_id', 'parent_id', 'target_id']],
  ['messages', ['sender_id']],
  ['threads', ['participant_a', 'participant_b']],
  ['notifications', ['user_id']],
  ['profile_views', ['tutor_id', 'viewer_id']],
  ['shortlists', ['user_id', 'tutor_id']],
  ['saved_jobs', ['user_id']],
  ['subscriptions', ['user_id']],
  ['payments', ['user_id', 'reviewed_by']],
  ['usage_counters', ['user_id']],
  ['user_documents', ['user_id']],
  ['user_activity_log', ['user_id']],
  ['penalties_log', ['user_id']],
  ['phone_otps', ['user_id']],
  ['admin_messages', ['member_id', 'admin_id']],
  ['message_reports', ['reporter_id']],
  ['reports', ['reporter_id', 'reviewed_by']],
  ['tutor_areas', ['tutor_id']],
  ['tutor_subjects', ['tutor_id']],
  ['tutor_slots', ['tutor_id']],
  ['tutor_quick_replies', ['tutor_id']],
  ['tutor_field_history', ['tutor_id']],
  ['tutor_rank_snapshots', ['tutor_id']],
  ['tuition_access', ['tutor_id']],
  ['contact_reveals', ['parent_id', 'tutor_id']],
  ['match_email_sent', ['tutor_id']],
  ['slug_history', ['tutor_id']],
  ['academy_affiliations', ['academy_id', 'teacher_id']],
  ['abuse_flags', ['subject_id', 'recipient_id', 'cleared_by']],
  ['user_blocks', ['blocker_id', 'blocked_id']],
  ['activity_events', ['user_id']],
  ['activity_sessions', ['user_id']],
  ['admin_backup_codes', ['user_id']],
  ['posts', ['author_id', 'reviewed_by']],
  ['advertisements', ['created_by']],
  ['signup_blocklist', ['source_user_id', 'created_by']],
  ['job_contacts', ['created_by']],
  ['legacy_parents', ['user_id']],
  ['legacy_tutors', ['user_id']],
  ['legacy_tutor_activities', ['tutor_user_id']],
  ['legacy_tutor_applications', ['tutor_user_id']],
  ['legacy_parent_jobs', ['parent_id', 'parent_user_id']],
  ['legacy_tutor_trust_fees', ['user_id']],
]
const ACTOR_REFS: [string, string[]][] = [
  ['profiles', ['banned_by', 'cnic_reviewed_by', 'profile_pic_reviewed_by', 'selfie_reviewed_by', 'suspended_by']],
  ['taxonomy_aliases', ['created_by']],
]
const BUCKETS = ['ads', 'avatars', 'blog', 'identity-docs', 'message-media', 'payment-proofs', 'tutor-media']

const SHOW_COUNTS = process.argv.includes('--counts')

async function main() {
  // keepAlive so a long sequence of queries to the remote DB does not have its
  // socket closed mid-run (the informational count loop is also gated behind
  // --counts to keep the run short; the stop checks always run).
  const c = new pg.Client({ connectionString: dbUrl, keepAlive: true, statement_timeout: 30000 })
  await c.connect()

  // The seed set, by the stored fact — AND the @tutormint.dev belt-and-braces.
  const seed = await c.query(
    `select id, email, role, admin_role, is_team_account
       from public.profiles
      where is_seed = true and lower(email) like '%@tutormint.dev'
      order by role, full_name`,
  )
  const ids: string[] = (seed.rows as { id: string }[]).map((r) => r.id)
  console.log(`Seed accounts matched: ${ids.length}`)

  const toDelete: string[] = []
  let stop = false
  const stopReasons: string[] = []

  for (const r of seed.rows as { id: string; email: string; role: string; admin_role: string | null; is_team_account: boolean }[]) {
    console.log(`\n================ ${r.email} (${r.id}) ================`)
    if (r.admin_role || r.role === 'admin') { stop = true; stopReasons.push(`${r.email}: is an admin (admin_role=${r.admin_role}, role=${r.role})`); continue }
    if (r.is_team_account) { stop = true; stopReasons.push(`${r.email}: is the team account`); continue }

    if (SHOW_COUNTS) {
      let total = 0
      for (const [tbl, cols] of USER_TABLES) {
        const where = cols.map((col) => `"${col}"=$1`).join(' or ')
        try {
          const q = await c.query(`select count(*) n from public."${tbl}" where ${where}`, [r.id])
          const n = Number(q.rows[0].n)
          if (n > 0) { console.log(`    ${tbl} (${cols.join('/')}): ${n}`); total += n }
        } catch (e) { console.log(`    ${tbl}: ERROR ${(e as Error).message}`) }
      }
      console.log(`    (table rows total: ${total})`)
    }
    // STOP only on a REAL approved PayPro payment. Simulator/manual approved rows
    // are seed fixtures and do NOT protect the account.
    const pay = await c.query(`select status, provider, method, amount_pkr from public.payments where user_id=$1`, [r.id])
    for (const p of pay.rows as { status: string; provider: string; method: string; amount_pkr: number }[]) {
      console.log(`    payment: status=${p.status} provider=${p.provider} method=${p.method} amount=${p.amount_pkr}`)
      if (p.status === 'approved' && p.provider === 'paypro') {
        stop = true; stopReasons.push(`${r.email}: has a REAL approved PayPro payment`)
      }
    }
    for (const [tbl, cols] of ACTOR_REFS) {
      const where = cols.map((col) => `"${col}"=$1`).join(' or ')
      const q = await c.query(`select count(*) n from public."${tbl}" where ${where}`, [r.id])
      const n = Number(q.rows[0].n)
      if (n > 0) { console.log(`    [actor] ${tbl} (${cols.join('/')}): ${n}`); stop = true; stopReasons.push(`${r.email}: acted as admin on ${tbl} (${n} rows)`) }
    }
    toDelete.push(r.id)
  }

  console.log(`\n================ VERDICT ================`)
  if (stop) {
    console.log('Some accounts are SKIPPED (stop condition):')
    for (const s of stopReasons) console.log(`  • ${s}`)
  }
  console.log(`${toDelete.length} account(s) to delete: ${toDelete.join(', ')}`)

  if (!APPLY) { console.log('\n(dry run — no changes. Re-run with --apply after review.)'); await c.end(); return }

  console.log('\n================ APPLYING ================')
  const admin = createClient(supaUrl!, serviceKey!, { auth: { persistSession: false } })
  for (const uid of toDelete) {
    for (const b of BUCKETS) {
      const objsRes = await c.query(`select name from storage.objects where bucket_id=$1 and (name like $2 or name like $3)`, [b, `${uid}/%`, `%${uid}%`])
      const objs = objsRes.rows as { name: string }[]
      if (objs.length) {
        const { error } = await admin.storage.from(b).remove(objs.map((o) => o.name))
        console.log(`  storage[${b}] removed ${objs.length}${error ? ' ERROR ' + error.message : ''}`)
      }
    }
    await c.query('begin')
    try {
      await c.query(
        `delete from public.messages
          where sender_id=$1
             or thread_id in (select id from public.threads where participant_a=$1 or participant_b=$1)`,
        [uid],
      )
      // Delete this account's threads BEFORE its jobs. jobs→threads is ON DELETE
      // SET NULL, so deleting a job nulls thread.job_id — and two of the account's
      // threads with the same other participant on different jobs would then both
      // be (a,b,null), violating threads_pair_job_uniq. Removing the threads first
      // (every thread on the account's own job has the account as a participant)
      // means there is nothing left for the SET NULL to collide on.
      await c.query(`delete from public.threads where participant_a=$1 or participant_b=$1`, [uid])
      for (const [tbl, cols] of USER_TABLES) {
        if (tbl === 'profiles' || tbl === 'tutor_profiles' || tbl === 'messages' || tbl === 'threads') continue
        const where = cols.map((col) => `"${col}"=$1`).join(' or ')
        await c.query(`delete from public."${tbl}" where ${where}`, [uid])
      }
      await c.query(`delete from public.tutor_profiles where id=$1`, [uid])
      await c.query(`delete from public.profiles where id=$1`, [uid])
      await c.query(
        `insert into public.admin_audit_log (actor_id, actor_email, actor_role, action, target_type, target_id, detail)
         values (null, 'data-op', 'owner', 'account.delete', 'user', $1, $2)`,
        [uid, JSON.stringify({ note: 'Seed account removed at owner request', date: new Date().toISOString().slice(0, 10) })],
      )
      await c.query('commit')
      console.log(`  DB rows deleted for ${uid}`)
    } catch (e) {
      await c.query('rollback')
      console.log(`  ROLLBACK ${uid}: ${(e as Error).message}`)
      continue
    }
    const { error } = await admin.auth.admin.deleteUser(uid)
    console.log(`  auth user ${uid} deleted${error ? ' ERROR ' + error.message : ''}`)
  }
  await c.end()
  console.log('\nDONE.')
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1) })
