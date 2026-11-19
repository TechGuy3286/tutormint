'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, ChevronDown, MessageCircle, Undo2 } from 'lucide-react'

import { adminFetch } from '@/components/admin/adminFetch'
import { useAdminReadOnly } from '@/components/admin/ReadOnly'
import MaskedContact from '@/components/admin/MaskedContact'
import TimeAgo from '@/components/TimeAgo'
import { useToast } from '@/components/ui/Toast'
import { UNDO_MS } from '@/lib/tutorFollowUpTabsCore'
import type { InboxActionView, InboxRowView } from '@/lib/interestInboxCore'

// One tutor on the Parent interest inbox (PR-10, owner 19 Nov 2026) — also on
// a parent's member page (the same row, the same log). Send opens WhatsApp with
// the ready message (built on the server; the tutor's number never reaches
// this page) and logs who sent it and when; a 10-second Undo in the toast, then
// "Sent by … at …" with Undo for the sender the rest of the day. The drill-down
// lists each parent's actions with dates: full names for staff, phones masked
// (Show is the logged member-page reveal).

const BTN = 'inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl px-4 text-xs font-bold'
const TAB_CHIP: Record<InboxRowView['tab'], { label: string; cls: string }> = {
  to_send: { label: 'To send', cls: 'bg-tm-tint-navy text-tm-navy' },
  new_since_sent: { label: 'New activity since sent', cls: 'bg-tm-tint-red text-tm-red' },
  sent: { label: 'Sent', cls: 'bg-tm-tint-green text-tm-green-deep' },
}

function Actions({ list }: { list: InboxActionView[] }) {
  return (
    <ul className="space-y-0.5">
      {list.map((a, i) => (
        <li key={i} className="text-[11px] text-slate-800">
          <span className="font-semibold">{a.label}</span>
          {a.blocked ? ' (could not reach the tutor)' : ''} · {a.when}
        </li>
      ))}
    </ul>
  )
}

export default function InterestInboxRow({
  row,
  canSend,
  canReveal,
  from,
  cap,
}: {
  row: InboxRowView
  canSend: boolean
  canReveal: boolean
  from: 'inbox' | 'parent_page'
  cap: number
}) {
  const router = useRouter()
  const toast = useToast()
  const readOnly = useAdminReadOnly()
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(false)

  const undo = async (id: string) => {
    const { ok, data } = await adminFetch<{ error?: string }>('/api/admin/interest-inbox', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'undo', id }),
    })
    if (!ok) return void toast.error(data?.error ?? 'Could not undo that.')
    toast.success('Send undone. The tutor is back in the list.')
    router.refresh()
  }

  const send = async () => {
    if (busy) return
    // Open the WhatsApp tab inside the tap (a later window.open is blocked).
    const tab = window.open('about:blank', '_blank')
    setBusy(true)
    const { ok, data } = await adminFetch<{ id?: string; waHref?: string; error?: string }>('/api/admin/interest-inbox', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'send', tutorId: row.tutorId, from }),
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

  const chip = TAB_CHIP[row.tab]
  const sendable = row.inInbox !== false && row.tab !== 'sent' && !!row.message

  return (
    <div className="space-y-2 rounded-2xl border border-gray-200 bg-white p-3" data-interest-row={row.tab}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <a href={`/admin/users/${row.tutorId}?from=/admin/whatsapp-updates`} className="text-sm font-black text-tm-navy hover:underline">
            {row.name}
          </a>
          {row.summaryText && <p className="text-[11px] font-semibold text-slate-800">{row.summaryText}</p>}
          <p className="text-[11px] text-gray-600">
            Last activity <TimeAgo iso={row.lastActivityAt} />
            {row.assigneeName ? ` · ${row.assigneeName}` : ''}
            {row.inInbox !== false ? ` · ${row.weekCount} of ${cap} this week` : ''}
          </p>
        </div>
        <div className="flex flex-wrap gap-1">
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${row.paid ? 'bg-tm-tint-green text-tm-green-deep' : 'bg-tm-tint-red text-tm-red'}`}>{row.paid ? 'Paid' : 'Unpaid'}</span>
          {row.inInbox !== false && <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${chip.cls}`}>{chip.label}</span>}
        </div>
      </div>

      {row.mine && row.mine.length > 0 && (
        <div className="rounded-xl bg-tm-bg p-2">
          <p className="text-[11px] font-bold text-slate-800">This parent</p>
          <Actions list={row.mine} />
        </div>
      )}

      {row.inInbox === false && <p className="text-[11px] text-gray-600">Not messaged — this tutor turned WhatsApp updates off, has no number, or is paused or not eligible.</p>}

      {row.last && (
        <p className="flex flex-wrap items-center gap-x-2 text-xs font-semibold text-tm-green-deep">
          <span>
            <Check aria-hidden size={12} className="mr-1 inline" />
            Sent{row.last.by ? ` by ${row.last.by}` : ''} {row.last.when}
            {row.last.from === 'parent_page' ? ' (from a parent’s page)' : ''}
          </span>
          {row.last.today && row.last.mayUndo && !readOnly && (
            <button type="button" onClick={() => void undo(row.last!.id)} className="inline-flex min-h-[44px] items-center gap-1 font-bold text-tm-navy underline">
              <Undo2 aria-hidden size={12} /> Undo
            </button>
          )}
        </p>
      )}

      {sendable && (
        <>
          <pre className="whitespace-pre-wrap break-words rounded-xl bg-tm-bg p-3 font-sans text-xs leading-relaxed text-slate-800">{row.message}</pre>
          {row.waitLabel ? (
            <p className="text-[11px] font-semibold text-gray-600">Waiting: {row.waitLabel}</p>
          ) : (
            canSend &&
            !readOnly && (
              <div className="flex justify-end">
                <button type="button" disabled={busy} onClick={() => void send()} className={`${BTN} bg-tm-green-deep text-white hover:bg-tm-green-deep-hover disabled:opacity-50`}>
                  <MessageCircle aria-hidden size={14} /> {busy ? 'Opening…' : 'Send'}
                </button>
              </div>
            )
          )}
        </>
      )}

      {row.parents.length > 0 && (
        <div>
          <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="inline-flex min-h-[44px] items-center gap-1 text-xs font-bold text-tm-navy">
            <ChevronDown aria-hidden size={14} className={open ? 'rotate-180' : ''} /> {open ? 'Hide' : 'See'} each parent ({row.parents.length})
          </button>
          {open && (
            <ul className="mt-1 space-y-2" data-interest-drilldown="">
              {row.parents.map((p) => (
                <li key={p.parentId} className="rounded-xl border border-gray-200 p-2">
                  <p className="flex flex-wrap items-center gap-x-2 text-xs">
                    <a href={`/admin/users/${p.parentId}?from=/admin/whatsapp-updates`} className="font-bold text-tm-navy hover:underline">
                      {p.name}
                    </a>
                    {p.place && <span className="text-gray-600">{p.place}</span>}
                    {p.maskedPhone &&
                      (canReveal ? <MaskedContact memberId={p.parentId} field="phone" masked={p.maskedPhone} /> : <span className="font-mono text-gray-600">{p.maskedPhone}</span>)}
                  </p>
                  <Actions list={p.actions} />
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
