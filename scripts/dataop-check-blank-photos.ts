/**
 * scripts/dataop-check-blank-photos.ts — the one-time "Photo looks blank" check
 * of every tutor's CURRENT profile photo(s), selfie(s) and — since 16 Nov 2026
 * — CNIC front and back images (pending and approved).
 * READ-ONLY on the files: each image is downloaded and measured, nothing is
 * changed, moved or rejected. The only writes are rows in photo_blank_checks
 * (migrations 225, 232 — apply them first). Re-runnable: a file already
 * checked is skipped. Prints counts only — never a name, number, address or
 * image.
 *
 *   npx tsx --conditions=react-server --env-file=.env.local scripts/dataop-check-blank-photos.ts
 */
import { checkMemberPhotos, blankPhotoFlags } from '../lib/photoBlank'
import { createAdminClient } from '../lib/supabase/admin'
import { pageAllIn } from '../lib/pageAll'

async function main() {
  const res = await checkMemberPhotos(null)
  console.log(`checked ${res.checked} files · looked blank ${res.blank} · could not read ${res.unreadable}`)
  console.log(`CNIC images: checked ${res.cnic.checked} · looked blank ${res.cnic.blank} · could not read ${res.cnic.unreadable}`)
  const flags = await blankPhotoFlags(null)
  let photo = 0
  let selfie = 0
  const cnicMembers: string[] = []
  for (const [id, items] of flags) {
    if (items.includes('photo')) photo++
    if (items.includes('selfie')) selfie++
    if (items.includes('cnic')) cnicMembers.push(id)
  }
  console.log(`members flagged now: ${flags.size} (profile photo ${photo}, selfie ${selfie}, CNIC ${cnicMembers.length})`)

  // All CNIC images ever flagged (cleared or not), and how many of those
  // flagged now belong to an already-approved CNIC — counts only.
  const admin = createAdminClient()
  if (admin) {
    const { count } = await admin.from('photo_blank_checks').select('id', { count: 'exact', head: true }).eq('item', 'cnic')
    const { count: blankCount } = await admin.from('photo_blank_checks').select('id', { count: 'exact', head: true }).eq('item', 'cnic').eq('blank', true)
    const approved = cnicMembers.length
      ? (await pageAllIn(cnicMembers, (part, from, to) => admin.from('profiles').select('id').in('id', part).not('cnic_verified_at', 'is', null).order('id').range(from, to))).length
      : 0
    console.log(`CNIC rows on record: ${count ?? 0} · blank ${blankCount ?? 0}`)
    console.log(`members flagged for CNIC whose CNIC is already approved: ${approved}`)
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
