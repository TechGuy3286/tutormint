/**
 * scripts/report-removed-staff.ts — read only (owner, 4 Nov 2026). Facts about
 * the accounts the old "Remove from team" left behind: role, created, test /
 * hidden flags, synthetic or real sign-in address (never the address itself).
 *   npx tsx --conditions=react-server --env-file=.env.local scripts/report-removed-staff.ts
 */
import { createAdminClient } from '@/lib/supabase/admin'
import { isSyntheticEmail } from '@/lib/phone'

async function main() {
  const admin = createAdminClient()
  if (!admin) throw new Error('no service role')
  const { data } = await admin
    .from('profiles')
    .select('id, full_name, role, created_at, is_test_name, hidden_from_public, is_seed, email, former_staff_at')
    .in('full_name', ['Admin', 'Alee', 'Inzamam Ullah'])
  for (const p of data ?? []) {
    const { count: links } = await admin.from('staff_join_links').select('*', { count: 'exact', head: true }).eq('staff_id', p.id as string).is('deactivated_at', null)
    const { count: credits } = await admin.from('staff_signup_credits').select('*', { count: 'exact', head: true }).eq('staff_id', p.id as string)
    const { count: owned } = await admin.from('tuition_owners').select('*', { count: 'exact', head: true }).eq('staff_id', p.id as string)
    const { data: cities } = await admin.from('city_owners').select('city').eq('staff_id', p.id as string)
    console.log(
      `${p.full_name} | ${p.id.slice(0, 8)} | role ${p.role} | created ${String(p.created_at).slice(0, 10)} | test ${p.is_test_name} hidden ${p.hidden_from_public} seed ${p.is_seed} | ${isSyntheticEmail(p.email as string) ? 'mobile login' : 'email login'} | former ${p.former_staff_at ?? '-'} | live links ${links} credits ${credits} tuitions ${owned} cities ${(cities ?? []).map((c) => c.city).join(',') || '-'}`,
    )
  }
}
main().then(() => process.exit(0), (e) => { console.error(e instanceof Error ? e.message : 'failed'); process.exit(1) })
