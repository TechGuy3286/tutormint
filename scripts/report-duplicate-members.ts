/**
 * scripts/report-duplicate-members.ts — READ-ONLY.
 * Members who look like the same person, same role, joined within 14 days of
 * each other, matched on ANY of: the same name (case- and space-insensitive),
 * the same photo (avatar_url), the same mobile or WhatsApp (last 10 digits,
 * either column), or the same email local part (real addresses only). Each pair
 * says what matched; NEW marks a pair where either account joined after
 * SINCE (default: the last run, 9 Oct 2026 07:13 UTC; override with --since=ISO).
 * Masked contact. Changes nothing.
 *   npx tsx --env-file=.env.local scripts/report-duplicate-members.ts
 */
// @ts-expect-error pg ships no bundled types
import pg from 'pg'
const last4 = (v: string | null) => (v && v.replace(/\D/g, '').length >= 4 ? '…' + v.replace(/\D/g, '').slice(-4) : '—')
const maskEmail = (e: string | null) => {
  if (!e || /@users\.tutormint\.org$/i.test(e)) return '—'
  const [u, d] = e.split('@'); return `${u.slice(0, 2)}***@${d}`
}
const SINCE = (process.argv.find((a) => a.startsWith('--since=')) ?? '--since=2026-10-09T07:13:29Z').slice(8)
async function main() {
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  const { rows } = await c.query(String.raw`
    with m as (
      select p.id, p.full_name, p.role, p.created_at, coalesce(p.phone_number, p.whatsapp) mobile, p.email,
             p.profile_completion, p.is_suspended, p.paused_by_user_at is not null as self_paused,
             lower(regexp_replace(btrim(p.full_name), '\s+', ' ', 'g')) as key,
             nullif(p.avatar_url, '') as photo,
             nullif(right(regexp_replace(coalesce(p.phone_number,''), '\D', '', 'g'), 10), '') as m1,
             nullif(right(regexp_replace(coalesce(p.whatsapp,''), '\D', '', 'g'), 10), '') as m2,
             case when p.email ilike '%@users.tutormint.org' then null else nullif(lower(split_part(p.email, '@', 1)), '') end as local,
             (tp.verified_fee_paid_at is not null) as fee_paid,
             (select count(*) from user_activity_log a where a.user_id=p.id) +
             (select count(*) from applications x where x.tutor_id=p.id) +
             (select count(*) from jobs j where j.parent_id=p.id) +
             (select count(*) from messages g where g.sender_id=p.id) as activity
      from profiles p left join tutor_profiles tp on tp.id=p.id
      where coalesce(btrim(p.full_name),'')<>'' and not coalesce(p.is_seed,false) and not coalesce(p.is_team_account,false) and p.role in ('tutor','parent')
    )
    select a.*, b.id b_id, b.full_name b_name, b.created_at b_created, b.mobile b_mobile, b.email b_email, b.profile_completion b_completion,
           b.fee_paid b_fee, b.activity b_activity, b.is_suspended b_susp, b.self_paused b_self,
           concat_ws(', ',
             case when a.key = b.key then 'name' end,
             case when a.photo = b.photo then 'photo' end,
             case when coalesce(a.m1,a.m2) is not null and (a.m1 in (b.m1,b.m2) or a.m2 in (b.m1,b.m2)) then 'mobile/WhatsApp' end,
             case when a.local = b.local then 'email local part' end) as matched,
           greatest(a.created_at, b.created_at) >= $1::timestamptz as is_new
    from m a join m b on a.role=b.role and a.id<b.id and abs(extract(epoch from a.created_at-b.created_at)) <= 14*86400
      and (a.key=b.key or a.photo=b.photo or a.m1 in (b.m1,b.m2) or a.m2 in (b.m1,b.m2) or a.local=b.local)
    order by greatest(a.created_at, b.created_at) desc`, [SINCE])
  for (const r of rows) {
    const side = (n: string, cr: Date, mob: string, em: string, comp: number, fee: boolean, act: number, susp: boolean, self: boolean) =>
      `${n} | joined ${cr.toISOString().slice(0, 10)} | mobile ${last4(mob)} | email ${maskEmail(em)} | ${comp ?? 0}% | ${r.role === 'tutor' ? (fee ? 'paid' : 'not paid') : 'n/a'} | activity ${act}${susp ? ' | PAUSED' : ''}${self ? ' | self-paused' : ''}`
    console.log(`[${r.role}]${r.is_new ? ' NEW' : ''} matched on: ${r.matched}`)
    console.log('  A: ' + side(r.full_name, r.created_at, r.mobile, r.email, r.profile_completion, r.fee_paid, Number(r.activity), r.is_suspended, r.self_paused))
    console.log('  B: ' + side(r.b_name, r.b_created, r.b_mobile, r.b_email, r.b_completion, r.b_fee, Number(r.b_activity), r.b_susp, r.b_self))
    const a = Number(r.activity), b = Number(r.b_activity)
    console.log('  more activity: ' + (a === b ? 'equal' : a > b ? 'A' : 'B'))
  }
  console.log('pairs', rows.length, '· new since', SINCE, rows.filter((x: { is_new: boolean }) => x.is_new).length)
  await c.end()
}
main()
