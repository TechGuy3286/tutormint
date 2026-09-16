'use client'
import { Ban, Check, Pause, RotateCcw } from 'lucide-react'

import Avatar from '@/components/Avatar'
import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import InfiniteFooter from '@/components/InfiniteFooter'
import QueueSearch from '@/components/admin/QueueSearch'
import SecureDocumentPreview from '@/components/SecureDocumentPreview'
import StatusChip from '@/components/admin/StatusChip'
import { useInfinite } from '@/lib/useInfinite'
import { submitJson, submitSignal } from '@/lib/submit'
import { useToast } from '@/components/ui/Toast'
import { useConfirm } from '@/components/ui/ConfirmDialog'
import type { QueueTutorRow } from '@/lib/adminQueues'
import { BLOCKER_LABEL } from '@/lib/tutorListingStatus'

// The row shape is defined once, beside the query that builds it. A type-only
// import is erased at compile time, so nothing from that server-only module
// reaches the browser bundle.
export type QueueTutor = QueueTutorRow

const FILTERS = [
  { key: 'pending', label: 'Pending video' },
  { key: 'all', label: 'All' },
  { key: 'suspended', label: 'Suspended' },
]

const MAX_ATTEMPTS = 3

export default function TutorModerationClient({
  tutors,
  filter,
  search,
  canSetVisibility,
  canRevealCnic,
  canClearMobile,
  initialCursor,
  total,
}: {
  tutors: QueueTutor[]
  filter: string
  search: string
  /** Only owner/admin may publish a video; operations sees the state, not the control. */
  canSetVisibility: boolean
  /** Owner + Admin may reveal a full CNIC number (logged). */
  canRevealCnic: boolean
  /** Owner only may clear a number's verification (§1.5). */
  canClearMobile: boolean
  initialCursor: string | null
  total: number
}) {
  const router = useRouter()
  // The server rendered the first window; this only ever appends to it. The
  // filter AND the search term are part of the storage key and the load-more
  // params, so returning to a DIFFERENT tab or query never restores the
  // previous one's rows, and load-more keeps the same filter the server did.
  const more = useInfinite<QueueTutor>({
    endpoint: '/api/admin/queues/tutors',
    params: { filter, ...(search ? { search } : {}) },
    initialCursor,
    storageKey: `tm:more:admin-tutors:${filter}:${search}`,
  })
  const all = [...tutors, ...more.items]
  const [open, setOpen] = useState<QueueTutor | null>(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  // The full CNIC, once an owner/admin taps "Show" (logged). Reset on open.
  const [revealedCnic, setRevealedCnic] = useState<string | null>(null)
  const toast = useToast()
  const confirm = useConfirm()

  async function revealCnic() {
    if (!open) return
    const { ok, data, error } = await submitJson<{ cnicNumber: string | null }>(
      '/api/admin/tutors/cnic-reveal',
      { tutorId: open.id },
    )
    if (!ok) {
      toast.error(error ?? 'Could not reveal the number.')
      return
    }
    setRevealedCnic(data?.cnicNumber ?? '—')
  }

  async function clearMobile() {
    if (!open) return
    const okc = await confirm({
      title: `Clear ${open.fullName ?? 'this tutor'}'s mobile verification?`,
      body: 'This removes the verified status of their number from THIS account, so the same number can stay verified on the other account. The number is kept; they can re-verify later.',
      confirmLabel: 'Clear verification',
    })
    if (!okc) return
    setBusy(true)
    const { ok, error } = await submitJson('/api/admin/tutors/clear-mobile', { tutorId: open.id })
    setBusy(false)
    if (!ok) {
      toast.error(error ?? 'Could not clear the verification.')
      return
    }
    toast.success('Mobile verification cleared.')
    setOpen(null)
    router.refresh()
  }

  async function setVisibility(visibility: 'private' | 'unlisted' | 'public') {
    if (!open) return
    setBusy(true)
    setErr('')
    setMsg('')
    try {
      const res = await fetch('/api/admin/tutors/video-visibility', { signal: submitSignal(),
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tutorId: open.id, visibility }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'That did not work.')
      // Say what actually happened. Without YOUTUBE_* credentials the choice is
      // recorded here and NOT applied on YouTube, and a green tick would be a lie.
      const note = json.note ?? `Video is now ${visibility} on YouTube.`
      setMsg(note)
      toast.success(note)
      setOpen({ ...open, videoVisibility: visibility })
      router.refresh()
    } catch (e) {
      const message = e instanceof Error ? e.message : 'That did not work.'
      setErr(message)
      toast.error(message)
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
    if (action === 'suspend') {
      const ok = await confirm({
        title: `Suspend ${open.fullName ?? 'this tutor'}?`,
        body: 'They are delisted at once and lose posting, applying, contact and badges. Nothing is deleted; you can reinstate later.',
        confirmLabel: 'Suspend',
      })
      if (!ok) return
    }
    setBusy(true)
    setErr('')
    setMsg('')

    // See the parent queue for why this is not a bare fetch: a throw on the
    // json parse skipped setBusy(false) and left the decision button spinning.
    const { ok, data, error: failed } = await submitJson<{ resubmissionLocked?: boolean }>(
      '/api/admin/tutors/moderate',
      { tutorId: open.id, action, reason: reason.trim() },
    )
    setBusy(false)

    if (!ok) {
      setErr(failed ?? 'Action failed.')
      toast.error(failed ?? 'Action failed.')
      return
    }

    const message =
      `${action} recorded.` +
      (data?.resubmissionLocked ? ' Resubmission is now locked (3 strikes).' : '')
    setMsg(message)
    toast.success(message)
    setReason('')
    setOpen(null)
    router.refresh()
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-500">
        Every decision needs a written reason and is recorded in the audit log.
      </p>

      <QueueSearch
        basePath="/admin/tutors"
        initialQuery={search}
        filter={filter}
        placeholder="Name, email, city, headline or slug"
        ariaLabel="Search tutors"
      />

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

      {all.length === 0 ? (
        <p className="bg-white border border-gray-200 rounded-2xl p-6 text-center text-xs font-bold text-gray-500">
          Nothing in this queue.
        </p>
      ) : (
        <ul className="space-y-2">
          {all.map((t) => (
            <li key={t.id}>
              <button
                onClick={() => {
                  setOpen(t)
                  setReason('')
                  setErr('')
                  setRevealedCnic(null)
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
                    {t.city ?? '—'} · {t.completion}% complete
                    {t.completion < 100 && t.missing.length > 0
                      ? ` · ${t.missing.length} item${t.missing.length === 1 ? '' : 's'} missing`
                      : ''}{' '}
                    · {t.videoAttempts}/{MAX_ATTEMPTS} video
                  </p>
                  {/* Public-directory status (migration 87): why a tutor is or is
                      not visible in browse/search, without a SQL client. */}
                  {t.listed ? (
                    <p className="mt-0.5 text-[10px] font-bold text-tm-green-deep">Listed in search</p>
                  ) : (
                    <p className="mt-0.5 truncate text-[10px] font-bold text-tm-gold-ink">
                      Not listed · {t.blockers.map((b) => BLOCKER_LABEL[b]).join(', ')}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <CnicPill
                    status={t.verificationStatus}
                    hasCnic={!!t.cnicNumber || t.documents.some((d) => d.kind === 'cnic')}
                  />
                  {t.duplicateMobile && (
                    <span className="inline-flex items-center rounded-full bg-tm-tint-red px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-tm-red">
                      Duplicate mobile
                    </span>
                  )}
                </div>
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
          noun="tutors"
        />
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
                {/* Every member name is a link. In admin it goes to the admin
                    record, not the marketing page -- nobody clicking a name in
                    a moderation queue is asking for a public profile. */}
                <Link
                  href={`/admin/tutors/${open.id}`}
                  className="block truncate text-base font-black text-tm-navy hover:text-tm-red hover:underline"
                >
                  {open.fullName}
                </Link>
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
              <Info label="CNIC no." value={revealedCnic ?? open.cnicNumber ?? '—'} />
            </dl>

            {/* One verified number per account (owner PR8 §1.5). When this
                tutor's number is verified on another account, the owner can clear
                it from THIS account so the number stays on the other. */}
            {open.duplicateMobile && (
              <div className="space-y-2 rounded-xl border border-tm-red/30 bg-tm-tint-red p-3">
                <p className="text-[11px] font-black text-tm-red">
                  This mobile number is verified on more than one account.
                </p>
                {canClearMobile ? (
                  <button
                    type="button"
                    onClick={() => void clearMobile()}
                    disabled={busy}
                    className="inline-flex min-h-[44px] items-center justify-center rounded-xl bg-tm-red px-4 text-xs font-bold text-white hover:bg-tm-red-hover disabled:opacity-50"
                  >
                    Clear this number&rsquo;s verification
                  </button>
                ) : (
                  <p className="text-[11px] font-semibold text-tm-red">
                    Only the owner can clear a number&rsquo;s verification.
                  </p>
                )}
              </div>
            )}

            {/* Why this tutor is not at 100% — the same checklist the tutor sees,
                so an admin can tell them exactly what is outstanding. A tutor is
                only listed at 100%, so this is the list of what keeps them
                unfindable. */}
            {open.completion < 100 && open.missing.length > 0 && (
              <div className="rounded-xl border border-gray-200 bg-tm-bg p-3">
                <p className="mb-1.5 text-[11px] font-black text-slate-700">
                  Missing to reach 100% ({open.missing.length})
                </p>
                <ul className="flex flex-wrap gap-1.5">
                  {open.missing.map((m) => (
                    <li
                      key={m.key}
                      className="rounded-full border border-gray-200 bg-white px-2 py-0.5 text-[10px] font-semibold text-slate-700"
                    >
                      {m.label}
                    </li>
                  ))}
                </ul>
              </div>
            )}

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
                    separate permission. Operations, who may approve a video
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

            {open.documents.length > 0 && (() => {
              // Latest front + latest back only; older uploads collapse under
              // "Earlier uploads" (owner PR8 §3.2), so a re-uploaded side does
              // not show the card twice.
              const { latest, earlier } = dedupeDocs(open.documents)
              return (
                <div className="space-y-2">
                  {/* THE NUMBER SITS WITH THE IMAGES — checking a card is comparing
                      the typed digits against the photograph. Masked by default
                      (owner PR8 §3.3); Owner/Admin reveal the full number with a
                      logged "Show". Operations sees only the mask. */}
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="text-[11px] font-bold text-tm-navy">
                      Documents — watermarked previews, admin rights
                    </p>
                    <span className="flex items-center gap-2">
                      <span className="font-mono text-xs font-black text-tm-navy">
                        {revealedCnic ?? open.cnicNumber ?? 'no CNIC number typed'}
                      </span>
                      {canRevealCnic && !revealedCnic && open.cnicNumber && (
                        <button
                          type="button"
                          onClick={() => void revealCnic()}
                          className="rounded-lg border border-gray-200 px-2 py-1 text-[10px] font-bold text-tm-navy hover:border-tm-navy"
                        >
                          Show
                        </button>
                      )}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {latest.map((d) => (
                      <div key={d.id} className="space-y-1">
                        <p className="text-[10px] uppercase tracking-wider text-gray-500 font-bold">
                          {docLabel(d)}
                        </p>
                        <SecureDocumentPreview documentId={d.id} alt={`${d.kind} preview`} />
                      </div>
                    ))}
                  </div>
                  {earlier.length > 0 && (
                    <details className="rounded-xl border border-gray-200 bg-tm-bg p-2">
                      <summary className="cursor-pointer text-[11px] font-bold text-gray-500">
                        Earlier uploads ({earlier.length})
                      </summary>
                      <div className="mt-2 grid grid-cols-2 gap-2">
                        {earlier.map((d) => (
                          <div key={d.id} className="space-y-1">
                            <p className="text-[10px] uppercase tracking-wider text-gray-500 font-bold">
                              {docLabel(d)}
                            </p>
                            <SecureDocumentPreview documentId={d.id} alt={`${d.kind} preview`} />
                          </div>
                        ))}
                      </div>
                    </details>
                  )}
                </div>
              )
            })()}

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
              <button onClick={() => act('approve')} disabled={busy} className="inline-flex items-center justify-center gap-1.5 min-h-[44px] py-3 bg-tm-green-deep hover:bg-tm-green-deep-hover text-white text-xs font-bold rounded-xl disabled:opacity-50">
                <Check aria-hidden size={13} />
                Approve
              </button>
              <button onClick={() => act('hold')} disabled={busy} className="inline-flex items-center justify-center gap-1.5 min-h-[44px] py-3 bg-tm-gold hover:bg-tm-gold-hover text-tm-black text-xs font-bold rounded-xl disabled:opacity-50">
                <Pause aria-hidden size={13} />
                Hold
              </button>
              {open.verificationStatus === 'suspended' ? (
                <button onClick={() => act('unsuspend')} disabled={busy} className="inline-flex items-center justify-center gap-1.5 min-h-[44px] py-3 bg-tm-black text-white text-xs font-bold rounded-xl disabled:opacity-50">
                  <RotateCcw aria-hidden size={13} />
                  Unsuspend
                </button>
              ) : (
                <button onClick={() => act('suspend')} disabled={busy} className="inline-flex items-center justify-center gap-1.5 min-h-[44px] py-3 bg-tm-red hover:bg-tm-red-hover text-white text-xs font-bold rounded-xl disabled:opacity-50">
                  <Ban aria-hidden size={13} />
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

type DocRow = QueueTutor['documents'][number]

/** "CNIC front" / "CNIC back" / the raw kind for a degree. */
function docLabel(d: DocRow): string {
  return d.kind === 'cnic' ? `CNIC ${d.label === 'back' ? 'back' : 'front'}` : d.kind
}

/** Split documents into the latest per (kind, CNIC side) and the older ones
 *  (owner PR8 §3.2). Degrees are keyed by id so each is kept. Newest first. */
function dedupeDocs(docs: DocRow[]): { latest: DocRow[]; earlier: DocRow[] } {
  const sorted = [...docs].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
  const latest: DocRow[] = []
  const earlier: DocRow[] = []
  const seen = new Set<string>()
  for (const d of sorted) {
    const key =
      d.kind === 'cnic' ? `cnic:${d.label === 'back' ? 'back' : 'front'}` : `${d.kind}:${d.id}`
    if (seen.has(key)) earlier.push(d)
    else {
      seen.add(key)
      latest.push(d)
    }
  }
  return { latest, earlier }
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-tm-bg border border-gray-100 rounded-xl p-2">
      <dt className="text-[10px] uppercase tracking-wider text-gray-500 font-bold">{label}</dt>
      <dd className="text-[11px] font-bold text-tm-navy capitalize truncate">{value}</dd>
    </div>
  )
}

// The CNIC review status pill (owner PR8 §3.1). It used to render the tutor's
// verification_status, so an approved-CNIC-but-fee-unpaid tutor showed "VERIFIED"
// — which reads as fully listed when they are not. It now names the CNIC state
// only; the listing status ("Listed in search" / "Not listed · …") stays on its
// own line in the row.
function CnicPill({ status, hasCnic }: { status: string; hasCnic: boolean }) {
  if (status === 'suspended') return <StatusChip tone="bad" status="suspended" label="Suspended" />
  if (status === 'verified') return <StatusChip tone="good" status="approved" label="CNIC approved" />
  if (status === 'rejected') return <StatusChip tone="bad" status="rejected" label="CNIC rejected" />
  if (hasCnic) return <StatusChip tone="pending" status="submitted" label="CNIC pending" />
  return <StatusChip tone="neutral" status="none" label="No CNIC" />
}
