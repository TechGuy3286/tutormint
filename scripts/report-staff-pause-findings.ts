/**
 * scripts/report-staff-pause-findings.ts — READ-ONLY. Facts for the staff
 * Pause PR (owner, 11 Nov 2026), counts only — never a name, phone, email,
 * CNIC, account number or message text.
 *   npx tsx --env-file=.env.local scripts/report-staff-pause-findings.ts
 *
 *  1. The Backend Support member removed on 10 Nov: live sessions / refresh
 *     tokens, tuitions and cities still assigned, and the last 14 days of her
 *     access as counts per day (CSV exports + rows, phone Show, document
 *     decisions, logins).
 *  2. The auto-suspended account named "Shoaib Hassan": role, fee status, and
 *     each abuse flag's source, whether it was withheld, whether a recipient can
 *     read it.
 */
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

async function main() {
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  const q = async (sql: string, params: unknown[] = []) => (await c.query(sql, params)).rows as Record<string, unknown>[]
  try {
    await c.query('set transaction read only')
  } catch {
    /* outside a transaction — the queries below only read */
  }

  // ---------------------------------------------------------------- 1 ----
  const removed = await q(`
    select p.id, p.former_staff_at, p.former_staff_role
      from profiles p
     where p.former_staff_at >= '2026-11-09' and p.former_staff_at < '2026-11-12'
       and coalesce(p.former_staff_role, '') = 'backend_support'`)
  console.log(`\n== 1. Removed Backend Support accounts (10 Nov window): ${removed.length}`)
  for (const r of removed) {
    const id = r.id as string
    console.log(`  account #${removed.indexOf(r) + 1}: left ${new Date(r.former_staff_at as string).toISOString()}`)
    const [s] = await q(`select count(*)::int n, max(coalesce(refreshed_at, updated_at, created_at)) last from auth.sessions where user_id = $1`, [id])
    const [t] = await q(`select count(*) filter (where not revoked)::int live, count(*)::int total from auth.refresh_tokens where user_id = $1::text`, [id])
    console.log(`  sessions now: ${s.n} (last activity ${s.last ? new Date(s.last as string).toISOString() : '—'}); refresh tokens not revoked: ${t.live} of ${t.total}`)
    const [o] = await q(`select count(*)::int n from tuition_owners where staff_id = $1`, [id])
    const [cty] = await q(`select count(*)::int n from city_owners where staff_id = $1`, [id])
    const [lnk] = await q(`select count(*) filter (where deactivated_at is null)::int active, count(*)::int total from staff_join_links where staff_id = $1`, [id])
    const [tl] = await q(`select count(*) filter (where on_list)::int n from staff_target_list where staff_id = $1`, [id])
    console.log(`  tuitions still owned: ${o.n}; cities owned: ${cty.n}; join links active ${lnk.active} of ${lnk.total}; on target list: ${tl.n}`)

    const days = await q(`
      with d as (select generate_series((now() at time zone 'Asia/Karachi')::date - 13, (now() at time zone 'Asia/Karachi')::date, '1 day')::date as dd)
      select d.dd as day,
        (select count(*) from admin_audit_log a where a.actor_id = $1 and a.action = 'member.export' and (a.created_at at time zone 'Asia/Karachi')::date = d.dd)::int exports,
        (select coalesce(sum((a.detail->>'rowCount')::int), 0) from admin_audit_log a where a.actor_id = $1 and a.action = 'member.export' and (a.created_at at time zone 'Asia/Karachi')::date = d.dd)::int export_rows,
        (select count(*) from admin_audit_log a where a.actor_id = $1 and a.action = 'member.contact_reveal' and (a.created_at at time zone 'Asia/Karachi')::date = d.dd)::int phone_show,
        (select count(*) from staff_document_decisions x where x.staff_id = $1 and x.decision = 'approve' and (x.decided_at at time zone 'Asia/Karachi')::date = d.dd)::int doc_approvals,
        (select count(*) from staff_document_decisions x where x.staff_id = $1 and x.decision <> 'approve' and (x.decided_at at time zone 'Asia/Karachi')::date = d.dd)::int doc_rejections,
        (select count(*) from user_activity_log u where u.user_id = $1 and u.event = 'login' and (u.created_at at time zone 'Asia/Karachi')::date = d.dd)::int logins
      from d order by d.dd`, [id])
    console.table(days.map((d) => ({ day: String(d.day).slice(0, 15), exports: d.exports, exportRows: d.export_rows, phoneShow: d.phone_show, docApprovals: d.doc_approvals, docRejections: d.doc_rejections, logins: d.logins })))
    const [after] = await q(`select count(*)::int n from admin_audit_log where actor_id = $1 and created_at > $2`, [id, r.former_staff_at])
    console.log(`  admin actions logged AFTER she left: ${after.n}`)
  }

  // ---------------------------------------------------------------- 2 ----
  const sh = await q(`select p.id, p.role, p.is_suspended, p.suspended_at from profiles p where lower(trim(coalesce(p.full_name,''))) = 'shoaib hassan' or lower(trim(coalesce(p.display_name,''))) = 'shoaib hassan' or lower(trim(coalesce(p.cnic_name,''))) = 'shoaib hassan'`)
  console.log(`\n== 2. Accounts named "Shoaib Hassan": ${sh.length}`)
  for (const r of sh) {
    const id = r.id as string
    const [tp] = await q(`select verified_fee_paid_at is not null fee, verification_status from tutor_profiles where id = $1`, [id])
    const [pay] = await q(`select count(*) filter (where status='approved')::int approved, count(*)::int total from payments where user_id = $1`, [id])
    console.log(`  role ${r.role}; suspended ${r.is_suspended}; fee paid ${tp ? tp.fee : 'n/a'}; verification ${tp?.verification_status ?? 'n/a'}; payments approved ${pay.approved} of ${pay.total}`)
    const flags = await q(`select source, withheld, warning_level, status, recipient_id is not null has_recipient, context, created_at from abuse_flags where subject_id = $1 order by created_at`, [id])
    console.log(`  abuse flags: ${flags.length}`)
    for (const f of flags) {
      const ctx = (f.context ?? {}) as Record<string, unknown>
      let delivered = 'n/a'
      if (f.source === 'message' && ctx.messageId) {
        const [m] = await q(`select withheld_at is not null withheld, read_at is not null read from messages where id = $1`, [ctx.messageId])
        const [n] = await q(`select count(*)::int n from notifications where meta->>'messageId' = $1 or href like '%' || $2 || '%'`, [ctx.messageId, ctx.threadId ?? '__none__'])
        delivered = m ? `message row withheld=${m.withheld}, read by recipient=${m.read}, notifications for thread=${n.n}` : 'message row missing'
      }
      console.log(`   - ${new Date(f.created_at as string).toISOString()} source=${f.source} field=${ctx.field ?? '—'} warning=${f.warning_level} withheld=${f.withheld} status=${f.status} recipient=${f.has_recipient} delivered: ${delivered}`)
    }
    const [msgs] = await q(`select count(*)::int sent, count(*) filter (where withheld_at is null)::int delivered from messages where sender_id = $1`, [id])
    const [team] = await q(`select count(*)::int n from admin_messages where member_id = $1 and direction = 'in'`, [id])
    const [apps] = await q(`select count(*)::int n from applications where tutor_id = $1`, [id])
    const [jobs] = await q(`select count(*)::int n from jobs where parent_id = $1`, [id])
    console.log(`  member messages sent ${msgs.sent} (delivered ${msgs.delivered}); Team inbox replies ${team.n}; applications ${apps.n}; tuitions posted ${jobs.n}`)
    const susp = await q(`select event as event_type, created_at from user_activity_log where user_id = $1 and event in ('suspended','auto_suspended','abuse_auto_suspended') order by created_at`, [id])
    console.log(`  suspension events: ${susp.map((s) => `${s.event_type} ${new Date(s.created_at as string).toISOString()}`).join('; ') || '—'}`)
  }
  await c.end()
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
