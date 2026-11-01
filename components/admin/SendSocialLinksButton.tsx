'use client'

import { useRef, useState } from 'react'
import { Share2 } from 'lucide-react'
import { adminFetch } from '@/components/admin/adminFetch'
import { useToast } from '@/components/ui/Toast'
import { useAdminReadOnly } from '@/components/admin/ReadOnly'

// "Send social links" (owner, 31 Oct 2026) — beside "Send status image" on a
// paid tutor's member page. One tap: WhatsApp opens to the tutor with the
// social_links message (one line per TutorMint social page that is set, each
// with the sender's ref code where the platform allows), and a follow-up is
// recorded with a 10-second Undo. The server checks the tutor has paid.

export default function SendSocialLinksButton({ memberId }: { memberId: string }) {
  const toast = useToast()
  const readOnly = useAdminReadOnly()
  const [busy, setBusy] = useState(false)
  const inFlight = useRef(false)
  if (readOnly) return null

  async function send() {
    if (inFlight.current) return
    inFlight.current = true
    // Open the WhatsApp tab inside the tap (a later window.open is blocked).
    const tab = window.open('about:blank', '_blank')
    setBusy(true)
    try {
      const { ok, data } = await adminFetch<{ id?: string; waHref?: string; error?: string }>('/api/admin/follow-ups/social-links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'record', memberId }),
      })
      if (!ok || !data?.waHref || !data.id) {
        tab?.close()
        toast.error(data?.error ?? 'That did not save. Please try again.')
        return
      }
      if (tab) tab.location.href = data.waHref
      else window.open(data.waHref, '_blank')
      const id = data.id
      toast.success('Social links ready in WhatsApp.', {
        label: 'Undo',
        ms: 10_000,
        onClick: () => {
          void adminFetch('/api/admin/follow-ups/social-links', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'undo', id }),
          }).then(({ ok: undone, data: d }) =>
            undone ? toast.success('Follow-up undone.') : toast.error((d as { error?: string })?.error ?? 'Could not undo.'),
          )
        },
      })
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }

  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => void send()}
      data-send-social-links=""
      className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-tm-navy bg-white px-3 text-xs font-bold text-tm-navy hover:bg-tm-tint-navy disabled:opacity-50"
    >
      <Share2 aria-hidden size={14} />
      {busy ? 'Preparing…' : 'Send social links'}
    </button>
  )
}
