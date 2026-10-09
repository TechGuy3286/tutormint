/**
 * scripts/report-dup-action-facts.ts — READ-ONLY (owner, 10 Oct 2026).
 * Facts for the six accounts named in the duplicate-report action list (Sidra
 * Aziz ×2, Tehreem Sohail ×2, Ali Sabeer, Ehtasham Abbasi): status, flags,
 * completion, slug, and a row count in EVERY column that references the member
 * (all foreign keys to auth.users/profiles, discovered from pg_constraint, plus
 * known non-FK id columns), storage objects and auth.users. Contact masked.
 *   npx tsx --env-file=.env.local scripts/report-dup-action-facts.ts
 */
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

export const NAMES = ['sidra aziz', 'tehreem sohail', 'ali sabeer', 'ehtasham abbasi']

const EXTRA: [string, string][] = [
  ['messages', 'sender_id'], ['threads', 'participant_a'], ['threads', 'participant_b'], ['user_activity_log', 'user_id'],
  ['activity_events', 'user_id'], ['activity_sessions', 'user_id'], ['tuition_access', 'tutor_id'], ['profile_views', 'tutor_id'],
  ['profile_views', 'viewer_id'], ['contact_reveals', 'tutor_id'], ['member_follow_ups', 'member_id'], ['admin_messages', 'member_id'],
  ['notifications', 'user_id'], ['user_documents', 'user_id'], ['tutor_subjects', 'tutor_id'], ['tutor_areas', 'tutor_id'],
]

export async function accounts(c: pg.Client) {
  return (await c.query(String.raw`
    select p.id, p.full_name, p.role::text role, p.created_at, p.profile_completion,
      case when p.email ilike '%@users.tutormint.org' then 'mobile' else 'email' end signup,
      case when p.email ilike '%@users.tutormint.org' then '—' else left(p.email,2)||'***@'||split_part(p.email,'@',2) end email,
      case when coalesce(p.phone_number,'')='' then '—' else '…'||right(regexp_replace(p.phone_number,'\D','','g'),4) end mobile,
      case when coalesce(p.whatsapp,'')='' then '—' else '…'||right(regexp_replace(p.whatsapp,'\D','','g'),4) end whatsapp,
      coalesce(p.is_suspended,false) paused, coalesce(p.is_banned,false) banned, p.paused_by_user_at is not null self_paused,
      coalesce(p.hidden_from_public,false) hidden_from_public, coalesce(p.is_test_name,false) is_test_name, coalesce(p.is_seed,false) is_seed,
      tp.slug, tp.verification_status::text verification_status, tp.verified_fee_paid_at is not null fee_paid,
      exists(select 1 from tutor_directory d where d.id=p.id) on_browse
    from profiles p left join tutor_profiles tp on tp.id=p.id
    where lower(regexp_replace(btrim(p.full_name), '\s+', ' ', 'g')) = any($1::text[])
    order by lower(p.full_name), p.created_at`, [NAMES])).rows
}

export async function linkedCounts(c: pg.Client, id: string): Promise<Record<string, number>> {
  const fks = (await c.query(`
    select cl.relname as t, a.attname as col
      from pg_constraint k
      join pg_class cl on cl.oid = k.conrelid join pg_namespace n on n.oid = cl.relnamespace
      join pg_class rf on rf.oid = k.confrelid join pg_namespace rn on rn.oid = rf.relnamespace
      join pg_attribute a on a.attrelid = k.conrelid and a.attnum = k.conkey[1]
     where k.contype='f' and n.nspname='public' and array_length(k.conkey,1)=1
       and ((rn.nspname='auth' and rf.relname='users') or (rn.nspname='public' and rf.relname='profiles'))`)).rows as { t: string; col: string }[]
  const cols = new Map<string, [string, string]>()
  for (const f of fks) cols.set(`${f.t}.${f.col}`, [f.t, f.col])
  for (const e of EXTRA) cols.set(`${e[0]}.${e[1]}`, e)
  const out: Record<string, number> = {}
  for (const [k, [t, col]] of cols) {
    try {
      const n = (await c.query(`select count(*)::int n from public."${t}" where "${col}" = $1::uuid`, [id])).rows[0].n
      if (n) out[k] = n
    } catch { /* table or column absent */ }
  }
  const tgt = (await c.query(`select count(*)::int n from user_activity_log where target_id = $1`, [id])).rows[0].n
  if (tgt) out['user_activity_log.target_id'] = tgt
  const aud = (await c.query(`select count(*)::int n from admin_audit_log where target_id = $1`, [id])).rows[0].n
  if (aud) out['admin_audit_log.target_id'] = aud
  const st = (await c.query(`select count(*)::int n from storage.objects where owner = $1::uuid or split_part(name,'/',1) = $2`, [id, id])).rows[0].n
  if (st) out['storage.objects'] = st
  out['auth.users'] = (await c.query(`select count(*)::int n from auth.users where id = $1::uuid`, [id])).rows[0].n
  return out
}

async function main() {
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  try {
    for (const a of await accounts(c)) {
      console.log(`\n${a.full_name} · ${a.id} · ${a.role} · joined ${a.created_at.toISOString()} · ${a.signup} signup`)
      const { id: _id, full_name: _n, created_at: _c, ...rest } = a
      console.log('  ' + JSON.stringify(rest))
      console.log('  linked: ' + JSON.stringify(await linkedCounts(c, a.id)))
    }
  } finally {
    await c.end()
  }
}
if (require.main === module) void main()
