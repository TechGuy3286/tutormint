import Avatar from '@/components/Avatar'
import { avatarTint } from '@/lib/brand'

// The face beside a profile-view teaser.
//
// Identified (Premium and up): the parent's real picture, or their initials on
// a brand tint when they have none — the same Avatar every other surface uses,
// so a parent looks like themselves everywhere.
//
// Not identified (free): a blurred disc that IS NOT THE PARENT'S PHOTOGRAPH.
// The brief asked for the photo blurred and unblurring on upgrade; rendering
// the real image behind a CSS filter would put its URL in the DOM, and avatars
// are public files that appear on every job card — so the "blur" would be one
// devtools panel deep, and the thing Premium sells would be free.
//
// The disc is seeded from the VIEW row, not the viewer, so a tutor cannot even
// tell that two views came from the same person by comparing colours. It reads
// as "somebody real, out of focus", which is what the teaser is for, and it
// becomes the actual photograph the moment the plan grants identity.

export default function ViewerFace({
  identified,
  name,
  avatarUrl,
  seed,
}: {
  identified: boolean
  name: string
  avatarUrl: string | null
  /** The view row's id — never the viewer's. */
  seed: string
}) {
  if (identified) {
    return (
      <Avatar
        name={name}
        src={avatarUrl}
        seed={seed}
        decorative
        ring="border border-gray-200"
        className="h-8 w-8 shrink-0 text-[10px]"
      />
    )
  }

  // Deterministic so the list does not reshuffle colours on every render, and
  // meaningless so the colour says nothing about who it is. The tint sets both
  // the ground and currentColor, which is what the blobs are drawn in — one
  // brand pair, no new colours.
  const tint = avatarTint(seed)

  return (
    <span
      aria-hidden
      // inline-BLOCK, not a bare span. Width and height do not apply to an
      // inline box, and this rendered 2px wide the moment it stopped being a
      // direct flex child — which is exactly what happened when the teaser
      // became a stack of discs rather than a list of rows.
      className={`relative inline-block h-8 w-8 shrink-0 overflow-hidden rounded-full border border-gray-200 align-middle ${tint.className}`}
    >
      {/* Two soft shapes under a blur: it reads as an out-of-focus face
          without ever having been one. */}
      <span className="absolute left-1/2 top-1 h-3 w-3 -translate-x-1/2 rounded-full bg-current opacity-40 blur-[3px]" />
      <span className="absolute left-1/2 top-4 h-4 w-6 -translate-x-1/2 rounded-full bg-current opacity-40 blur-[3px]" />
    </span>
  )
}
