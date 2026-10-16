/**
 * scripts/report-zubia-signups.ts — READ ONLY (owner, 16 Oct 2026). For one
 * staff member (default Zubia Bashir): My sign-ups rows (all time) against the
 * Team activity month numbers.
 *   npx tsx --conditions=react-server --env-file=.env.local scripts/report-zubia-signups.ts [name]
 */
import { createAdminClient } from '../lib/supabase/admin'
import { loadCreditedAccounts } from '../lib/staffSignups'
import { loadMySignups } from '../lib/mySignups'
import { loadTargetBoard } from '../lib/staffTargets'
import { monthKeyOf } from '../lib/staffTargetsCore'
import { myMonthView } from '../lib/mySignupsCore'

async function main() {
  const who = process.argv[2] ?? 'Zubia Bashir'
  const admin = createAdminClient()!
  const { data: staff } = await admin.from('profiles').select('id, full_name').eq('role', 'admin').ilike('full_name', who).single()
  if (!staff) throw new Error(`No staff named ${who}`)
  const now = Date.now()
  const month = monthKeyOf(now)
  const all = await loadCreditedAccounts()
  const mine = all.filter((a) => a.staffId === staff.id)
  const rows = await loadMySignups(staff.id, all)
  const board = await loadTargetBoard({ id: '00000000-0000-0000-0000-000000000000', adminRole: 'owner' }, month, now)
  const ip = board.inProgress.find((r) => r.staffId === staff.id)
  const card = board.cards?.find?.((c: { staffId: string }) => c.staffId === staff.id)
  console.log(`${staff.full_name} — month ${month}`)
  console.log(`My sign-ups rows (all time): ${rows.length} (credited ${rows.filter((r) => r.kind === 'credit').length}, claims ${rows.filter((r) => r.kind === 'claim').length})`)
  console.log(`credited accounts: ${mine.length}; signed up this month: ${mine.filter((a) => a.at.signed_up && monthKeyOf(Date.parse(a.at.signed_up)) === month).length}`)
  console.log('Team activity in progress:', JSON.stringify(ip))
  console.log('Team activity card paid:', JSON.stringify(card ? { paid: (card as { pace?: { paid: number } }).pace?.paid } : null))
  const v = myMonthView(mine, month)
  const { filterRows, EMPTY_FILTERS } = await import('../lib/mySignupsCore')
  console.log('My sign-ups filter "This month":', filterRows(rows, { ...EMPTY_FILTERS, month: 'this' }, now).length, '· Any time:', rows.length)
  console.log('My sign-ups "This month" view:', JSON.stringify({ count: v.count, inProgress: v.inProgress, paid: v.paid }))
}
main().then(
  () => process.exit(0),
  (e) => {
    console.error(e)
    process.exit(1)
  },
)
