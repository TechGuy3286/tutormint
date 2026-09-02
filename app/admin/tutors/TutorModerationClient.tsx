'use client'

import Avatar from '@/components/Avatar'
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
  videoVisibility: string
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
  canSetVisibility,
}: {
  tutors: QueueTutor[]
  filter: string
  /** Only owner/manager may publish a video; a verifier sees the state, not the control. */
  canSetVisibility: boolean
}) {
  const router = useRouter()
  const [open, setOpen] = useState<QueueTutor | null>(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')

  async function setVisibility(visibility: 'private' | 'unlisted' | 'public') {
    if (!open) return
    setBusy(true)
    setErr('')
    setMsg('')
    try {
      const res = await fetch('/api/admin/tutors/video-visibility', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tutorId: open.id, visibility }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'That did not work.')
      // Say what actually happened. Without YOUTUBE_* credentials the choice is
      // recorded here and NOT applied on YouTube, and a green tick would be a lie.
      setMsg(json.note ?? `Video is now ${visibility} on YouTube.`)
      setOpen({ ...open, videoVisibility: visibility })
      router.refresh()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'That did not work.')
    } finally {
      setBusy(false)
    }
  }

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
        <h1 className="text-xl sm:text-2xl font-black text-tm-navy">Tutor moderation</h1>
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
                className="w-full text-left bg-white border border-gray-200 rounded-2xl p-3 sm:p-4 hover:border-tm-navy transition-colors flex items-center gap-3 min-h-[44px]"
              >
                {/* Was an api.dicebear.com URL: it sent every tutor's real
                    name to a third party as a query string, and img-src in the
                    CSP does not name that host, so it rendered nothing at all
                    in production. */}
                <Avatar
                  name={t.fullName}
                  src={t.avatarUrl}
                  seed={t.id}
                  decorative
                  ring="border border-gray-200"
                  className="h-11 w-11 text-xs"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-black text-tm-navy truncate">{t.fullName}</p>
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
              <Info label="Completion" value={`${open.completion}%`} />
              <Info label="Verification" value={open.verificationStatus} />
              <Info label="Video" value={`${open.videoStatus} (${open.videoAttempts}/${MAX_ATTEMPTS})`} />
              <Info label="Rating" value={`${open.ratingAvg} (${open.ratingCount})`} />
              <Info label="City / area" value={`${open.city ?? '—'} / ${open.area ?? '—'}`} />
              <Info label="CNIC no." value={open.cnicNumber ?? '—'} />
            </dl>

            {open.headline && <p className="text-xs text-slate-700">{open.headline}</p>}

            {open.degrees.length > 0 && (
              <div className="space-y-1">
                <p className="text-[11px] font-bold text-tm-navy">Degrees claimed</p>
                <ul className="text-[11px] text-gray-600 space-y-0.5">
                  {open.degrees.map((d) => (
                    <li key={d}>• {d}</li>
                  ))}
                </ul>
              </div>
            )}

            {open.videoYoutubeId && (
              <div className="space-y-2">
                <a
                  href={`https://www.youtube.com/watch?v=${open.videoYoutubeId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block text-center min-h-[44px] py-3 bg-tm-black text-white text-xs font-bold rounded-xl"
                >
                  Open introduction video ({open.videoVisibility}) ↗
                </a>

                {/* Publishing is a separate decision from approving, and a
                    separate permission. A verifier who may approve a video
                    still cannot put it in front of the public. */}
                {canSetVisibility && (
                  open.videoStatus === 'approved' ? (
                    <div className="space-y-1">
                      <p className="text-[11px] font-bold text-tm-navy">Visibility on YouTube</p>
                      <div className="grid grid-cols-3 gap-2">
                        {(['private', 'unlisted', 'public'] as const).map((v) => (
                          <button
                            key={v}
                            type="button"
                            disabled={busy || open.videoVisibility === v}
                            onClick={() => setVisibility(v)}
                            className={`min-h-[44px] rounded-xl text-xs font-bold capitalize transition-colors ${
                              open.videoVisibility === v
                                ? 'bg-tm-green-deep text-white'
                                : 'border border-gray-200 text-slate-700'
                            }`}
                          >
                            {v}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <p className="text-[11px] text-gray-500">
                      Approve the video before it can be published.
                    </p>
                  )
                )}
              </div>
            )}

            {open.documents.length > 0 && (
              <div className="space-y-2">
                <p className="text-[11px] font-bold text-tm-navy">
                  Documents — watermarked previews, admin rights
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {open.documents.map((d) => (
                    <div key={d.id} className="space-y-1">
                      <p className="text-[10px] uppercase tracking-wider text-gray-500 font-bold">{d.kind}</p>
                      <SecureDocumentPreview documentId={d.id} alt={`${d.kind} preview`} />
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-1 pt-1">
              <label htmlFor="reason" className="text-[11px] font-bold text-tm-navy">
                Reason (required — recorded and shown to the tutor)
              </label>
              <textarea
                id="reason"
                rows={2}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="w-full min-h-[44px] p-3 bg-tm-bg border border-gray-200 rounded-xl text-sm outline-none focus:border-tm-navy"
              />
            </div>

            {err && <p className="text-[11px] font-bold text-tm-red">{err}</p>}

            {open.videoAttempts >= MAX_ATTEMPTS && (
              <p className="text-[11px] font-bold text-tm-gold-ink bg-tm-tint-gold border border-tm-gold/30 rounded-xl p-2.5">
                This tutor has used all {MAX_ATTEMPTS} video submissions — resubmission is locked.
              </p>
            )}

            <div className="grid grid-cols-3 gap-2">
              <button onClick={() => act('approve')} disabled={busy} className="min-h-[44px] py-3 bg-tm-green-deep hover:bg-tm-green-deep-hover text-white text-xs font-bold rounded-xl disabled:opacity-50">
                Approve
              </button>
              <button onClick={() => act('hold')} disabled={busy} className="min-h-[44px] py-3 bg-tm-gold hover:bg-tm-gold-hover text-tm-black text-xs font-bold rounded-xl disabled:opacity-50">
                Hold
              </button>
              {open.verificationStatus === 'suspended' ? (
                <button onClick={() => act('unsuspend')} disabled={busy} className="min-h-[44px] py-3 bg-tm-black text-white text-xs font-bold rounded-xl disabled:opacity-50">
                  Unsuspend
                </button>
              ) : (
                <button onClick={() => act('suspend')} disabled={busy} className="min-h-[44px] py-3 bg-tm-red hover:bg-tm-red-hover text-white text-xs font-bold rounded-xl disabled:opacity-50">
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
    <div className="bg-tm-bg border border-gray-100 rounded-xl p-2">
      <dt className="text-[10px] uppercase tracking-wider text-gray-500 font-bold">{label}</dt>
      <dd className="text-[11px] font-bold text-tm-navy capitalize truncate">{value}</dd>
    </div>
  )
}

function StatusPill({ status, videoStatus }: { status: string; videoStatus: string }) {
  const cls =
    status === 'suspended'
      ? 'bg-tm-tint-red text-tm-red border-tm-red/30'
      : status === 'verified'
        ? 'bg-tm-tint-green text-tm-green-deep border-tm-green-deep/30'
        : videoStatus === 'uploaded'
          ? 'bg-tm-tint-gold text-tm-gold-ink border-tm-gold/30'
          : 'bg-gray-50 text-gray-600 border-gray-200'
  return (
    <span className={`shrink-0 px-2 py-1 rounded-lg border text-[10px] font-bold capitalize ${cls}`}>
      {status === 'pending' && videoStatus === 'uploaded' ? 'review' : status}
    </span>
  )
}
