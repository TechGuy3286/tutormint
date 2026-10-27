/**
 * scripts/dataop-fee-autolink.ts — the one-time clean-up of Finance → Needs
 * attention (owner, 27 Oct 2026). Runs the new fee rules (lib/feeMatch
 * runFeeAutoLink) over every free bank credit and links ONLY the safe ones:
 * the amount is in the Fee match range, it is within 48 hours of an approved
 * fee payment that has no credit, and the sender name matches the member.
 * Everything else is listed with the reason. Audited as the Owner with a note.
 *
 * Without --apply it is a dry run: nothing is written.
 * Prints the member's name and the amount (the owner's report), never a
 * phone, email or account number.
 *
 *   npx tsx --conditions=react-server --env-file=.env.local scripts/dataop-fee-autolink.ts [--apply]
 */
import { createAdminClient } from '../lib/supabase/admin'
import { runFeeAutoLink } from '../lib/feeMatch'

const NOTE = "One-time clean-up of Needs attention, 27 Oct 2026, on the Owner's instruction."

async function main() {
  const apply = process.argv.includes('--apply')
  const admin = createAdminClient()
  if (!admin) throw new Error('no service-role client')
  const { data: owner } = await admin.from('profiles').select('id').eq('role', 'admin').eq('admin_role', 'owner').limit(2)
  if (!owner || owner.length !== 1) throw new Error('expected exactly one Owner account')
  const out = await runFeeAutoLink({ id: owner[0].id as string, adminRole: 'owner', email: 'system: fee auto-link clean-up' }, { dryRun: !apply, auditNote: NOTE })
  if (!out) throw new Error('could not load the settlement board')
  console.log(apply ? 'APPLIED' : 'DRY RUN — nothing written')
  console.log(`linked: ${out.linked.length}`)
  for (const l of out.linked) console.log(`  ✓ ${l.memberName ?? 'member'} · Rs ${l.amountPkr} → ${l.paymentRef}${l.rounding > 0 ? ` (Rs ${l.rounding} rounding)` : ''}`)
  console.log(`still needs the Owner: ${out.stillNeeds.length}`)
  for (const s of out.stillNeeds) console.log(`  • Rs ${s.amountPkr} · ${s.date} · ${s.senderName ?? 'sender not recorded'} — ${s.why}`)
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
