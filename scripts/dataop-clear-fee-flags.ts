/**
 * scripts/dataop-clear-fee-flags.ts  (PR106-H3 §1.2, owner-approved)
 *
 * Clear the one-time verification-fee flag (tutor_profiles.verified_fee_paid_at)
 * for two NON-seed tutors who hold it with NO real payment: Javeria Fayaz and
 * Bilal Ahmad. Their Verified badge and the fee-derived free plan disappear
 * (computeEntitlements and the directory views key on this column); nothing else
 * is touched, no data is deleted.
 *
 * (Ali Raza is a SEED account, removed by dataop-remove-seed-accounts — there is
 * no separate non-seed Ali Raza holding the flag, so only these two apply.)
 *
 * Each change is recorded in the member's history (user_activity_log) and the
 * admin audit log: "Test fee flag cleared at owner request".
 *
 *   npx tsx scripts/dataop-clear-fee-flags.ts            # dry run
 *   npx tsx scripts/dataop-clear-fee-flags.ts --apply    # write
 */
import { createClient } from '@supabase/supabase-js'

const APPLY = process.argv.includes('--apply')
const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) { console.error('NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY required'); process.exit(1) }

const TARGETS = [
  { id: '3efabf4b-13d5-411d-8152-c87b6676c3ff', name: 'Javeria Fayaz' },
  { id: '3f2710e4-842a-4900-831c-0b2cac69455e', name: 'Bilal Ahmad' },
]
const NOTE = 'Test fee flag cleared at owner request'

async function main() {
  const admin = createClient(url!, key!, { auth: { persistSession: false } })
  for (const t of TARGETS) {
    const { data: tp } = await admin
      .from('tutor_profiles')
      .select('id, verified_fee_paid_at')
      .eq('id', t.id)
      .maybeSingle()
    // Guard: must be a real account with the fee flag and NO approved payment.
    const { count: approved } = await admin
      .from('payments')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', t.id)
      .eq('status', 'approved')
    const { data: p } = await admin.from('profiles').select('is_seed').eq('id', t.id).maybeSingle()

    console.log(`${t.name} (${t.id}): fee_at=${tp?.verified_fee_paid_at ?? '-'} approved_payments=${approved ?? 0} is_seed=${p?.is_seed ?? '-'}`)
    if (!tp) { console.log('  not found — skip'); continue }
    if (p?.is_seed) { console.log('  is a seed account — skip (handled by seed removal)'); continue }
    if ((approved ?? 0) > 0) { console.log('  has an approved payment — SKIP (do not clear a paid fee)'); continue }
    if (!tp.verified_fee_paid_at) { console.log('  no fee flag — nothing to clear'); continue }
    if (!APPLY) { console.log('  would clear the fee flag.'); continue }

    const { error } = await admin.from('tutor_profiles').update({ verified_fee_paid_at: null }).eq('id', t.id)
    if (error) { console.log(`  ERROR: ${error.message}`); continue }
    await admin.from('user_activity_log').insert({
      user_id: t.id, event: 'fee_flag_cleared', target_type: 'tutor_profile', target_id: t.id, meta: { note: NOTE },
    })
    await admin.from('admin_audit_log').insert({
      actor_id: null, actor_email: 'data-op', actor_role: 'owner',
      action: 'settings.update', target_type: 'tutor_profile', target_id: t.id,
      detail: { note: NOTE, field: 'verified_fee_paid_at', date: new Date().toISOString().slice(0, 10) },
    })
    console.log('  CLEARED + logged.')
  }
  console.log(APPLY ? '\nDONE.' : '\n(dry run — no changes.)')
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1) })
