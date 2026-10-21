/**
 * scripts/dataop-followups-account-flags.ts — Part D of the Follow-ups PR
 * (owner, 21 Oct 2026). Two test-account flags (profiles.hidden_from_public,
 * migration 126), audited under the Owner:
 *   • Javeria Fiaz's tutor account (c656ab23…) — mark taken OFF, so she shows
 *     and counts as a normal tutor ('member.unhide_public');
 *   • Aqsa Mughal has two tutor accounts on one mobile. The one with no payment
 *     and the least activity (532e5da5…, signed up 14 Sep, 25%) is marked as a
 *     test account ('member.hide_public'); the one with the approved
 *     Verification Fee (d5c10c45…, paid 13 Oct 2026) stays her real account.
 * Every fact is re-checked first; any difference stops the run. Nothing is
 * deleted. Never prints a mobile, email or CNIC number.
 *   npx tsx --env-file=.env.local scripts/dataop-followups-account-flags.ts [--apply]
 */
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

const JAVERIA_TUTOR = 'c656ab23-8de7-4ab0-8d14-1ee843b28294'
const AQSA_TEST = '532e5da5-6780-45d7-89d6-3fdabde3574c'
const AQSA_REAL = 'd5c10c45-0efd-473b-a5f5-5863c2868485'

const last10 = (v: string | null) => {
  const d = (v ?? '').replace(/\D/g, '')
  return d.length >= 10 ? d.slice(-10) : null
}

async function main() {
  const apply = process.argv.includes('--apply')
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  await c.query('begin')
  try {
    const rows = (
      await c.query(
        `select p.id, p.full_name, p.role, p.hidden_from_public, p.phone_number, p.whatsapp,
                (select count(*)::int from payments x where x.user_id = p.id) pays,
                (select max(reviewed_at) from payments x where x.user_id = p.id and x.status = 'approved' and x.plan_code = 'verified') fee_ok_at,
                (select count(*)::int from user_activity_log l where l.user_id = p.id) events
           from profiles p where p.id = any($1)`,
        [[JAVERIA_TUTOR, AQSA_TEST, AQSA_REAL]],
      )
    ).rows as Record<string, unknown>[]
    const by = new Map(rows.map((r) => [r.id as string, r]))
    const j = by.get(JAVERIA_TUTOR)
    const a = by.get(AQSA_TEST)
    const b = by.get(AQSA_REAL)
    const stop = (why: string) => {
      throw new Error(`Stopped: ${why}`)
    }
    if (!j || j.role !== 'tutor' || !/^javeria fiaz$/i.test(String(j.full_name).trim())) stop('Javeria Fiaz tutor account not as reported')
    if (!a || !b || a.role !== 'tutor' || b.role !== 'tutor') stop('Aqsa tutor accounts not as reported')
    if (![a!, b!].every((r) => /^aqsa mughal$/i.test(String(r.full_name).trim()))) stop('Aqsa names differ')
    const ma = [last10(a!.phone_number as string), last10(a!.whatsapp as string)].filter(Boolean)
    const mb = [last10(b!.phone_number as string), last10(b!.whatsapp as string)].filter(Boolean)
    if (!ma.some((x) => mb.includes(x))) stop('the two Aqsa accounts do not share a mobile')
    if ((a!.pays as number) !== 0) stop('the account to mark has a payment')
    const paid = b!.fee_ok_at ? new Date(b!.fee_ok_at as string).toISOString().slice(0, 10) : null
    if (paid !== '2026-10-13') stop('the real account has no approved fee on 13 Oct 2026')
    if ((a!.events as number) >= (b!.events as number)) stop('the account to mark is not the less active one')

    const owner = (await c.query(`select id, email from profiles where role = 'admin' and admin_role = 'owner' limit 1`)).rows[0]
    if (!owner) stop('no Owner account')

    const changes: string[] = []
    if (j!.hidden_from_public) {
      await c.query(`update profiles set hidden_from_public = false where id = $1`, [JAVERIA_TUTOR])
      await c.query(
        `insert into admin_audit_log (actor_id, actor_role, actor_email, action, target_type, target_id, detail)
         values ($1, 'owner', $2, 'member.unhide_public', 'profile', $3, $4)`,
        [owner.id, owner.email, JAVERIA_TUTOR, JSON.stringify({ dataop: 'followups-account-flags', reason: 'Not a test account (owner, 21 Oct 2026)' })],
      )
      changes.push('Javeria Fiaz tutor account: test mark taken off')
    }
    if (!a!.hidden_from_public) {
      await c.query(`update profiles set hidden_from_public = true where id = $1`, [AQSA_TEST])
      await c.query(
        `insert into admin_audit_log (actor_id, actor_role, actor_email, action, target_type, target_id, detail)
         values ($1, 'owner', $2, 'member.hide_public', 'profile', $3, $4)`,
        [owner.id, owner.email, AQSA_TEST, JSON.stringify({ dataop: 'followups-account-flags', reason: 'Second tutor account on the same mobile, no payment (owner, 21 Oct 2026)', keptAccount: AQSA_REAL })],
      )
      changes.push(`Aqsa Mughal ${AQSA_TEST}: marked as a test account (kept ${AQSA_REAL})`)
    }
    console.log(changes.length ? changes.join('\n') : 'nothing to change')
    await c.query(apply ? 'commit' : 'rollback')
    console.log(apply ? 'APPLIED' : 'dry run — rolled back')
  } catch (e) {
    await c.query('rollback')
    throw e
  } finally {
    await c.end()
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
