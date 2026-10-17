/**
 * scripts/dataop-close-stale-checkouts.ts — the "payment in progress" banner
 * clean-up (owner, 17 Oct 2026).
 *
 * Read-only without --apply: lists every member the OLD banner showed (it
 * showed the member's newest pending payment, whatever it was), what the new
 * rule (lib/paymentBannerCore) says about it, and counts by audience and
 * reason. With --apply it MARKS every pending, receipt-less, not-refunded
 * checkout that the rule says can no longer be paid: checkout_closed_at = now,
 * checkout_close_reason = the reason. Nothing is deleted; status is unchanged;
 * an approved, rejected or refunded payment, and a receipt waiting for
 * approval, are never touched (the UPDATE repeats those conditions). One
 * admin_audit_log row records the run.
 *
 * Members are named by first name and the start of their id only.
 *   npx tsx --env-file=.env.local scripts/dataop-close-stale-checkouts.ts [--who=<first name>] [--apply]
 */
// @ts-expect-error pg ships no bundled types
import pg from 'pg'
import { checkoutProblem, closeReasonFor, type BannerPayment, type BannerPlan, type Holdings } from '../lib/paymentBannerCore'

const OWNER_EMAIL = 'techguy3286@gmail.com'

async function main() {
  const apply = process.argv.includes('--apply')
  const who = process.argv.find((a) => a.startsWith('--who='))?.slice(6).toLowerCase() ?? null
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  try {
    const hasClosed =
      (await c.query(`select 1 from information_schema.columns where table_name='payments' and column_name='checkout_closed_at'`)).rowCount > 0
    if (apply && !hasClosed) throw new Error('migration 185 is not applied')
    const now = Date.now()
    const plans = new Map<string, BannerPlan>(
      (await c.query(`select code, name, audience, price_pkr from plans`)).rows.map((r: Record<string, unknown>) => [
        r.code as string,
        { code: r.code as string, name: r.name as string, audience: r.audience as string, pricePkr: Number(r.price_pkr) },
      ]),
    )
    const pend = (
      await c.query(
        `select p.id, p.user_id, p.plan_code, p.status, p.created_at, p.provider, p.provider_ref, p.amount_pkr,
                p.method, p.screenshot_path, p.reference, p.refunded_at, ${hasClosed ? 'p.checkout_closed_at' : 'null::timestamptz'} closed_at,
                pr.role, pr.full_name, tp.verified_fee_paid_at
           from payments p
           left join profiles pr on pr.id = p.user_id
           left join tutor_profiles tp on tp.id = p.user_id
          where p.status = 'pending'
          order by p.created_at desc`,
      )
    ).rows
    const userIds = [...new Set(pend.map((r: { user_id: string | null }) => r.user_id).filter(Boolean))] as string[]
    const approved = userIds.length
      ? (
          await c.query(
            `select user_id, plan_code, coalesce(reviewed_at, created_at) at from payments
              where status='approved' and refunded_at is null and user_id = any($1)`,
            [userIds],
          )
        ).rows
      : []
    const subs = userIds.length
      ? (
          await c.query(
            `select user_id, plan_code from subscriptions where status='active' and (expires_at is null or expires_at > now()) and user_id = any($1)`,
            [userIds],
          )
        ).rows
      : []

    const hold = new Map<string, Holdings>()
    const rowsBy = new Map<string, BannerPayment[]>()
    const meta = new Map<string, { role: string | null; first: string }>()
    const toClose: { id: string; reason: string }[] = []
    const noAccount: string[] = []
    for (const r of pend) {
      const p: BannerPayment = {
        id: r.id,
        planCode: r.plan_code,
        status: r.status,
        createdAt: new Date(r.created_at).toISOString(),
        provider: r.provider,
        providerRef: r.provider_ref,
        hasReceipt: !!r.screenshot_path || !!(r.reference ?? '').trim(),
        refundedAt: r.refunded_at,
        closedAt: r.closed_at,
      }
      if (!r.user_id) {
        noAccount.push(r.id)
        continue
      }
      if (!hold.has(r.user_id)) {
        hold.set(r.user_id, {
          audience: r.role === 'tutor' ? 'tutor' : 'parent',
          feePaid: !!r.verified_fee_paid_at,
          activePlans: subs.filter((s: { user_id: string }) => s.user_id === r.user_id).map((s: { plan_code: string }) => s.plan_code),
          approved: approved
            .filter((a: { user_id: string }) => a.user_id === r.user_id)
            .map((a: { plan_code: string; at: Date }) => ({ planCode: a.plan_code, at: new Date(a.at).toISOString() })),
        })
        meta.set(r.user_id, { role: r.role, first: String(r.full_name ?? '').trim().split(/\s+/)[0] || '(no name)' })
        rowsBy.set(r.user_id, [])
      }
      rowsBy.get(r.user_id)!.push(p)
      const reason = closeReasonFor(checkoutProblem(p, hold.get(r.user_id)!, plans, now))
      if (reason && !p.closedAt) toClose.push({ id: p.id, reason })
    }

    // What the OLD banner showed each member: their newest pending row.
    const counts: Record<string, Record<string, number>> = { tutor: {}, parent: {}, other: {} }
    for (const [uid, rows] of rowsBy) {
      const m = meta.get(uid)!
      const newest = rows[0]
      const h = hold.get(uid)!
      const prob = checkoutProblem(newest, h, plans, now)
      const verdict = prob === null ? 'ok (still payable)' : prob === 'receipt' ? 'receipt waiting (new message)' : `WRONG: ${prob}`
      const aud = m.role === 'tutor' ? 'tutor' : m.role === 'parent' ? 'parent' : 'other'
      if (prob !== null && prob !== 'receipt') counts[aud][prob] = (counts[aud][prob] ?? 0) + 1
      if (!who || m.first.toLowerCase() === who) {
        const r = pend.find((x: { id: string }) => x.id === newest.id)
        const ageH = Math.round((now - Date.parse(newest.createdAt)) / 36e5)
        console.log(
          `${m.first} ${uid.slice(0, 8)} [${m.role}] feePaid=${h.feePaid} plans=${h.activePlans.join('/') || '-'} | ` +
            `newest pending ${newest.id.slice(0, 8)} plan=${newest.planCode} Rs ${r.amount_pkr} provider=${newest.provider} method=${r.method ?? '-'} ` +
            `created=${newest.createdAt} (${ageH}h) receipt=${newest.hasReceipt} pendingRows=${rows.length} → ${verdict}`,
        )
      }
    }
    console.log('\nMembers the old banner showed wrongly, by audience and reason:')
    console.log(JSON.stringify(counts, null, 2))
    const byReason: Record<string, number> = {}
    for (const t of toClose) byReason[t.reason] = (byReason[t.reason] ?? 0) + 1
    console.log(`checkout rows to mark: ${toClose.length}`, byReason)
    console.log(`pending rows with no account (left as they are): ${noAccount.length}`)

    if (!apply) {
      console.log('\nread-only — nothing written (pass --apply to mark)')
      return
    }
    await c.query('begin')
    let marked = 0
    for (const t of toClose) {
      const res = await c.query(
        `update payments set checkout_closed_at = now(), checkout_close_reason = $2
          where id = $1 and status = 'pending' and refunded_at is null and checkout_closed_at is null
            and screenshot_path is null and coalesce(btrim(reference), '') = ''`,
        [t.id, t.reason],
      )
      marked += res.rowCount
    }
    const owner = (await c.query(`select id from profiles where email = $1`, [OWNER_EMAIL])).rows[0]?.id ?? null
    await c.query(
      `insert into admin_audit_log (actor_id, actor_email, actor_role, action, target_type, target_id, detail)
       values ($1, 'system: payment banner clean-up', 'owner', 'payment.checkout_close', 'payment', null, $2)`,
      [owner, JSON.stringify({ marked, byReason, dataop: 'close-stale-checkouts' })],
    )
    await c.query('commit')
    console.log(`\nAPPLIED — ${marked} checkout rows marked`)
  } finally {
    await c.end()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
