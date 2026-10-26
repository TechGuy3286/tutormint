import { loadPendingErasure } from '@/lib/accountErase'
import { pendingBannerText } from '@/lib/accountEraseCore'
import CancelEraseButton from '@/components/account/CancelEraseButton'

// The banner on a tutor's or parent's dashboard while their account is set to
// be deleted (owner, 27 Oct 2026): "Your account will be deleted on <date> —
// Cancel". Server component; renders nothing when no deletion is scheduled.

export default async function ErasePendingBanner({ userId }: { userId: string }) {
  const pending = await loadPendingErasure(userId).catch(() => null)
  if (!pending) return null
  return (
    <div role="status" className="mx-auto mt-3 flex max-w-5xl flex-wrap items-center gap-2 rounded-2xl border border-tm-red/30 bg-tm-tint-red px-4 py-3 text-xs font-bold text-tm-red-hover">
      <span>{pendingBannerText(pending.due_at)} —</span>
      <CancelEraseButton />
    </div>
  )
}
