'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { MessageCircle } from 'lucide-react'

import { adminFetch } from '@/components/admin/adminFetch'
import { useToast } from '@/components/ui/Toast'
import { formatDateTime } from '@/lib/datetime'
import type { FeaturedRow } from '@/lib/staffOutreach'

// One Featured tutor and their new matches (owner, 8 Oct 2026). The tap opens a
// blank tab IMMEDIATELY (so the browser does not block it as a pop-up), records
// the send on the server, then points the tab at wa.me with the message. If
// someone else already sent these tuitions, the tab closes and the reason shows.

export default function FeaturedSendRow({ row }: { row: FeaturedRow }) {
  const router = useRouter()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState<string | null>(null)

  const send = async () => {
    const tab = window.open('', '_blank')
    setBusy(true)
    const { ok, data } = await adminFetch<{ href?: string; sentAt?: string; error?: string }>('/api/admin/outreach/featured', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tutorId: row.tutorId, jobIds: row.matches.map((m) => m.jobId) }),
    })
    setBusy(false)
    if (!ok || !data?.href) {
      tab?.close()
      toast.error(data?.error ?? 'That did not go through. Please try again.')
      router.refresh()
      return
    }
    if (tab) tab.location.href = data.href
    else window.location.href = data.href
    setSent(data.sentAt ?? new Date().toISOString())
    toast.success('Sent — recorded against your name.')
    router.refresh()
  }

  return (
    <li className="space-y-2 rounded-2xl border border-gray-200 bg-white p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-black text-tm-navy">{row.name}</p>
        <span className="text-[11px] text-gray-600">
          {row.city ?? '—'} · {row.matches.length} new match{row.matches.length === 1 ? '' : 'es'}
        </span>
      </div>
      <ol className="list-decimal space-y-0.5 pl-5 text-xs text-slate-700">
        {row.matches.map((m) => (
          <li key={m.jobId}>
            {m.title}
            {m.area || m.city ? ` — ${[m.area, m.city].filter(Boolean).join(', ')}` : ''}
            {m.refId ? <span className="text-gray-500"> ({m.refId})</span> : null}
          </li>
        ))}
      </ol>
      <p className="text-[11px] text-gray-600">
        {sent
          ? `Sent ${formatDateTime(sent)} by you`
          : row.lastSent
            ? `Last sent ${formatDateTime(row.lastSent.at)} by ${row.lastSent.byEmail ?? 'staff'}`
            : 'Never sent on WhatsApp.'}
      </p>
      {row.msisdn ? (
        <button
          type="button"
          onClick={() => void send()}
          disabled={busy || !!sent}
          className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-tm-green-deep px-4 text-xs font-bold text-white hover:bg-tm-green-deep-hover disabled:opacity-60"
        >
          <MessageCircle aria-hidden size={15} /> {busy ? 'Recording…' : sent ? 'Sent' : 'Send on WhatsApp'}
        </button>
      ) : (
        <p className="text-[11px] font-bold text-tm-red">No WhatsApp number on file.</p>
      )}
    </li>
  )
}
