/**
 * scripts/dataop-delete-test-tutors.ts
 *
 * ONE-TIME HARD DELETE of two test tutor accounts — "Tutor Test 5" and
 * "Test Tutor 6" — approved by Alee (owner, 5 Oct 2026) as the single exception
 * to the platform's no-delete rule.
 *
 * What it does, in order, only when EXACTLY two accounts match those names:
 *   1. storage: removes every object under the two ids in the avatars and
 *      identity-docs buckets (CNIC, photo, selfie; there are no degree files)
 *      through the Storage API, so the bytes go, not only the rows;
 *   2. one transaction: payments KEPT — user_id set to null, note
 *      'deleted test account' (amount, provider_ref, dates untouched); every
 *      other linked row deleted explicitly (applications, notifications,
 *      activity events/sessions, tuition access, usage counters, OTPs, profile
 *      views, field history, member timeline rows incl. target references,
 *      documents, areas, subjects, slug history, tutor profile, profile);
 *   3. the two auth users (identities, sessions, refresh tokens go with them).
 * admin_audit_log rows that mention the ids are KEPT: the audit log is
 * append-only by construction. There is no intro video on either account.
 *
 *   npx tsx --env-file=.env.local scripts/dataop-delete-test-tutors.ts            # SELECT only
 *   npx tsx --env-file=.env.local scripts/dataop-delete-test-tutors.ts --apply    # delete, then re-SELECT
 */
// @ts-expect-error pg ships no bundled types; dev-only data-op script.
import pg from 'pg'
import { createClient } from '@supabase/supabase-js'

const APPLY = process.argv.includes('--apply')
const NAMES = ['Tutor Test 5', 'Test Tutor 6']
const NOTE = 'deleted test account'
const dbUrl = process.env.SUPABASE_DB_URL
if (!dbUrl) { console.error('SUPABASE_DB_URL not set'); process.exit(1) }

type Acct = { id: string; full_name: string; role: string; mobile_last3: string; created_at: string; status: string; slug: string | null; video_youtube_id: string | null }

const SELECT = `
  select p.id, p.full_name, p.role::text as role, right(coalesce(p.phone_number,''),3) as mobile_last3, p.created_at,
         case when coalesce(p.is_banned,false) then 'banned' when coalesce(p.is_suspended,false) then 'paused' else 'active' end as status,
         tp.slug, tp.video_youtube_id
    from public.profiles p left join public.tutor_profiles tp on tp.id = p.id
   where p.full_name = any($1::text[]) order by p.created_at`

const LINKED: [string, string][] = [
  ['payments', 'user_id'], ['applications', 'tutor_id'], ['messages', 'sender_id'], ['threads', 'participant_a'], ['threads', 'participant_b'],
  ['shortlists', 'user_id'], ['shortlists', 'tutor_id'], ['saved_jobs', 'user_id'], ['demo_requests', 'tutor_id'], ['demo_requests', 'parent_id'],
  ['user_documents', 'user_id'], ['notifications', 'user_id'], ['activity_events', 'user_id'], ['activity_sessions', 'user_id'],
  ['tuition_access', 'tutor_id'], ['usage_counters', 'user_id'], ['phone_otps', 'user_id'], ['profile_views', 'tutor_id'],
  ['tutor_field_history', 'tutor_id'], ['tutor_field_history', 'changed_by'], ['user_activity_log', 'user_id'],
  ['tutor_areas', 'tutor_id'], ['tutor_subjects', 'tutor_id'], ['slug_history', 'tutor_id'], ['subscriptions', 'user_id'],
  ['reviews', 'tutor_id'], ['tutor_slots', 'tutor_id'], ['tutor_profiles', 'id'], ['profiles', 'id'],
]

async function counts(c: pg.Client, ids: string[]) {
  const out: Record<string, number> = {}
  for (const [t, col] of LINKED) {
    try { out[`${t}.${col}`] = (await c.query(`select count(*)::int as n from public."${t}" where "${col}" = any($1::uuid[])`, [ids])).rows[0].n } catch { /* no such table/column */ }
  }
  out['user_activity_log.target_id(text)'] = (await c.query(`select count(*)::int as n from public.user_activity_log where target_id = any($1::text[])`, [ids])).rows[0].n
  out['admin_audit_log.target_id(text, kept)'] = (await c.query(`select count(*)::int as n from public.admin_audit_log where target_id = any($1::text[])`, [ids])).rows[0].n
  out['storage.objects'] = (await c.query(`select count(*)::int as n from storage.objects where owner = any($1::uuid[]) or split_part(name,'/',1) = any($2::text[])`, [ids, ids])).rows[0].n
  out['auth.users'] = (await c.query(`select count(*)::int as n from auth.users where id = any($1::uuid[])`, [ids])).rows[0].n
  return Object.fromEntries(Object.entries(out).filter(([, n]) => n > 0))
}

async function main() {
  const c = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } })
  await c.connect()
  try {
    const accts = (await c.query(SELECT, [NAMES])).rows as Acct[]
    console.log('BEFORE — accounts:'); console.table(accts)
    const ids = accts.map((a) => a.id)
    console.log('linked rows:'); console.table(await counts(c, ids))
    for (const a of accts) console.log(`intro video on ${a.full_name}: ${a.video_youtube_id ?? 'none'}`)
    if (accts.length !== 2 || new Set(accts.map((a) => a.full_name)).size !== 2) {
      console.log(`\nSTOP — expected exactly 2 accounts (one per name), found ${accts.length}.`)
      process.exitCode = 2
      return
    }
    if (!APPLY) { console.log('\nDry run only. Re-run with --apply to delete.'); return }

    // 1. Storage objects, through the API (bytes + rows).
    const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const svc = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!supaUrl || !svc) throw new Error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set')
    const admin = createClient(supaUrl, svc, { auth: { persistSession: false } })
    const { rows: objs } = await c.query(`select bucket_id, name from storage.objects where owner = any($1::uuid[]) or split_part(name,'/',1) = any($2::text[])`, [ids, ids])
    const byBucket = new Map<string, string[]>()
    for (const o of objs as { bucket_id: string; name: string }[]) byBucket.set(o.bucket_id, [...(byBucket.get(o.bucket_id) ?? []), o.name])
    for (const [bucket, names] of byBucket) {
      const { error } = await admin.storage.from(bucket).remove(names)
      if (error) throw new Error(`storage remove failed for ${bucket}: ${error.message}`)
      console.log(`storage: removed ${names.length} object(s) from ${bucket}`)
    }

    // 2. Database, one transaction.
    await c.query('begin')
    try {
      const pay = await c.query(`update public.payments set user_id = null, note = $2 where user_id = any($1::uuid[]) returning id`, [ids, NOTE])
      console.log(`payments kept, unlinked and noted: ${pay.rowCount}`)
      const del = async (t: string, col: string) => {
        try { const r = await c.query(`delete from public."${t}" where "${col}" = any($1::uuid[])`, [ids]); if (r.rowCount) console.log(`  deleted ${r.rowCount} from ${t}.${col}`) } catch (e) { if (!/does not exist/.test((e as Error).message)) throw e }
      }
      for (const [t, col] of LINKED) { if (t === 'payments' || t === 'profiles' || t === 'tutor_profiles') continue; await del(t, col) }
      const ual = await c.query(`delete from public.user_activity_log where target_id = any($1::text[])`, [ids]); if (ual.rowCount) console.log(`  deleted ${ual.rowCount} from user_activity_log.target_id`)
      await del('tutor_profiles', 'id')
      await del('profiles', 'id')
      await c.query('commit')
    } catch (e) { await c.query('rollback'); throw e }

    // 3. Auth users (identities / sessions / refresh tokens cascade in GoTrue).
    for (const a of accts) {
      const { error } = await admin.auth.admin.deleteUser(a.id)
      if (error) throw new Error(`deleteUser ${a.id}: ${error.message}`)
      console.log(`auth user deleted: ${a.full_name}`)
    }

    const after = (await c.query(SELECT, [NAMES])).rows
    console.log('\nAFTER — accounts matching the names:', after.length)
    console.log('AFTER — linked rows remaining (expect only the kept payments and the audit log):'); console.table(await counts(c, ids))
    console.log('AFTER — kept payments:'); console.table((await c.query(`select id, user_id, plan_code, amount_pkr, provider, provider_ref, status, created_at, note from public.payments where note = $1 order by created_at`, [NOTE])).rows)
  } finally {
    await c.end()
  }
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1) })
