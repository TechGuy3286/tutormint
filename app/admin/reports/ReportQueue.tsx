'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { MessageSquare, Lock } from 'lucide-react'
import { formatDate, formatDateTime } from '@/lib/datetime'

export type QueueReport = {
  id: string
  reporterId: string | null
  reporterName: string
  reportedId: string | null
  reportedName: string | null
  reportedRole: string | null
  reportedSuspended: boolean
  targetType: string
  targetId: string | null
  reason: string
  detail: string | null
  status: 'open' | 'actioned' | 'dismissed'
  actionTaken: string | null
  resolutionNote: string | null
  createdAt: string
  reviewedAt: string | null
  /** Present only for reports that name a thread. null everywhere else. */
  messages: { who: string; body: string; at: string }[] | null
}

export type BlockRow = {
  id: string
  blockerId: string
  blockerName: string
  blockedId: string
  blockedName: string
  createdAt: string
}

const FILTERS = [
  { key: 'open', label: 'Open' },
  { key: 'actioned', label: 'Actioned' },
  { key: 'dismissed', label: 'Dismissed' },
  { key: 'all', label: 'All' },
]

const REASON_LABEL: Record<string, string> = {
  spam: 'Spam',
  harassment: 'Harassment',
  fake_profile: 'Fake profile',
  off_platform_payment: 'Off-platform payment',
  inappropriate_content: 'Inappropriate content',
  other: 'Other',
}

export default function ReportQueue({
  reports,
  blocks,
  filter,
}: {
  reports: QueueReport[]
  blocks: BlockRow[]
  filter: string
}) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [openThread, setOpenThread] = useState<string | null>(null)
  const [acting, setActing] = useState<{ id: string; action: string } | null>(null)
  const [reason, setReason] = useState('')

  const decide = async (reportId: string, action: string) => {
    setBusy(reportId)
    setError(null)
    try {
      const res = await fetch('/api/admin/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reportId, action, reason }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'That did not work.')
      setActing(null)
      setReason('')
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not work.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-5">
      <nav className="flex flex-wrap gap-2" aria-label="Report status">
        {FILTERS.map((f) => (
          <Link
            key={f.key}
            href={`/admin/reports?filter=${f.key}`}
            className={`inline-flex min-h-[44px] items-center rounded-xl px-4 text-xs font-bold ${
              filter === f.key
                ? 'bg-tm-black text-white'
                : 'border border-gray-200 bg-white text-slate-700'
            }`}
          >
            {f.label}
          </Link>
        ))}
      </nav>

      {error && (
        <p className="rounded-xl border border-tm-red/30 bg-tm-tint-red p-3 text-xs font-bold text-tm-red">
          {error}
        </p>
      )}

      {reports.length === 0 ? (
        <p className="rounded-2xl border border-gray-200 bg-white p-6 text-center text-xs text-gray-500">
          Nothing here.
        </p>
      ) : (
        <ul className="space-y-3">
          {reports.map((r) => (
            <li key={r.id} className="space-y-3 rounded-2xl border border-gray-200 bg-white p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 space-y-0.5">
                  <p className="text-sm font-black text-tm-navy">
                    {REASON_LABEL[r.reason] ?? r.reason}
                    <span className="ml-2 text-[11px] font-semibold text-gray-500">
                      on a {r.targetType}
                    </span>
                  </p>
                  <p className="text-[11px] text-gray-500">
                    {r.reporterName} reported{' '}
                    {r.reportedId ? (
                      <Link
                        href={`/admin/users/${r.reportedId}`}
                        className="font-bold text-tm-navy hover:underline"
                      >
                        {r.reportedName}
                      </Link>
                    ) : (
                      'no specific member'
                    )}
                    {r.reportedRole ? ` (${r.reportedRole})` : ''} ·{' '}
                    {formatDateTime(r.createdAt)}
                  </p>
                </div>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-wide ${
                    r.status === 'open'
                      ? 'bg-tm-tint-gold text-tm-gold-ink'
                      : r.status === 'actioned'
                        ? 'bg-tm-tint-red text-tm-red'
                        : 'bg-gray-100 text-gray-700'
                  }`}
                >
                  {r.status}
                </span>
              </div>

              {r.detail && (
                <p className="rounded-xl bg-tm-bg p-3 text-xs leading-relaxed">{r.detail}</p>
              )}

              {/* ------------------------------------------ thread content --- */}
              {r.targetType === 'thread' ? (
                r.messages && r.messages.length > 0 ? (
                  <div className="space-y-2">
                    <button
                      type="button"
                      onClick={() => setOpenThread(openThread === r.id ? null : r.id)}
                      className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-gray-200 px-4 text-xs font-bold text-slate-700"
                    >
                      <MessageSquare size={14} />
                      {openThread === r.id
                        ? 'Hide the conversation'
                        : `Read the reported conversation (${r.messages.length})`}
                    </button>

                    {openThread === r.id && (
                      <div className="max-h-80 space-y-2 overflow-y-auto rounded-xl border border-gray-200 bg-tm-bg p-3">
                        {r.messages.map((m, i) => (
                          <div key={i} className="space-y-0.5">
                            <p className="text-[10px] font-bold uppercase tracking-wide text-gray-500">
                              {m.who} · {formatDateTime(m.at)}
                            </p>
                            <p className="whitespace-pre-wrap break-words text-xs leading-relaxed">
                              {m.body}
                            </p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-[11px] text-gray-500">
                    That conversation has no messages in it.
                  </p>
                )
              ) : (
                <p className="flex items-center gap-2 text-[11px] text-gray-500">
                  <Lock size={12} />
                  This report is about a {r.targetType}, so no messages are readable from it.
                </p>
              )}

              {r.status !== 'open' && r.resolutionNote && (
                <p className="rounded-xl bg-tm-bg p-3 text-[11px] leading-relaxed text-gray-500">
                  <strong className="uppercase tracking-wide">{r.actionTaken}</strong> —{' '}
                  {r.resolutionNote}
                  {r.reviewedAt ? ` · ${formatDateTime(r.reviewedAt)}` : ''}
                </p>
              )}

              {/* ------------------------------------------------- actions --- */}
              {r.status === 'open' &&
                (acting?.id === r.id ? (
                  <div className="space-y-2">
                    <input
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      placeholder="Reason — the member is shown this"
                      aria-label="Reason"
                      className="min-h-[44px] w-full rounded-xl border border-gray-200 px-3 text-xs font-semibold"
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        disabled={reason.trim().length < 5 || busy === r.id}
                        onClick={() => decide(r.id, acting.action)}
                        className="min-h-[44px] rounded-xl bg-tm-black px-4 text-xs font-bold text-white disabled:bg-gray-300"
                      >
                        {busy === r.id ? 'Working…' : `Confirm ${acting.action}`}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setActing(null)
                          setReason('')
                        }}
                        className="min-h-[44px] rounded-xl border border-gray-200 px-4 text-xs font-bold text-slate-700"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    <button
                      type="button"
                      onClick={() => setActing({ id: r.id, action: 'dismiss' })}
                      className="min-h-[44px] rounded-xl border border-gray-200 px-3 text-xs font-bold text-slate-700"
                    >
                      Dismiss
                    </button>
                    {r.reportedId && (
                      <>
                        <button
                          type="button"
                          onClick={() => setActing({ id: r.id, action: 'warn' })}
                          className="min-h-[44px] rounded-xl bg-tm-gold px-3 text-xs font-bold text-tm-navy"
                        >
                          Warn
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setActing({
                              id: r.id,
                              action: r.reportedSuspended ? 'unsuspend' : 'suspend',
                            })
                          }
                          className={`min-h-[44px] rounded-xl px-3 text-xs font-bold text-white ${
                            r.reportedSuspended ? 'bg-tm-green-deep' : 'bg-tm-red'
                          }`}
                        >
                          {r.reportedSuspended ? 'Unsuspend' : 'Suspend'}
                        </button>
                      </>
                    )}
                  </div>
                ))}
            </li>
          ))}
        </ul>
      )}

      {/* --------------------------------------------------------- blocks --- */}
      <section className="space-y-2">
        <h2 className="text-sm font-black text-tm-navy">Blocks</h2>
        <p className="text-[11px] leading-relaxed text-gray-500">
          Read-only. A block is a member&rsquo;s own decision and admins do not undo it — this list
          exists so a report can be read in context when two people have already stopped talking.
        </p>
        {blocks.length === 0 ? (
          <p className="rounded-2xl border border-gray-200 bg-white p-4 text-center text-xs text-gray-500">
            Nobody has blocked anybody.
          </p>
        ) : (
          <ul className="space-y-2">
            {blocks.map((b) => (
              <li
                key={b.id}
                className="flex flex-wrap items-baseline justify-between gap-2 rounded-2xl border border-gray-200 bg-white p-3 text-xs"
              >
                <span>
                  <Link href={`/admin/users/${b.blockerId}`} className="font-bold hover:underline">
                    {b.blockerName}
                  </Link>{' '}
                  <span className="text-gray-500">blocked</span>{' '}
                  <Link href={`/admin/users/${b.blockedId}`} className="font-bold hover:underline">
                    {b.blockedName}
                  </Link>
                </span>
                <span className="text-[11px] text-gray-500">
                  {formatDate(b.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
