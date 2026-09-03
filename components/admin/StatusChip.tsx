import { statusLabel } from '@/lib/display'

// One status chip for every admin list.
//
// WHY IT IS SHARED. Before this, "pending" was a gold pill on the payments
// queue, an amber-bordered word on the tutor queue and plain grey text on the
// member directory -- three renderings of one state, so a moderator working
// two screens had to learn the colour twice. The tints are the ones CLAUDE.md
// already assigns: green for a state that is settled and good, gold for one
// waiting on a human, red for one that is closed against the member.
//
// EACH TINT CARRIES INK FROM ITS OWN FAMILY, which is what makes the pairs
// clear AA -- tm-green-deep on tint-green, tm-gold-ink on tint-gold, tm-red on
// tint-red. Gold itself is never the text; that is the whole reason
// tm-gold-ink exists.
//
// COLOUR IS NEVER THE ONLY CHANNEL: the chip always carries its word. The tint
// is there to make a queue scannable, not to encode anything a reader would
// otherwise be unable to find out.

export type ChipTone = 'good' | 'pending' | 'bad' | 'info' | 'neutral'

const TONE: Record<ChipTone, string> = {
  good: 'bg-tm-tint-green text-tm-green-deep',
  pending: 'bg-tm-tint-gold text-tm-gold-ink',
  bad: 'bg-tm-tint-red text-tm-red',
  info: 'bg-tm-tint-navy text-tm-navy',
  neutral: 'bg-slate-100 text-slate-700',
}

/**
 * The tone for a stored status value.
 *
 * TOTAL by design, like lib/display.ts: a status added by a later migration
 * gets the neutral chip and its own name, rather than disappearing from the
 * row or throwing. An unrecognised state should look unfamiliar, not absent.
 */
export function statusTone(value: string | null | undefined): ChipTone {
  switch ((value ?? '').toLowerCase()) {
    case 'approved':
    case 'active':
    case 'verified':
    case 'hired':
    case 'shortlisted':
    case 'claimed':
      return 'good'
    case 'pending':
    case 'submitted':
    case 'uploaded':
    case 'open':
    case 'applied':
    case 'requested':
      return 'pending'
    case 'suspended':
    case 'rejected':
    case 'expired':
    case 'cancelled':
    case 'blocked':
      return 'bad'
    case 'closed':
    case 'resolved':
    case 'actioned':
      return 'info'
    default:
      return 'neutral'
  }
}

export default function StatusChip({
  status,
  tone,
  label,
}: {
  status: string | null | undefined
  /** Overrides the mapping when a screen means something the word does not. */
  tone?: ChipTone
  /** Overrides the wording; the default title-cases the stored value. */
  label?: string
}) {
  if (!status && !label) return null
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-wide ${
        TONE[tone ?? statusTone(status)]
      }`}
    >
      {label ?? statusLabel(status)}
    </span>
  )
}
