/**
 * scripts/dataop-merge-gulshan.ts (owner, 16 Oct 2026). Merges the Karachi area
 * "Gulshan" into "Gulshan-e-Iqbal", exactly as the Owner's merges on Locations →
 * Review added areas do (lib/locationRunReview mergeArea): the name "Gulshan" is
 * saved as a spelling of Gulshan-e-Iqbal, its own spellings follow, and the
 * Gulshan row is RETIRED (removed_at) — nothing deleted, no tuition or profile
 * text changed. Audited under the Owner as done by this PR on the Owner's
 * instruction, and recorded in location_run_reviews.
 *
 *   npx tsx --conditions=react-server --env-file=.env.local scripts/dataop-merge-gulshan.ts            (dry run)
 *   npx tsx --conditions=react-server --env-file=.env.local scripts/dataop-merge-gulshan.ts --apply
 */
import { createAdminClient } from '../lib/supabase/admin'
import { mark, mergeArea } from '../lib/locationRunReview'

const APPLY = process.argv.includes('--apply')
const VIA = 'Locations follow-ups PR (16 Oct 2026), on the Owner’s instruction'

async function main() {
  const admin = createAdminClient()!
  const { data: city } = await admin.from('location_cities').select('id, name').ilike('name', 'karachi').single()
  const live = async (name: string) => {
    const { data } = await admin.from('location_areas').select('id, name, city_id, removed_at').eq('city_id', city!.id).ilike('name', name)
    return (data ?? []).filter((r) => !r.removed_at)
  }
  const from = await live('Gulshan')
  const into = await live('Gulshan-e-Iqbal')
  if (from.length !== 1 || into.length !== 1) {
    console.log('Stopped: expected exactly one live "Gulshan" and one live "Gulshan-e-Iqbal" in Karachi.', { from, into })
    process.exit(1)
  }
  const { data: owner } = await admin.from('profiles').select('id, email').eq('role', 'admin').eq('admin_role', 'owner').single()
  if (!owner) throw new Error('No owner account.')
  const { data: spell } = await admin.from('location_area_aliases').select('raw').eq('area_id', from[0].id).is('removed_at', null)
  console.log(`Merge "${from[0].name}" (#${from[0].id}) into "${into[0].name}" (#${into[0].id}); its spellings that follow: ${(spell ?? []).map((s) => s.raw).join(', ') || 'none'}`)
  if (!APPLY) {
    console.log('Dry run — nothing written. Re-run with --apply.')
    return
  }
  const actor = { id: owner.id as string, adminRole: 'owner' as const, email: (owner.email as string) ?? null }
  const ok = await mergeArea(admin, from[0], into[0], actor, { via: VIA, onOwnerInstruction: true })
  if (!ok) throw new Error('The merge did not save.')
  await mark(admin, 'area', from[0].id, 'merge', actor, { name: from[0].name, into: into[0].name, intoAreaId: into[0].id, via: VIA })
  console.log('Merged. Gulshan is retired and counts as Gulshan-e-Iqbal.')
}
main().then(
  () => process.exit(0),
  (e) => {
    console.error(e)
    process.exit(1)
  },
)
