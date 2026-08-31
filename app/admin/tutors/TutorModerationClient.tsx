'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import SecureDocumentPreview from '@/components/SecureDocumentPreview'

export type QueueTutor = {
  id: string
  fullName: string
  email: string
  headline: string | null
  city: string | null
  area: string | null
  avatarUrl: string | null
  videoYoutubeId: string | null
  videoStatus: string
  videoAttempts: number
  verificationStatus: string
  ratingAvg: number
  ratingCount: number
  degrees: string[]
  completion: number
  cnicNumber: string | null
  phone: string | null
  documents: { id: string; kind: 'cnic' | 'degree'; label: string | null }[]
}

const FILTERS = [
  { key: 'pending', label: 'Pending video' },
  { key: 'all', label: 'All' },
  { key: 'suspended', label: 'Suspended' },
]

const MAX_ATTEMPTS = 3

export default function TutorModerationClient({
  tutors,
  filter,
}: {
  tutors: QueueTutor[]
  filter: string
}) {
  const router = useRouter()
  const [open, setOpen] = useState<QueueTutor | null>(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')

  async function act(action: 'approve' | 'hold' | 'suspend' | 'unsuspend') {
    if (!open) return
    if (reason.trim().length < 3) {
      setErr('Write a reason — it is recorded and shown to the tutor.')
      return
    }
    setBusy(true)
    setErr('')
    setMsg('')

    const res = await fetch('/api/admin/tutors/moderate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tutorId: open.id, action, reason: reason.trim() }),
    })
    const json = await res.json()
    setBusy(false)

    if (!res.ok) {
      setErr(json.error ?? 'Action failed.')
      return
    }

    setMsg(
      `${action} recorded.` +
        (json.resubmissionLocked ? ' Resubmission is now locked (3 strikes).' : ''),
    )
    setReason('')
    setOpen(null)
    router.refresh()
  }

  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-xl sm:text-2xl font-black text-[#0F172A]">Tutor moderation</h1>
        <p className="text-xs text-gray-500">
          Every decision needs a written reason and is recorded in the audit log.
        </p>
      </header>

      <nav className="flex gap-1.5 overflow-x-auto pb-1" aria-label="Filter">
        {FILTERS.map((f) => (
          <Link
            key={f.key}
            href={`/admin/tutors?filter=${f.key}`}
            aria-current={filter === f.key ? 'page' : undefined}
            className={`min-h-[44px] whitespace-nowrap px-3.5 py-2 rounded-xl text-[11px] font-bold border flex items-center transition-colors ${
              filter === f.key
                ? 'bg-[#0F172A] text-white border-[#0F172A]'
                : 'bg-white text-[#334155] border-gray-200 hover:bg-gray-50'
            }`}
          >
            {f.label}
          </Link>
        ))}
      </nav>

      {msg && (
        <p className="p-3 bg-emerald-50 border border-emerald-200 text-[#059669] text-xs font-bold rounded-xl">
          {msg}
        </p>
      )}

      {tutors.length === 0 ? (
        <p className="bg-white border border-gray-200 rounded-2xl p-6 text-center text-xs font-bold text-gray-500">
          Nothing in this queue.
        </p>
      ) : (
        <ul className="space-y-2">
          {tutors.map((t) => (
            <li key={t.id}>
              <button
                onClick={() => {
                  setOpen(t)
                  setReason('')
                  setErr('')
                }}
                className="w-full text-left bg-white border border-gray-200 rounded-2xl p-3 sm:p-4 hover:border-[#0F172A] transition-colors flex items-center gap-3 min-h-[44px]"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={t.avatarUrl || `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(t.fullName)}`}
                  alt=""
                  className="h-11 w-11 rounded-full object-cover bg-gray-100 shrink-0"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-black text-[#0F172A] truncate">{t.fullName}</p>
                  <p className="text-[11px] text-gray-500 truncate">
                    {t.city ?? '—'} · {t.completion}% complete · {t.videoAttempts}/{MAX_ATTEMPTS} video
                  </p>
                </div>
                <StatusPill status={t.verificationStatus} videoStatus={t.videoStatus} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Detail drawer */}
      {open && (
        <div
          className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center sm:justify-center"
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
                <h2 className="text-base font-black text-[#0F172A] truncate">{open.fullName}</h2>
                <p className="text-[11px] text-gray-500 truncate">{open.email}</p>
              </div>
              <button onClick={() => setOpen(null)} className="text-gray-400 text-xl min-h-[44px] px-2" aria-label="Close">
                ×
              </button>
            </div>

            <dl className="grid grid-cols-2 gap-2 text-[11px]">
              <Info label="Completion" value={`${open.completion}%`} />
              <Info label="Verification" value={open.verificationStatus} />
              <Info label="Video" value={`${open.videoStatus} (${open.videoAttempts}/${MAX_ATTEMPTS})`} />
              <Info label="Rating" value={`${open.ratingAvg} (${open.ratingCount})`} />
              <Info label="City / area" value={`${open.city ?? '—'} / ${open.area ?? '—'}`} />
              <Info label="CNIC no." value={open.cnicNumber ?? '—'} />
            </dl>

            {open.headline && <p className="text-xs text-[#334155]">{open.headline}</p>}

            {open.degrees.length > 0 && (
              <div className="space-y-1">
                <p className="text-[11px] font-bold text-[#0F172A]">Degrees claimed</p>
                <ul className="text-[11px] text-gray-600 space-y-0.5">
                  {open.degrees.map((d) => (
                    <li key={d}>• {d}</li>
                  ))}
                </ul>
              </div>
            )}

            {open.videoYoutubeId && (
              <a
                href={`https://www.youtube.com/watch?v=${open.videoYoutubeId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="block text-center min-h-[44px] py-3 bg-[#0F172A] text-white text-xs font-bold rounded-xl"
              >
                Open introduction video (private) ↗
              </a>
            )}

            {open.documents.length > 0 && (
              <div className="space-y-2">
                <p className="text-[11px] font-bold text-[#0F172A]">
                  Documents — watermarked previews, admin rights
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {open.documents.map((d) => (
                    <div key={d.id} className="space-y-1">
                      <p className="text-[10px] uppercase tracking-wider text-gray-400 font-bold">{d.kind}</p>
                      <SecureDocumentPreview documentId={d.id} alt={`${d.kind} preview`} />
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-1 pt-1">
              <label htmlFor="reason" className="text-[11px] font-bold text-[#0F172A]">
                Reason (required — recorded and shown to the tutor)
              </label>
              <textarea
                id="reason"
                rows={2}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="w-full min-h-[44px] p-3 bg-[#F8FAFC] border border-gray-200 rounded-xl text-sm outline-none focus:border-[#0F172A]"
              />
            </div>

            {err && <p className="text-[11px] font-bold text-[#d60008]">{err}</p>}

            {open.videoAttempts >= MAX_ATTEMPTS && (
              <p className="text-[11px] font-bold text-amber-800 bg-amber-50 border border-amber-200 rounded-xl p-2.5">
                This tutor has used all {MAX_ATTEMPTS} video submissions — resubmission is locked.
              </p>
            )}

            <div className="grid grid-cols-3 gap-2">
              <button onClick={() => act('approve')} disabled={busy} className="min-h-[44px] py-3 bg-[#059669] hover:bg-emerald-700 text-white text-xs font-bold rounded-xl disabled:opacity-50">
                Approve
              </button>
              <button onClick={() => act('hold')} disabled={busy} className="min-h-[44px] py-3 bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold rounded-xl disabled:opacity-50">
                Hold
              </button>
              {open.verificationStatus === 'suspended' ? (
                <button onClick={() => act('unsuspend')} disabled={busy} className="min-h-[44px] py-3 bg-[#0F172A] text-white text-xs font-bold rounded-xl disabled:opacity-50">
                  Unsuspend
                </button>
              ) : (
                <button onClick={() => act('suspend')} disabled={busy} className="min-h-[44px] py-3 bg-[#d60008] hover:bg-red-700 text-white text-xs font-bold rounded-xl disabled:opacity-50">
                  Suspend
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-[#F8FAFC] border border-gray-100 rounded-xl p-2">
      <dt className="text-[10px] uppercase tracking-wider text-gray-400 font-bold">{label}</dt>
      <dd className="text-[11px] font-bold text-[#0F172A] capitalize truncate">{value}</dd>
    </div>
  )
}

function StatusPill({ status, videoStatus }: { status: string; videoStatus: string }) {
  const cls =
    status === 'suspended'
      ? 'bg-red-50 text-[#d60008] border-red-200'
      : status === 'verified'
        ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
        : videoStatus === 'uploaded'
          ? 'bg-amber-50 text-amber-800 border-amber-200'
          : 'bg-gray-50 text-gray-600 border-gray-200'
  return (
    <span className={`shrink-0 px-2 py-1 rounded-lg border text-[10px] font-bold capitalize ${cls}`}>
      {status === 'pending' && videoStatus === 'uploaded' ? 'review' : status}
    </span>
  )
}
