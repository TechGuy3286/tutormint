'use client'

// The admin "WhatsApp" button for a member (owner, 27 Oct 2026). Opens a tab
// in the tap (so no popup blocker), asks /api/admin/whatsapp for the message
// built from the member's state, and points the tab at the shared WhatsApp
// link (lib/waLinkCore — api.whatsapp.com/send, which keeps emoji).
//
// For a PARENT the send is recorded as a follow-up, so the toast offers the
// same 10-second Undo as Follow-ups. Anything the request cannot do falls back
// to the plain server link (GET), which builds and records the same way.

import { useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'

import { adminFetch } from '@/components/admin/adminFetch'
import { useToast } from '@/components/ui/Toast'
import { adminWhatsAppRoute, type WhatsAppFrom } from '@/lib/adminWhatsAppCore'
import { UNDO_MS } from '@/lib/tutorFollowUpTabsCore'

export default function AdminWhatsAppLink({
  memberId,
  from,
  className,
  children,
}: {
  memberId: string
  from: WhatsAppFrom
  className?: string
  children: ReactNode
}) {
  const toast = useToast()
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  const open = async (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault()
    if (busy) return
    const tab = window.open('about:blank', '_blank')
    setBusy(true)
    const { ok, status, data } = await adminFetch<{ href?: string; followUpId?: string | null; error?: string }>('/api/admin/whatsapp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ memberId, from }),
    })
    setBusy(false)
    if (!ok || !data?.href) {
      if (status === 403) {
        // A view-only role: the plain link still opens the chat.
        if (tab) tab.location.href = adminWhatsAppRoute(memberId, from)
        return
      }
      tab?.close()
      toast.error(data?.error ?? 'That did not open. Please try again.')
      return
    }
    if (tab) tab.location.href = data.href
    else window.open(data.href, '_blank')
    const id = data.followUpId
    if (!id) return
    toast.success('WhatsApp opened. Recorded as a follow-up.', {
      label: 'Undo',
      ms: UNDO_MS,
      onClick: () => {
        void adminFetch<{ error?: string }>('/api/admin/follow-ups/parent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'undo', id }),
        }).then(({ ok: done, data: d }) => {
          if (done) {
            toast.success('Follow-up undone.')
            router.refresh()
          } else toast.error(d?.error ?? 'Could not undo.')
        })
      },
    })
    router.refresh()
  }

  return (
    <a href={adminWhatsAppRoute(memberId, from)} onClick={(e) => void open(e)} target="_blank" rel="noopener noreferrer" aria-busy={busy} className={className}>
      {children}
    </a>
  )
}
