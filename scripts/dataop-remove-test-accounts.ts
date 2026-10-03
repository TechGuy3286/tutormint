/**
 * scripts/dataop-remove-test-accounts.ts
 *
 * DATA-OP (owner, explicit one-off exception to "never delete, only pause"):
 * remove five TEST identities so signup can be retested.
 *
 *   npx tsx scripts/dataop-remove-test-accounts.ts            # STEP 1 dry run
 *   npx tsx scripts/dataop-remove-test-accounts.ts --apply    # STEP 2 delete
 *
 * Dry run is read-only and prints, per identity: the matched auth user(s)
 * (id / role / created), per-table row counts, storage objects, and a
 * PASS/STOP verdict against the stop conditions. It NEVER prints CNIC numbers
 * or document contents (counts and storage paths only). The DB URL and the
 * service key are read from env and never printed.
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

// ---- identities ------------------------------------------------------------
function normMobile(raw: string): { msisdn: string; core10: string } | null {
  const d = raw.replace(/\D/g, '')
  let m = d
  if (m.length === 11 && m.startsWith('0')) m = '92' + m.slice(1)
  else if (m.length === 10 && m.startsWith('3')) m = '92' + m
  else if (m.length === 12 && m.startsWith('92')) m = m
  else if (m.length === 13 && m.startsWith('920')) m = '92' + m.slice(3)
  else return null
  if (!(m.length === 12 && m.startsWith('92'))) return null
  return { msisdn: m, core10: m.slice(2) }
}

type Identity =
  | { kind: 'mobile'; label: string; msisdn: string; core10: string; synthetic: string }
  | { kind: 'email'; label: string; email: string }

const IDENTITIES: Identity[] = [
  ...['03244015462', '03219020203'].map((raw) => {
    const n = normMobile(raw)!
    return { kind: 'mobile' as const, label: raw, msisdn: n.msisdn, core10: n.core10, synthetic: `${n.msisdn}@users.tutormint.org` }
  }),
  { kind: 'email', label: 'raimohsinraza+1@gmail.com', email: 'raimohsinraza+1@gmail.com' },
  { kind: 'email', label: 'theschoolingco@gmail.com', email: 'theschoolingco@gmail.com' },
  { kind: 'email', label: 'theschoolingco+1@gmail.com', email: 'theschoolingco+1@gmail.com' },
]

// (table, columns that reference a user id)
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
// Admin-actor columns on OTHER members' rows — if any reference U, U acted as an
// admin on someone else (a stop signal, and not something to blindly delete).
const ACTOR_REFS: [string, string[]][] = [
  ['profiles', ['banned_by', 'cnic_reviewed_by', 'profile_pic_reviewed_by', 'selfie_reviewed_by', 'suspended_by']],
  ['taxonomy_aliases', ['created_by']],
]
const BUCKETS = ['ads', 'avatars', 'blog', 'identity-docs', 'message-media', 'payment-proofs', 'tutor-media']

async function main() {
  const c = new pg.Client({ connectionString: dbUrl })
  await c.connect()

  const allIds = new Set<string>()
  const report: { id: string; identity: string }[] = []
  let stop = false
  const stopReasons: string[] = []

  for (const idn of IDENTITIES) {
    console.log(`\n================ ${idn.label} ================`)
    // Resolve auth user ids.
    let rows
    if (idn.kind === 'mobile') {
      rows = await c.query(
        `select u.id, u.email, u.phone, u.created_at, p.role, p.admin_role, p.is_team_account, p.is_seed
           from auth.users u left join public.profiles p on p.id = u.id
          where regexp_replace(coalesce(u.phone,''),'\\D','','g') like '%'||$1
             or lower(u.email) = lower($2)
             or regexp_replace(coalesce(p.phone_number,''),'\\D','','g') like '%'||$1
             or regexp_replace(coalesce(p.whatsapp,''),'\\D','','g') like '%'||$1
             or lower(p.email) = lower($2)`,
        [idn.core10, idn.synthetic],
      )
    } else {
      rows = await c.query(
        `select u.id, u.email, u.phone, u.created_at, p.role, p.admin_role, p.is_team_account, p.is_seed
           from auth.users u left join public.profiles p on p.id = u.id
          where lower(u.email) = lower($1) or lower(p.email) = lower($1)`,
        [idn.email],
      )
    }
    const ids = rows.rows.map((r: { id: string }) => r.id)
    const uniq = Array.from(new Set(ids))
    if (uniq.length === 0) {
      console.log('  no auth user matched')
    }
    if (uniq.length > 1) { stop = true; stopReasons.push(`${idn.label}: ${uniq.length} auth users matched`) }
    for (const r of rows.rows) {
      console.log(`  auth user ${r.id}  role=${r.role ?? '-'} admin_role=${r.admin_role ?? '-'} team=${r.is_team_account} seed=${r.is_seed} created=${new Date(r.created_at).toISOString().slice(0,10)} email=${(r.email||'').replace(/(.{3}).*(@.*)/,'$1…$2')} phone=${r.phone ? '…'+String(r.phone).slice(-4) : '-'}`)
      if (r.admin_role || r.role === 'admin') { stop = true; stopReasons.push(`${idn.label}: account ${r.id} is admin (admin_role=${r.admin_role}, role=${r.role})`) }
      if (r.is_team_account) { stop = true; stopReasons.push(`${idn.label}: account ${r.id} is the team account`) }
      allIds.add(r.id)
      report.push({ id: r.id, identity: idn.label })
    }

    // No-account scans (free text / pre-auth).
    if (idn.kind === 'mobile') {
      const ps = await c.query(`select count(*) n from pending_signups where mobile=$1`, [idn.msisdn])
      const bl = await c.query(`select count(*) n from signup_blocklist where mobile=$1`, [idn.msisdn])
      const jc = await c.query(`select count(*) n from job_contacts where regexp_replace(coalesce(contact_phone,''),'\\D','','g') like '%'||$1 or regexp_replace(coalesce(contact_whatsapp,''),'\\D','','g') like '%'||$1`, [idn.core10])
      console.log(`  pending_signups: ${ps.rows[0].n}   signup_blocklist: ${bl.rows[0].n}   job_contacts(phone): ${jc.rows[0].n}`)
    }

    // Per-id table counts + storage + stop checks on payments/actor refs.
    for (const uid of uniq) {
      console.log(`  --- rows for ${uid} ---`)
      let total = 0
      for (const [tbl, cols] of USER_TABLES) {
        const where = cols.map((col) => `"${col}"=$1`).join(' or ')
        try {
          const r = await c.query(`select count(*) n from public."${tbl}" where ${where}`, [uid])
          const n = Number(r.rows[0].n)
          if (n > 0) { console.log(`      ${tbl} (${cols.join('/')}): ${n}`); total += n }
        } catch (e) { console.log(`      ${tbl}: ERROR ${(e as Error).message}`) }
      }
      // payments stop check
      const pay = await c.query(`select status, provider, method, amount_pkr from public.payments where user_id=$1`, [uid])
      for (const p of pay.rows) {
        console.log(`      payment: status=${p.status} provider=${p.provider} method=${p.method} amount=${p.amount_pkr}`)
        if (p.status === 'approved') { stop = true; stopReasons.push(`${idn.label}: account ${uid} has an APPROVED payment (provider=${p.provider}, method=${p.method})`) }
      }
      // actor-ref stop checks
      for (const [tbl, cols] of ACTOR_REFS) {
        const where = cols.map((col) => `"${col}"=$1`).join(' or ')
        const r = await c.query(`select count(*) n from public."${tbl}" where ${where}`, [uid])
        const n = Number(r.rows[0].n)
        if (n > 0) { console.log(`      [actor] ${tbl} (${cols.join('/')}): ${n}`); stop = true; stopReasons.push(`${idn.label}: account ${uid} acted as admin on ${tbl} (${n} rows)`) }
      }
      // storage
      for (const b of BUCKETS) {
        const r = await c.query(`select count(*) n from storage.objects where bucket_id=$1 and (name like $2 or name like $3)`, [b, `${uid}/%`, `%${uid}%`])
        const n = Number(r.rows[0].n)
        if (n > 0) console.log(`      storage[${b}]: ${n}`)
      }
      console.log(`      (table rows total: ${total})`)
    }
  }

  console.log(`\n================ VERDICT ================`)
  if (stop) {
    console.log('STOP — do NOT delete. Reasons:')
    for (const r of stopReasons) console.log(`  • ${r}`)
  } else {
    console.log(`PASS — ${allIds.size} account(s) safe to delete: ${Array.from(allIds).join(', ')}`)
  }

  if (!APPLY) { console.log('\n(dry run — no changes. Re-run with --apply after review.)'); await c.end(); return }
  if (stop) { console.log('\nRefusing to --apply while a STOP condition holds.'); await c.end(); process.exit(2) }

  // ---- STEP 2 delete (only reached when PASS + --apply) --------------------
  console.log('\n================ APPLYING ================')
  const admin = createClient(supaUrl!, serviceKey!, { auth: { persistSession: false } })
  for (const uid of allIds) {
    // storage first (bytes), via the storage API so the objects are really gone
    for (const b of BUCKETS) {
      const objsRes = await c.query(`select name from storage.objects where bucket_id=$1 and (name like $2 or name like $3)`, [b, `${uid}/%`, `%${uid}%`])
      const objs = objsRes.rows as { name: string }[]
      if (objs.length) {
        const { error } = await admin.storage.from(b).remove(objs.map((o) => o.name))
        console.log(`  storage[${b}] removed ${objs.length}${error ? ' ERROR ' + error.message : ''}`)
      }
    }
    // DB rows in one transaction, leaves first, then tutor_profiles, profiles last.
    await c.query('begin')
    try {
      // Conversations: delete every message in the test account's threads (both
      // parties — that is "their conversation") AND any they sent elsewhere.
      // messages has no FK to threads, so orphans would otherwise linger.
      await c.query(
        `delete from public.messages
          where sender_id=$1
             or thread_id in (select id from public.threads where participant_a=$1 or participant_b=$1)`,
        [uid],
      )
      for (const [tbl, cols] of USER_TABLES) {
        if (tbl === 'profiles' || tbl === 'tutor_profiles' || tbl === 'messages') continue
        const where = cols.map((col) => `"${col}"=$1`).join(' or ')
        await c.query(`delete from public."${tbl}" where ${where}`, [uid])
      }
      await c.query(`delete from public.tutor_profiles where id=$1`, [uid])
      await c.query(`delete from public.profiles where id=$1`, [uid])
      // one audit line, no personal data
      await c.query(
        `insert into public.admin_audit_log (actor_id, actor_email, actor_role, action, target_type, target_id, detail)
         values (null, 'data-op', 'owner', 'account.delete', 'user', $1, $2)`,
        [uid, JSON.stringify({ note: 'Test account removed at owner request', date: new Date().toISOString().slice(0, 10) })],
      )
      await c.query('commit')
      console.log(`  DB rows deleted for ${uid}`)
    } catch (e) {
      await c.query('rollback')
      console.log(`  ROLLBACK ${uid}: ${(e as Error).message}`)
      continue
    }
    // finally the auth user (admin API) so the email/number is free again
    const { error } = await admin.auth.admin.deleteUser(uid)
    console.log(`  auth user ${uid} deleted${error ? ' ERROR ' + error.message : ''}`)
  }
  // pending drafts + blocklist entries for the mobiles (no account)
  for (const idn of IDENTITIES) {
    if (idn.kind !== 'mobile') continue
    const r1 = await c.query(`delete from pending_signups where mobile=$1`, [idn.msisdn])
    const r2 = await c.query(`delete from signup_blocklist where mobile=$1`, [idn.msisdn])
    console.log(`  ${idn.label}: pending_signups -${r1.rowCount}, signup_blocklist -${r2.rowCount}`)
  }
  await c.end()
  console.log('\nDONE.')
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1) })
