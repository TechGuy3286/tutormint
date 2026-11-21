'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, MessageCircle, Undo2 } from 'lucide-react'

import { adminFetch } from '@/components/admin/adminFetch'
import { useAdminReadOnly } from '@/components/admin/ReadOnly'
import { useToast } from '@/components/ui/Toast'
import { UNDO_MS } from '@/lib/tutorFollowUpTabsCore'

// One row on People → WhatsApp updates (PR-06, owner 18 Nov 2026).
//   Send  opens WhatsApp with the ready message (built on the server — the
//         tutor's number never reaches this page) and logs who sent it and
//         when. A 10-second Undo in the toast; the row then reads "Sent by …"
//         with an Undo for the sender for the rest of the day.

export type WaRowView = {
  tutorId: string
  name: string
  city: string | null
  state: 'to_send' | 'sent_today'
  message: string
  weekCount: number
  kinds: string[]
  sent: { id: string; by: string | null; time: string; mine: boolean } | null
  /** PR-08: an unpaid tutor's row and its priority. */
  unpaid?: boolean
  priority?: 1 | 2 | 3 | null
  /** PR-14: a "Featured — matched tuitions" item — Send/Undo act on the item
   *  and it is not counted in the weekly limit. */
  featuredItemId?: string
  /** PR-14: who the row is assigned to (the city owner, else the Owner). */
  assignee?: string | null
}

const KIND_LABEL: Record<string, string> = {
  application_opened: 'Application opened',
  application_forwarded: 'Sent to the parent',
  weekly_summary: 'Weekly summary',
  parent_interest: 'Parents interested',
  profile_views: 'Profile views',
  featured_matches: 'Featured — matched tuitions',
}

const BTN = 'inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl px-4 text-xs font-bold'

export default function WaUpdateRow({ row, cap }: { row: WaRowView; cap: number }) {
  const router = useRouter()
  const toast = useToast()
  const readOnly = useAdminReadOnly()
  const [busy, setBusy] = useState(false)

  const undo = async (id: string) => {
    const { ok, data } = await adminFetch<{ error?: string }>('/api/admin/whatsapp-updates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(row.featuredItemId ? { action: 'featured_undo', itemId: row.featuredItemId } : { action: 'undo', id }),
    })
    if (!ok) return void toast.error(data?.error ?? 'Could not undo that.')
    toast.success('Send undone. The tutor is back in today’s list.')
    router.refresh()
  }

  const send = async () => {
    if (busy) return
    // Open the WhatsApp tab inside the tap (a later window.open is blocked).
    const tab = window.open('about:blank', '_blank')
    setBusy(true)
    const { ok, data } = await adminFetch<{ id?: string; waHref?: string; error?: string }>('/api/admin/whatsapp-updates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(row.featuredItemId ? { action: 'featured_send', itemId: row.featuredItemId } : { action: 'send', tutorId: row.tutorId }),
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
    toast.success('Sent — logged with your name.', { label: 'Undo', onClick: () => void undo(id), ms: UNDO_MS })
  }

  const sent = row.state === 'sent_today'

  return (
    <div className={`space-y-2 rounded-2xl border p-3 ${sent ? 'border-gray-200 bg-tm-bg' : 'border-gray-200 bg-white'}`} data-wa-row="">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <a href={`/admin/users/${row.tutorId}/activity?from=/admin/whatsapp-updates`} className="text-sm font-black text-tm-navy hover:underline">
            {row.name}
          </a>
          <p className="text-[11px] text-gray-600">
            {row.city ?? 'No city'} · {row.featuredItemId ? 'not counted in the weekly limit' : `${row.weekCount} of ${cap} this week`}
            {row.assignee ? ` · For ${row.assignee}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap gap-1">
          {row.unpaid && (
            <span className="rounded-full bg-tm-tint-red px-2 py-0.5 text-[10px] font-bold text-tm-red">Unpaid{row.priority ? ` · priority ${row.priority}` : ''}</span>
          )}
          {row.kinds.map((k) => (
            <span key={k} className="rounded-full bg-tm-tint-navy px-2 py-0.5 text-[10px] font-bold text-tm-navy">
              {KIND_LABEL[k] ?? k}
            </span>
          ))}
        </div>
      </div>

      {sent && row.sent ? (
        <p className="flex flex-wrap items-center gap-x-2 text-xs font-semibold text-tm-green-deep">
          <span>
            <Check aria-hidden size={12} className="mr-1 inline" />
            Sent{row.sent.by ? ` by ${row.sent.by}` : ''} at {row.sent.time}
          </span>
          {row.sent.mine && !readOnly && (
            <button type="button" onClick={() => void undo(row.sent!.id)} className="inline-flex min-h-[44px] items-center gap-1 font-bold text-tm-navy underline">
              <Undo2 aria-hidden size={12} /> Undo
            </button>
          )}
        </p>
      ) : (
        <>
          <pre className="whitespace-pre-wrap break-words rounded-xl bg-tm-bg p-3 font-sans text-xs leading-relaxed text-slate-800">{row.message}</pre>
          {!readOnly && (
            <div className="flex justify-end">
              <button type="button" disabled={busy} onClick={() => void send()} className={`${BTN} bg-tm-green-deep text-white hover:bg-tm-green-deep-hover disabled:opacity-50`}>
                <MessageCircle aria-hidden size={14} /> {busy ? 'Opening…' : 'Send'}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
