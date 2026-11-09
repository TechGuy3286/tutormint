/**
 * scripts/dataop-check-blank-photos.ts — the one-time "Photo looks blank" check
 * of every tutor's CURRENT profile photo(s) and selfie(s) (owner, 9 Nov 2026).
 * READ-ONLY on the files: each image is downloaded and measured, nothing is
 * changed, moved or rejected. The only writes are rows in photo_blank_checks
 * (migration 225 — apply it first). Re-runnable: a file already checked is
 * skipped. Prints counts only — never a name, number, address or image.
 *
 *   npx tsx --conditions=react-server --env-file=.env.local scripts/dataop-check-blank-photos.ts
 */
import { checkMemberPhotos, blankPhotoFlags } from '../lib/photoBlank'

async function main() {
  const res = await checkMemberPhotos(null)
  console.log(`checked ${res.checked} files · looked blank ${res.blank} · could not read ${res.unreadable}`)
  const flags = await blankPhotoFlags(null)
  let photo = 0
  let selfie = 0
  for (const items of flags.values()) {
    if (items.includes('photo')) photo++
    if (items.includes('selfie')) selfie++
  }
  console.log(`members flagged now: ${flags.size} (profile photo ${photo}, selfie ${selfie})`)
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
