'use client'

import { useState } from 'react'
import { ImageDown } from 'lucide-react'
import { adminFetch } from '@/components/admin/adminFetch'
import { useToast } from '@/components/ui/Toast'
import { useAdminReadOnly } from '@/components/admin/ReadOnly'
import { STATUS_ATTACH_HINT, statusImageFileName } from '@/lib/social/statusImageCore'

// "Send status image" (owner, 26 Oct 2026) — on a tutor's admin page and their
// Paid tutors row. One tap: the "I'm a Verified Tutor" Story PNG downloads,
// WhatsApp opens to the tutor with the message (no link in it), the hint says
// to attach the image, and a follow-up is recorded with a 10-second Undo.
// Only shown for a tutor with the Verified badge (the server checks again).

export default function SendStatusImageButton({
  memberId,
  name,
  imageKey,
  compact = false,
}: {
  memberId: string
  name: string
  /** The image's live version key (lib/social/imageVersionCore). */
  imageKey: string
  compact?: boolean
}) {
  const toast = useToast()
  const readOnly = useAdminReadOnly()
  const [busy, setBusy] = useState(false)
  if (readOnly) return null

  async function send() {
    // Open the WhatsApp tab inside the tap (a later window.open is blocked).
    const tab = window.open('about:blank', '_blank')
    setBusy(true)
    try {
      const img = await fetch(`/api/admin/social/status-image?memberId=${memberId}&k=${encodeURIComponent(imageKey)}`)
      if (!img.ok) {
        tab?.close()
        toast.error((await img.text().catch(() => '')) || 'The image did not load. Please try again.')
        return
      }
      const blob = await img.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = statusImageFileName(name)
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 30_000)

      const { ok, data } = await adminFetch<{ id?: string; waHref?: string; error?: string }>('/api/admin/follow-ups/status-image', {
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
      toast.success(`${STATUS_ATTACH_HINT}.`, {
        label: 'Undo',
        ms: 10_000,
        onClick: () => {
          void adminFetch('/api/admin/follow-ups/status-image', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'undo', id }),
          }).then(({ ok: undone, data: d }) =>
            undone ? toast.success('Follow-up undone.') : toast.error((d as { error?: string })?.error ?? 'Could not undo.'),
          )
        },
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <span className="inline-flex flex-col gap-0.5">
      <button
        type="button"
        disabled={busy}
        onClick={() => void send()}
        data-send-status-image=""
        className={`inline-flex items-center gap-1.5 rounded-lg border border-tm-green-deep bg-white font-bold text-tm-green-deep hover:bg-tm-tint-green disabled:opacity-50 ${
          compact ? 'min-h-[36px] px-2.5 text-[11px]' : 'min-h-[40px] px-3 text-xs'
        }`}
      >
        <ImageDown aria-hidden size={14} />
        {busy ? 'Preparing…' : 'Send status image'}
      </button>
      {!compact && <span className="text-[10px] text-gray-500">{STATUS_ATTACH_HINT}</span>}
    </span>
  )
}
