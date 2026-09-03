'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import InfiniteFooter from '@/components/InfiniteFooter'
import SecureDocumentPreview from '@/components/SecureDocumentPreview'
import StatusChip from '@/components/admin/StatusChip'
import { useInfinite } from '@/lib/useInfinite'
import type { QueueParentRow } from '@/lib/adminQueues'

export type QueueParent = QueueParentRow

const FILTERS = [
  { key: 'submitted', label: 'Awaiting review' },
  { key: 'all', label: 'All' },
  { key: 'approved', label: 'Approved' },
]

export default function ParentVerificationClient({
  parents,
  filter,
  initialCursor,
  total,
}: {
  parents: QueueParent[]
  filter: string
  initialCursor: string | null
  total: number
}) {
  const router = useRouter()
  const more = useInfinite<QueueParent>({
    endpoint: '/api/admin/queues/parents',
    params: { filter },
    initialCursor,
    storageKey: `tm:more:admin-parents:${filter}`,
  })
  const all = [...parents, ...more.items]
  const [open, setOpen] = useState<QueueParent | null>(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')

  async function act(action: 'approve' | 'reject') {
    if (!open) return
    if (reason.trim().length < 3) {
      setErr('Write a reason — it is recorded, and a rejection reason is shown to the parent.')
      return
    }
    setBusy(true)
    setErr('')
    setMsg('')

    const res = await fetch('/api/admin/parents/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ parentId: open.id, action, reason: reason.trim() }),
    })
    const json = await res.json()
    setBusy(false)

    if (!res.ok) {
      setErr(json.error ?? 'Action failed.')
      return
    }

    setMsg(
      action === 'approve'
        ? `${open.fullName} approved — they can now post jobs.`
        : `${open.fullName} rejected. They can correct and resubmit.`,
    )
    setReason('')
    setOpen(null)
    router.refresh()
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-500">
        Approving sets CNIC and address verified, which is what unblocks job posting.
      </p>

      <nav className="flex gap-1.5 overflow-x-auto pb-1" aria-label="Filter">
        {FILTERS.map((f) => (
          <Link
            key={f.key}
            href={`/admin/parents?filter=${f.key}`}
            aria-current={filter === f.key ? 'page' : undefined}
            className={`min-h-[44px] whitespace-nowrap px-3.5 py-2 rounded-xl text-[11px] font-bold border flex items-center transition-colors ${
              filter === f.key
                ? 'bg-tm-black text-white border-tm-navy'
                : 'bg-white text-slate-700 border-gray-200 hover:bg-gray-50'
            }`}
          >
            {f.label}
          </Link>
        ))}
      </nav>

      {msg && (
        <p className="p-3 bg-tm-tint-green border border-tm-green-deep/30 text-tm-green-deep text-xs font-bold rounded-xl">
          {msg}
        </p>
      )}

      {all.length === 0 ? (
        <p className="bg-white border border-gray-200 rounded-2xl p-6 text-center text-xs font-bold text-gray-500">
          Nothing in this queue.
        </p>
      ) : (
        <ul className="space-y-2">
          {all.map((p) => (
            <li key={p.id}>
              <button
                onClick={() => {
                  setOpen(p)
                  setReason('')
                  setErr('')
                }}
                className="w-full text-left bg-white border border-gray-200 rounded-2xl p-3 sm:p-4 hover:border-tm-navy transition-colors flex items-center gap-3 min-h-[44px]"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-black text-tm-navy truncate">{p.fullName}</p>
                  <p className="text-[11px] text-gray-500 truncate">
                    {p.city ?? '—'} · {p.completion}% · {p.cnicDocumentId ? 'CNIC uploaded' : 'no CNIC'}
                  </p>
                </div>
                <StatusChip status={p.state} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {all.length > 0 && (
        <InfiniteFooter
          state={more.state}
          done={more.done}
          loadMore={more.loadMore}
          sentinel={more.sentinel}
          loadedCount={all.length}
          total={total}
          noun="parents"
        />
      )}

      {open && (
        <div
          className="fixed inset-0 z-50 bg-tm-black/50 flex items-end sm:items-center sm:justify-center"
          role="dialog"
          aria-modal="true"
          aria-label={`Review ${open.fullName}`}
          onClick={() => setOpen(null)}
        >
          <div
            className="bg-white w-full sm:max-w-lg max-h-[90vh] overflow-y-auto rounded-t-3xl sm:rounded-3xl p-5 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-base font-black text-tm-navy truncate">{open.fullName}</h2>
                <p className="text-[11px] text-gray-500 truncate">{open.email}</p>
              </div>
              <button onClick={() => setOpen(null)} className="text-gray-500 text-xl min-h-[44px] px-2" aria-label="Close">
                ×
              </button>
            </div>

            <dl className="grid grid-cols-2 gap-2 text-[11px]">
              <Info label="State" value={open.state} />
              <Info label="Completion" value={`${open.completion}%`} />
              <Info label="CNIC no." value={open.cnicNumber ?? '—'} />
              <Info label="Mobile" value={open.phoneVerified ? `${open.phone} ✓` : (open.phone ?? '—')} />
            </dl>

            <div className="space-y-1">
              <p className="text-[11px] font-bold text-tm-navy">Address</p>
              <p className="text-xs text-gray-600 bg-tm-bg border border-gray-100 rounded-xl p-3">
                {open.address || 'Not provided'}
              </p>
            </div>

            {open.cnicDocumentId ? (
              <div className="space-y-1">
                <p className="text-[11px] font-bold text-tm-navy">CNIC — watermarked preview</p>
                <SecureDocumentPreview documentId={open.cnicDocumentId} alt="CNIC preview" />
              </div>
            ) : (
              <p className="text-[11px] font-bold text-tm-gold-ink bg-tm-tint-gold border border-tm-gold/30 rounded-xl p-2.5">
                No CNIC image uploaded.
              </p>
            )}

            <div className="space-y-1 pt-1">
              <label htmlFor="preason" className="text-[11px] font-bold text-tm-navy">
                Reason (required — a rejection reason is shown to the parent)
              </label>
              <textarea
                id="preason"
                rows={2}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="w-full min-h-[44px] p-3 bg-tm-bg border border-gray-200 rounded-xl text-sm outline-none focus:border-tm-navy"
              />
            </div>

            {err && <p className="text-[11px] font-bold text-tm-red">{err}</p>}

            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => act('approve')} disabled={busy} className="min-h-[44px] py-3 bg-tm-green-deep hover:bg-tm-green-deep-hover text-white text-xs font-bold rounded-xl disabled:opacity-50">
                Approve
              </button>
              <button onClick={() => act('reject')} disabled={busy} className="min-h-[44px] py-3 bg-tm-red hover:bg-tm-red-hover text-white text-xs font-bold rounded-xl disabled:opacity-50">
                Reject
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-tm-bg border border-gray-100 rounded-xl p-2">
      <dt className="text-[10px] uppercase tracking-wider text-gray-500 font-bold">{label}</dt>
      <dd className="text-[11px] font-bold text-tm-navy capitalize truncate">{value}</dd>
    </div>
  )
}
