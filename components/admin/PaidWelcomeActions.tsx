'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, ImageDown, MessageCircle } from 'lucide-react'

import { adminFetch } from '@/components/admin/adminFetch'
import { useAdminReadOnly } from '@/components/admin/ReadOnly'
import { useToast } from '@/components/ui/Toast'
import { formatDate } from '@/lib/datetime'
import { UNDO_MS } from '@/lib/tutorFollowUpTabsCore'
import { welcomedLine, type Welcome } from '@/lib/paidWelcomeCore'

// A paid tutor's People card (owner, 9 Nov 2026):
//   "Send welcome"  opens WhatsApp with the welcome (built on the server, with
//                   the live profile link) and logs who sent it, 10-second Undo.
//                   The card then reads "Welcomed ✓ by <name>, <date>".
//   "Status image"  downloads the 1080×1920 "I'm a Verified Tutor" PNG (the
//                   existing generator) — only when CNIC, photo and selfie are
//                   approved, because the picture carries the Verified badge.

const BTN = 'inline-flex min-h-[40px] flex-1 items-center justify-center gap-1.5 rounded-xl px-2 text-[11px] font-bold'

export default function PaidWelcomeActions({
  memberId,
  welcome,
  badge,
}: {
  memberId: string
  welcome: Welcome | null | undefined
  badge: boolean | undefined
}) {
  const router = useRouter()
  const toast = useToast()
  const readOnly = useAdminReadOnly()
  const [busy, setBusy] = useState(false)

  const undo = async (id: string) => {
    const { ok, data } = await adminFetch<{ error?: string }>('/api/admin/people/welcome', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'undo', id, memberId }),
    })
    if (!ok) return void toast.error(data?.error ?? 'Could not undo that.')
    toast.success('Welcome undone.')
    router.refresh()
  }

  const send = async () => {
    if (busy) return
    // Open the WhatsApp tab inside the tap (a later window.open is blocked).
    const tab = window.open('about:blank', '_blank')
    setBusy(true)
    const { ok, data } = await adminFetch<{ id?: string; waHref?: string; error?: string }>('/api/admin/people/welcome', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'record', memberId }),
    })
    setBusy(false)
    if (!ok || !data?.id || !data.waHref) {
      tab?.close()
      return void toast.error(data?.error ?? 'That did not save. Please try again.')
    }
    if (tab) tab.location.href = data.waHref
    else window.open(data.waHref, '_blank')
    const id = data.id
    router.refresh()
    toast.success('Welcome logged — the card now shows Welcomed ✓', { label: 'Undo', onClick: () => void undo(id), ms: UNDO_MS })
  }

  return (
    <div className="space-y-1.5" data-paid-welcome="">
      {welcome ? (
        <p className="font-semibold text-tm-green-deep" data-welcomed="">
          <Check aria-hidden size={12} className="mr-1 inline" />
          {welcomedLine(welcome, formatDate)}
        </p>
      ) : (
        <p className="font-semibold text-tm-red">Not welcomed yet</p>
      )}
      <div className="flex flex-wrap gap-2">
        {!readOnly && !welcome && (
          <button type="button" disabled={busy} onClick={() => void send()} className={`${BTN} bg-tm-green-deep text-white hover:bg-tm-green-deep-hover disabled:opacity-50`}>
            <MessageCircle aria-hidden size={13} /> {busy ? 'Opening…' : 'Send welcome'}
          </button>
        )}
        {badge && (
          <a
            href={`/api/admin/social/status-image?memberId=${memberId}`}
            download="TutorMint-status.png"
            className={`${BTN} border border-tm-green-deep text-tm-green-deep hover:bg-tm-tint-green`}
          >
            <ImageDown aria-hidden size={13} /> Status image
          </a>
        )}
      </div>
      {!badge && <p className="text-[10px] text-gray-500">Status image: after CNIC, photo and selfie are approved.</p>}
    </div>
  )
}
