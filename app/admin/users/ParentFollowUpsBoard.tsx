'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { MessageCircle, Mail } from 'lucide-react'
import { adminFetch } from '@/components/admin/adminFetch'
import { useToast } from '@/components/ui/Toast'
import { useAdminReadOnly } from '@/components/admin/ReadOnly'
import NotInterestedButton from '@/components/admin/NotInterestedButton'
import { PARENT_REASON_LABEL, type ParentReason } from '@/lib/parentFollowUpCore'
import { UNDO_MS, type TabState } from '@/lib/tutorFollowUpTabsCore'
import { formatDate } from '@/lib/datetime'

// Follow-ups → Parents (owner, 26 Oct 2026) — the same To do / Followed up board
// as Tutors (lib/parentFollowUpCore). One card per parent: their situation, the
// tuition it is about, the last contact, and one button — WhatsApp parent (or
// Send email when they gave only an email). "Tutors applied, not yet forwarded"
// is Waiting on us: a link to Applications, never a message.

export type ParentCard = {
  id: string
  name: string
  city: string | null
  joinedAt: string
  reason: ParentReason
  tuition: { title: string; path: string | null } | null
  state: TabState
  hasNumber: boolean
  hasEmail: boolean
  notInterested: boolean
}

export default function ParentFollowUpsBoard({ cards, noReply }: { cards: ParentCard[]; noReply: ParentCard[] }) {
  return (
    <div className="space-y-3">
      {cards.length === 0 ? (
        <p className="rounded-2xl border border-gray-200 bg-white p-6 text-center text-xs text-gray-500">Nobody here right now.</p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2" data-parent-board="">
          {cards.map((c) => (
            <ParentRow key={c.id} c={c} />
          ))}
        </ul>
      )}
      {noReply.length > 0 && (
        <details className="rounded-2xl border border-gray-200 bg-white p-3">
          <summary className="cursor-pointer text-xs font-black text-tm-navy">No reply after 3 messages ({noReply.length})</summary>
          <ul className="mt-2 grid gap-2 sm:grid-cols-2">
            {noReply.map((c) => (
              <ParentRow key={c.id} c={c} />
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}

function ParentRow({ c }: { c: ParentCard }) {
  const toast = useToast()
  const router = useRouter()
  const readOnly = useAdminReadOnly()
  const [busy, setBusy] = useState(false)
  const s = c.state
  const waiting = !!s.action

  async function send() {
    const tab = c.hasNumber ? window.open('about:blank', '_blank') : null
    setBusy(true)
    const { ok, data } = await adminFetch<{ id?: string; waHref?: string | null; emailed?: boolean; error?: string }>('/api/admin/follow-ups/parent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'record', memberId: c.id }),
    })
    setBusy(false)
    if (!ok || !data?.id) {
      tab?.close()
      return toast.error(data?.error ?? 'That did not save. Please try again.')
    }
    if (data.waHref) {
      if (tab) tab.location.href = data.waHref
      else window.open(data.waHref, '_blank')
    }
    const id = data.id
    toast.success(data.emailed ? 'Email sent. Moved to Followed up.' : 'Moved to Followed up.', {
      label: 'Undo',
      ms: UNDO_MS,
      onClick: () => {
        void adminFetch('/api/admin/follow-ups/parent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'undo', id }),
        }).then(({ ok: done, data: d }) => {
          if (done) {
            toast.success('Follow-up undone.')
            router.refresh()
          } else toast.error((d as { error?: string })?.error ?? 'Could not undo.')
        })
      },
    })
    router.refresh()
  }

  const last = s.last
  return (
    <li className={`space-y-2 rounded-2xl border p-3 ${s.overdue ? 'border-tm-red/40 bg-tm-tint-red' : 'border-gray-200 bg-white'}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <Link href={`/admin/users/${c.id}`} className="truncate text-sm font-black text-tm-navy hover:underline">
            {c.name}
          </Link>
          <p className="text-[11px] text-gray-600">
            {c.city ?? 'No city'} · joined {formatDate(c.joinedAt)}
          </p>
        </div>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${waiting ? 'bg-tm-tint-gold text-tm-gold-ink' : 'bg-tm-tint-navy text-tm-navy'}`}>
          {PARENT_REASON_LABEL[c.reason]}
        </span>
      </div>
      {c.tuition && (
        <p className="truncate text-xs text-slate-700">
          {c.tuition.path ? (
            <a href={c.tuition.path} target="_blank" rel="noopener noreferrer" className="font-bold text-tm-navy hover:underline">
              {c.tuition.title}
            </a>
          ) : (
            c.tuition.title
          )}
        </p>
      )}
      <p className="text-[11px] text-gray-600">
        {last ? `Last contact ${formatDate(last.at)}${last.staffName ? ` by ${last.staffName}` : ''}` : 'Not contacted yet'}
        {s.dueAt ? ` · next due ${formatDate(s.dueAt)}` : ''}
        {s.overdue ? ' · overdue' : ''}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {waiting && (
          <Link href={s.action!.href} className="inline-flex min-h-[40px] items-center rounded-xl bg-tm-gold px-3 text-xs font-bold text-tm-black">
            {s.action!.label} — waiting on us
          </Link>
        )}
        {/* "Tutors applied" also has a message now (owner, 27 Oct 2026): the
            tutors' profile links. Still waiting on us, still out of the badge. */}
        {readOnly ? null : c.hasNumber || c.hasEmail ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => void send()}
            className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl bg-tm-green-deep px-3 text-xs font-bold text-white hover:bg-tm-green-deep-hover disabled:opacity-60"
          >
            {c.hasNumber ? <MessageCircle aria-hidden size={14} /> : <Mail aria-hidden size={14} />}
            {busy ? 'Sending…' : c.hasNumber ? (waiting ? 'WhatsApp the tutors to parent' : 'WhatsApp parent') : 'Send email'}
          </button>
        ) : (
          <span className="text-[11px] text-gray-500">No WhatsApp number or email</span>
        )}
        <NotInterestedButton memberId={c.id} marked={c.notInterested} />
      </div>
    </li>
  )
}
