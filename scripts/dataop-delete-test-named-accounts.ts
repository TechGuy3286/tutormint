/**
 * scripts/dataop-delete-test-named-accounts.ts
 *
 * ONE-TIME HARD DELETE (owner exception, 8 Oct 2026) of every account whose name
 * contains the whole word "test" (case-insensitive) or is exactly "New User",
 * done the same way as Tutor Test 5 and 6 (scripts/dataop-delete-test-tutors.ts):
 *
 *   1. storage: every object under the ids (avatars, identity-docs, message
 *      media…) removed through the Storage API, so the bytes go too;
 *   2. one transaction: payments KEPT — user_id set to null, note 'deleted test
 *      account' (amount, provider_ref and dates untouched); every other row that
 *      references the accounts deleted (applications, messages, threads, their
 *      tuitions and everything hanging off them, notifications, slugs…) — the
 *      foreign keys are read from the database, so nothing is guessed; the
 *      member timeline rows that name the ids are deleted too;
 *   3. the auth users.
 * admin_audit_log rows are KEPT (append-only by construction).
 * "Aqsa Mughal" is never touched (not test-named; asserted anyway).
 *
 *   npx tsx --env-file=.env.local scripts/dataop-delete-test-named-accounts.ts          # SELECT only
 *   npx tsx --env-file=.env.local scripts/dataop-delete-test-named-accounts.ts --apply  # delete, then re-SELECT
 */
// @ts-expect-error pg ships no bundled types; dev-only data-op script.
import pg from 'pg'
import { createClient } from '@supabase/supabase-js'

const APPLY = process.argv.includes('--apply')
const NOTE = 'deleted test account'
const dbUrl = process.env.SUPABASE_DB_URL
if (!dbUrl) { console.error('SUPABASE_DB_URL not set'); process.exit(1) }

const SELECT = `
  select p.id, p.full_name, p.role::text as role, p.created_at,
         (select count(*) from public.payments pa where pa.user_id = p.id)::int as payments,
         (select coalesce(string_agg(pa.provider_ref || ' ' || pa.status || ' Rs ' || pa.amount_pkr, '; '), '') from public.payments pa where pa.user_id = p.id) as payment_list
    from public.profiles p
   where (coalesce(p.full_name,'') ~* '\\mtest\\M' or btrim(coalesce(p.full_name,'')) ~* '^new user$')
   order by p.created_at`

type Acct = { id: string; full_name: string; role: string; created_at: string; payments: number; payment_list: string }

async function main() {
  const c = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } })
  await c.connect()
  try {
    const accts = (await c.query(SELECT)).rows as Acct[]
    console.log(`BEFORE — ${accts.length} test-named account(s):`)
    console.table(accts.map((a) => ({ id: a.id, name: a.full_name, role: a.role, created: a.created_at, payments: a.payment_list || 0 })))
    if (accts.some((a) => /aqsa/i.test(a.full_name))) throw new Error('STOP — an Aqsa account matched; it must never be touched.')
    const ids = accts.map((a) => a.id)
    if (ids.length === 0) { console.log('Nothing to delete.'); return }

    // Every public FK that points at profiles(id) or auth.users(id).
    const { rows: fks } = await c.query(`
      select cl.relname as tbl, a.attname as col, ref.relname as ref
        from pg_constraint co
        join pg_class cl on cl.oid = co.conrelid
        join pg_namespace n on n.oid = cl.relnamespace and n.nspname = 'public'
        join pg_class ref on ref.oid = co.confrelid
        join pg_namespace rn on rn.oid = ref.relnamespace
        join pg_attribute a on a.attrelid = co.conrelid and a.attnum = co.conkey[1]
       where co.contype = 'f' and array_length(co.conkey, 1) = 1
         and ((rn.nspname = 'public' and ref.relname = 'profiles') or (rn.nspname = 'auth' and ref.relname = 'users'))`)
    const counts: Record<string, number> = {}
    for (const f of fks as { tbl: string; col: string }[]) {
      const n = (await c.query(`select count(*)::int n from public."${f.tbl}" where "${f.col}" = any($1::uuid[])`, [ids])).rows[0].n
      if (n) counts[`${f.tbl}.${f.col}`] = n
    }
    const jobs = (await c.query(`select id from public.jobs where parent_id = any($1::uuid[])`, [ids])).rows.map((r: { id: string }) => r.id)
    counts['jobs (tuitions) posted'] = jobs.length
    counts['storage.objects'] = (await c.query(`select count(*)::int n from storage.objects where owner = any($1::uuid[]) or split_part(name,'/',1) = any($2::text[])`, [ids, ids])).rows[0].n
    console.log('linked rows:'); console.table(counts)
    if (!APPLY) { console.log('\nDry run only. Re-run with --apply to delete.'); return }

    // 1. Storage.
    const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
    const { rows: objs } = await c.query(`select bucket_id, name from storage.objects where owner = any($1::uuid[]) or split_part(name,'/',1) = any($2::text[])`, [ids, ids])
    const byBucket = new Map<string, string[]>()
    for (const o of objs as { bucket_id: string; name: string }[]) byBucket.set(o.bucket_id, [...(byBucket.get(o.bucket_id) ?? []), o.name])
    for (const [bucket, names] of byBucket) {
      const { error } = await admin.storage.from(bucket).remove(names)
      if (error) throw new Error(`storage remove failed for ${bucket}: ${error.message}`)
      console.log(`storage: removed ${names.length} object(s) from ${bucket}`)
    }

    // 2. Database, one transaction. Payments kept + unlinked; the rest deleted
    // in passes (a row that something else still points at waits a pass).
    await c.query('begin')
    try {
      const pay = await c.query(`update public.payments set user_id = null, note = $2 where user_id = any($1::uuid[]) returning id`, [ids, NOTE])
      console.log(`payments kept, unlinked and noted: ${pay.rowCount}`)
      // Rows hanging off their tuitions and threads first.
      if (jobs.length) {
        for (const [t, col] of [['applications', 'job_id'], ['saved_jobs', 'job_id'], ['job_subjects', 'job_id'], ['job_contacts', 'job_id'], ['tuition_access', 'job_id']]) {
          try { await c.query('savepoint s'); const r = await c.query(`delete from public."${t}" where "${col}" = any($1::uuid[])`, [jobs]); await c.query('release savepoint s'); if (r.rowCount) console.log(`  deleted ${r.rowCount} from ${t}.${col}`) } catch { await c.query('rollback to savepoint s') }
        }
      }
      const threads = (await c.query(`select id from public.threads where participant_a = any($1::uuid[]) or participant_b = any($1::uuid[])`, [ids])).rows.map((r: { id: string }) => r.id)
      if (threads.length) {
        const r = await c.query(`delete from public.messages where thread_id = any($1::uuid[])`, [threads]); if (r.rowCount) console.log(`  deleted ${r.rowCount} messages in their threads`)
      }
      const targets = (fks as { tbl: string; col: string }[]).filter((f) => !['payments', 'profiles', 'admin_audit_log'].includes(f.tbl))
      let pending = targets
      for (let pass = 0; pass < 6 && pending.length; pass++) {
        const next: typeof pending = []
        for (const f of pending) {
          try {
            await c.query('savepoint s')
            const r = await c.query(`delete from public."${f.tbl}" where "${f.col}" = any($1::uuid[])`, [ids])
            await c.query('release savepoint s')
            if (r.rowCount) console.log(`  deleted ${r.rowCount} from ${f.tbl}.${f.col}`)
          } catch {
            await c.query('rollback to savepoint s')
            next.push(f)
          }
        }
        pending = next
      }
      if (pending.length) throw new Error(`could not clear: ${pending.map((f) => `${f.tbl}.${f.col}`).join(', ')}`)
      const ual = await c.query(`delete from public.user_activity_log where target_id = any($1::text[])`, [ids]); if (ual.rowCount) console.log(`  deleted ${ual.rowCount} from user_activity_log.target_id`)
      const pr = await c.query(`delete from public.profiles where id = any($1::uuid[])`, [ids]); console.log(`  deleted ${pr.rowCount} profiles`)
      await c.query('commit')
    } catch (e) { await c.query('rollback'); throw e }

    // 3. Auth users.
    for (const a of accts) {
      const { error } = await admin.auth.admin.deleteUser(a.id)
      if (error && !/not found/i.test(error.message)) throw new Error(`deleteUser ${a.id}: ${error.message}`)
      console.log(`auth user deleted: ${a.full_name}`)
    }

    const after = (await c.query(SELECT)).rows
    console.log(`\nAFTER — test-named accounts remaining: ${after.length}`)
    console.log('AFTER — kept payments:'); console.table((await c.query(`select provider_ref, plan_code, amount_pkr, status, created_at, note from public.payments where note = $1 order by created_at`, [NOTE])).rows)
    const authLeft = (await c.query(`select count(*)::int n from auth.users where id = any($1::uuid[])`, [ids])).rows[0].n
    console.log('AFTER — auth users remaining:', authLeft)
  } finally {
    await c.end()
  }
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1) })
