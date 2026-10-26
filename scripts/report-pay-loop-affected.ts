/**
 * scripts/report-pay-loop-affected.ts — READ ONLY (owner, 26 Oct 2026).
 *
 * The payment-page loop was the "Your verification" sheet flickering on a
 * MOUSE device (hover), whatever the payment state. This counts:
 *   A. tutors in exactly Samia's state — fee not paid, no payment rows at all,
 *      account usable (not suspended, banned, self-paused, hidden or test);
 *   B. of those, the ones who used TutorMint on a desktop browser in the last
 *      30 days (the device where the flicker happens);
 *   C. every usable tutor with a desktop session in the last 30 days (anyone of
 *      them opening the sheet saw it, paid or not).
 * Prints counts and ids only. Changes nothing.
 *
 *   npx tsx --env-file=.env.local scripts/report-pay-loop-affected.ts [ids-out.txt]
 */
import { writeFileSync } from 'node:fs'
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

const DESKTOP = `(s.user_agent ~* '(windows nt|macintosh|x11|cros)' and s.user_agent !~* '(mobile|android|iphone|ipad)')`

async function main() {
  const out = process.argv[2]
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  try {
    const usable = `p.role = 'tutor' and not coalesce(p.is_suspended,false) and not coalesce(p.is_banned,false)
      and p.paused_by_user_at is null and not coalesce(p.hidden_from_public,false) and not coalesce(p.is_test_name,false)
      and not coalesce(p.is_seed,false) and p.admin_role is null`
    const a = await c.query(
      `select p.id from profiles p join tutor_profiles tp on tp.id = p.id
        where ${usable} and tp.verified_fee_paid_at is null
          and not exists (select 1 from payments pay where pay.user_id = p.id)
        order by p.created_at`,
    )
    const b = await c.query(
      `select p.id from profiles p join tutor_profiles tp on tp.id = p.id
        where ${usable} and tp.verified_fee_paid_at is null
          and not exists (select 1 from payments pay where pay.user_id = p.id)
          and exists (select 1 from activity_sessions s where s.user_id = p.id and s.started_at > now() - interval '30 days' and ${DESKTOP})
        order by p.created_at`,
    )
    const cc = await c.query(
      `select p.id from profiles p
        where ${usable}
          and exists (select 1 from activity_sessions s where s.user_id = p.id and s.started_at > now() - interval '30 days' and ${DESKTOP})
        order by p.created_at`,
    )
    console.log(`A. same state as Samia (unpaid, no payments, usable): ${a.rows.length}`)
    console.log(`B. of those, used a desktop browser in the last 30 days: ${b.rows.length}`)
    console.log(`C. any usable tutor with a desktop session in the last 30 days: ${cc.rows.length}`)
    console.log('B ids:', b.rows.map((r: { id: string }) => r.id).join(', '))
    if (out) {
      writeFileSync(out, [`A (${a.rows.length})`, ...a.rows.map((r: { id: string }) => r.id), '', `B (${b.rows.length})`, ...b.rows.map((r: { id: string }) => r.id), '', `C (${cc.rows.length})`, ...cc.rows.map((r: { id: string }) => r.id)].join('\n'))
      console.log('ids written to', out)
    }
  } finally {
    await c.end()
  }
}
main().catch((e) => { console.error(e); process.exit(1) })
