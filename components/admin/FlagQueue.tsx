'use client'

import { useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, ExternalLink } from 'lucide-react'

import { useToast } from '@/components/ui/Toast'
import { useConfirm } from '@/components/ui/ConfirmDialog'
import { formatDateTime } from '@/lib/datetime'
import { flagSourceLabel, type FlagRow } from '@/lib/adminFlagsShared'

// The flagged-content queue (PR40 §2). Each row: the flagged text, both members
// (linked to their admin page), what matched and when, and the staff actions —
// clear the flag, suspend the author, or reinstate a suspended author (an appeal).
// The recipient is shown for context only; they were never notified.

export default function FlagQueue({ initial }: { initial: FlagRow[] }) {
  const [rows, setRows] = useState<FlagRow[]>(initial)
  const [busy, setBusy] = useState<string | null>(null)
  const toast = useToast()
  const confirm = useConfirm()

  async function act(
    action: 'clear' | 'suspend' | 'reinstate',
    flag: FlagRow,
  ) {
    if (action === 'suspend') {
      const ok = await confirm({
        title: `Suspend ${flag.subject.name}?`,
        body: 'They will not be able to message, apply, hire or see contact details. Nothing is deleted. They can appeal to support.',
        confirmLabel: 'Suspend',
      })
      if (!ok) return
    }
    setBusy(flag.id + action)
    try {
      const res = await fetch('/api/admin/flags', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action, flagId: flag.id, userId: flag.subject.id }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error ?? 'That did not go through.')
        return
      }
      if (action === 'clear') {
        setRows((r) => r.filter((x) => x.id !== flag.id))
        toast.success('Flag cleared.')
      } else if (action === 'suspend') {
        setRows((r) => r.map((x) => (x.subject.id === flag.subject.id ? { ...x, subject: { ...x.subject, suspended: true } } : x)))
        toast.success(`${flag.subject.name} suspended.`)
      } else {
        setRows((r) => r.map((x) => (x.subject.id === flag.subject.id ? { ...x, subject: { ...x.subject, suspended: false } } : x)))
        toast.success(`${flag.subject.name} reinstated.`)
      }
    } catch {
      toast.error('Network error. Try again.')
    } finally {
      setBusy(null)
    }
  }

  if (rows.length === 0) {
    return (
      <p className="rounded-2xl border border-gray-200 bg-white p-6 text-center text-xs text-gray-500">
        No flagged content. Messages, profiles and tuitions that contain banned words appear here for review.
      </p>
    )
  }

  return (
    <ul className="space-y-3">
      {rows.map((f) => (
        <li key={f.id} className="space-y-2 rounded-2xl border border-tm-gold/40 bg-white p-4">
          <div className="flex flex-wrap items-center gap-2 text-[11px]">
            <span className="inline-flex items-center gap-1 rounded-full bg-tm-tint-gold px-2 py-0.5 font-black text-tm-gold-ink">
              <AlertTriangle aria-hidden size={11} /> {flagSourceLabel(f.source)}
            </span>
            <span className="text-gray-500">{formatDateTime(f.createdAt)}</span>
            {f.subject.suspended && (
              <span className="rounded-full bg-tm-tint-red px-2 py-0.5 font-black text-tm-red">Suspended</span>
            )}
          </div>

          {/* The flagged text, with the matched terms called out. */}
          <p className="whitespace-pre-wrap break-words rounded-xl bg-tm-bg p-3 text-sm text-slate-700">{f.content}</p>
          <p className="text-[11px] text-gray-500">
            Matched:{' '}
            {f.matched.map((m) => (
              <code key={m} className="mr-1 rounded bg-tm-tint-red px-1.5 py-0.5 font-black text-tm-red">
                {m}
              </code>
            ))}
          </p>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
            <span className="text-gray-500">
              From{' '}
              <Link href={`/admin/users/${f.subject.id}`} className="font-bold text-tm-navy hover:underline">
                {f.subject.name}
              </Link>
            </span>
            {f.recipient && (
              <span className="text-gray-500">
                to{' '}
                <Link href={`/admin/users/${f.recipient.id}`} className="font-bold text-tm-navy hover:underline">
                  {f.recipient.name}
                </Link>
              </span>
            )}
            {typeof f.context?.jobId === 'string' && (
              <Link href={`/admin/jobs/${f.context.jobId}`} className="inline-flex items-center gap-1 font-bold text-tm-red hover:underline">
                View tuition <ExternalLink size={10} aria-hidden />
              </Link>
            )}
          </div>

          <div className="flex flex-wrap gap-2 border-t border-gray-100 pt-2">
            <button
              type="button"
              onClick={() => act('clear', f)}
              disabled={busy === f.id + 'clear'}
              className="inline-flex min-h-[36px] items-center rounded-lg border border-gray-200 px-3 text-[11px] font-bold text-tm-navy hover:border-tm-navy disabled:opacity-60"
            >
              Clear flag
            </button>
            {f.subject.suspended ? (
              <button
                type="button"
                onClick={() => act('reinstate', f)}
                disabled={busy === f.id + 'reinstate'}
                className="inline-flex min-h-[36px] items-center rounded-lg border border-tm-green-deep/40 px-3 text-[11px] font-bold text-tm-green-deep hover:bg-tm-tint-green disabled:opacity-60"
              >
                Reinstate (appeal)
              </button>
            ) : (
              <button
                type="button"
                onClick={() => act('suspend', f)}
                disabled={busy === f.id + 'suspend'}
                className="inline-flex min-h-[36px] items-center rounded-lg bg-tm-red px-3 text-[11px] font-bold text-white hover:bg-tm-red-hover disabled:opacity-60"
              >
                Suspend member
              </button>
            )}
          </div>
        </li>
      ))}
    </ul>
  )
}
