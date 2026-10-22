'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Loader2, MessageCircle, Search, Sparkles } from 'lucide-react'

import { adminFetch } from '@/components/admin/adminFetch'
import { useToast } from '@/components/ui/Toast'
import { formatDate } from '@/lib/datetime'
import type { BoardRow, StaffOption } from '@/lib/applicationTracking'
import {
  mayEditStage,
  overdueFlag,
  OVERDUE_LABEL,
  STAGE_LABEL,
  STAGES,
  successStoryAction,
  timeAtStage,
  type Stage,
} from '@/lib/applicationStageCore'

// Follow-ups → Applications (owner, 22 Oct 2026). One row per application:
// tutor (masked phone), tuition, owner, stage, how long at that stage, and a
// WhatsApp check-in. Overdue rows come first (the server sorts). The Owner
// changes any stage and reassigns owners; everyone else changes stages only on
// their own tuitions, and sees the rest read-only. The server checks all of it.

const STEP = 48
const UNASSIGNED = '__unassigned__'

type OtherOpen = { id: string; tutorName: string; stage: Stage }

export default function ApplicationsClient({
  rows,
  staff,
  actor,
  nowMs,
}: {
  rows: BoardRow[]
  staff: StaffOption[]
  actor: { id: string; adminRole: string }
  /** The server's clock, so "3 days" reads the same on both renders. */
  nowMs: number
}) {
  const router = useRouter()
  const toast = useToast()
  const isOwner = actor.adminRole === 'owner'
  const [q, setQ] = useState('')
  const [shown, setShown] = useState(STEP)
  const [busy, setBusy] = useState<string | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [bulkOwner, setBulkOwner] = useState('')
  const [hire, setHire] = useState<{ row: BoardRow; others: OtherOpen[]; close: Set<string> } | null>(null)

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return rows
    return rows.filter((r) => [r.tutorName, r.jobTitle, r.jobRef, r.jobCity, r.ownerName].some((v) => (v ?? '').toLowerCase().includes(needle)))
  }, [rows, q])
  const visible = filtered.slice(0, shown)

  async function saveStage(row: BoardRow, stage: Stage, alsoNotSelected: string[] = []) {
    setBusy(row.id)
    const { ok, data } = await adminFetch<{ error?: string; changed?: number }>('/api/admin/applications/stage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ applicationId: row.id, stage, alsoNotSelected }),
    })
    setBusy(null)
    if (!ok) return toast.error(data?.error ?? 'That did not save. Please try again.')
    toast.success(`${row.tutorName}: ${STAGE_LABEL[stage]}${alsoNotSelected.length ? ` · ${alsoNotSelected.length} marked Not selected` : ''}`)
    router.refresh()
  }

  async function onStage(row: BoardRow, stage: Stage) {
    if (stage === row.stage) return
    if (stage !== 'hired') return saveStage(row, stage)
    setBusy(row.id)
    const { ok, data } = await adminFetch<{ others?: OtherOpen[]; error?: string }>(`/api/admin/applications/others?applicationId=${row.id}`)
    setBusy(null)
    if (!ok) return toast.error(data?.error ?? 'That did not load. Please try again.')
    setHire({ row, others: data?.others ?? [], close: new Set() })
  }

  async function reassign(jobIds: string[], staffId: string | null) {
    setBusy('owner')
    const { ok, data } = await adminFetch<{ error?: string; changed?: number }>('/api/admin/applications/owner', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobIds, staffId }),
    })
    setBusy(null)
    if (!ok) return toast.error(data?.error ?? 'That did not save. Please try again.')
    toast.success(`Owner changed on ${data?.changed ?? 0} ${(data?.changed ?? 0) === 1 ? 'tuition' : 'tuitions'}`)
    setPicked(new Set())
    router.refresh()
  }

  const pickedJobs = [...new Set(rows.filter((r) => picked.has(r.id)).map((r) => r.jobId))]

  return (
    <div className="space-y-3">
      <label className="relative block">
        <span className="sr-only">Search applications</span>
        <Search aria-hidden size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
        <input
          type="search"
          value={q}
          onChange={(e) => {
            setQ(e.target.value)
            setShown(STEP)
          }}
          placeholder="Search by tutor, tuition, TM number, city or owner"
          className="min-h-[44px] w-full rounded-xl border border-gray-200 bg-white pl-9 pr-3 text-xs outline-none focus:border-tm-navy"
        />
      </label>

      {isOwner && pickedJobs.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-tm-navy/30 bg-tm-tint-navy p-3 text-xs">
          <span className="font-bold text-tm-navy">
            {pickedJobs.length} {pickedJobs.length === 1 ? 'tuition' : 'tuitions'} selected
          </span>
          <select
            aria-label="New owner"
            value={bulkOwner}
            onChange={(e) => setBulkOwner(e.target.value)}
            className="min-h-[40px] rounded-lg border border-gray-200 bg-white px-2 text-xs"
          >
            <option value="">Choose owner…</option>
            <option value={UNASSIGNED}>Unassigned</option>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={!bulkOwner || busy === 'owner'}
            onClick={() => reassign(pickedJobs, bulkOwner === UNASSIGNED ? null : bulkOwner)}
            className="inline-flex min-h-[40px] items-center rounded-lg bg-tm-navy px-3 font-bold text-white disabled:opacity-50"
          >
            Reassign
          </button>
          <button type="button" onClick={() => setPicked(new Set())} className="min-h-[40px] px-2 font-bold text-tm-navy underline">
            Clear
          </button>
        </div>
      )}

      {filtered.length === 0 ? (
        <p className="rounded-2xl border border-gray-200 bg-white p-6 text-center text-xs text-gray-600">
          {q.trim() ? 'Nothing here matches that search.' : 'No applications here.'}
        </p>
      ) : (
        <ul className="space-y-2">
          {visible.map((r) => {
            const flag = overdueFlag(r.stage, r.stageChangedAt, nowMs)
            const editable = mayEditStage(actor, r.ownerId)
            return (
              <li key={r.id} className="space-y-2 rounded-2xl border border-gray-200 bg-white p-3 text-xs">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="flex min-w-0 items-start gap-2">
                    {isOwner && (
                      <input
                        type="checkbox"
                        aria-label={`Select ${r.jobTitle}`}
                        checked={picked.has(r.id)}
                        onChange={(e) => {
                          const next = new Set(picked)
                          if (e.target.checked) next.add(r.id)
                          else next.delete(r.id)
                          setPicked(next)
                        }}
                        className="mt-1 h-4 w-4"
                      />
                    )}
                    <div className="min-w-0 space-y-0.5">
                      <p className="font-black text-tm-navy">
                        {r.tutorName}
                        {r.tutorPhone && <span className="ms-2 font-mono font-semibold text-slate-700">{r.tutorPhone}</span>}
                      </p>
                      <p className="text-slate-700">
                        {r.jobRef && <span className="me-1 rounded bg-tm-tint-navy px-1 py-0.5 text-[10px] font-black text-tm-navy">{r.jobRef}</span>}
                        <Link href={`/admin/jobs/${r.jobId}`} className="font-bold hover:underline">
                          {r.jobTitle}
                        </Link>
                        {r.jobCity && <span className="text-gray-600"> · {r.jobCity}</span>}
                      </p>
                    </div>
                  </div>
                  {flag && (
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-black ${
                        flag === 'forward_overdue' ? 'bg-tm-tint-red text-tm-red' : 'bg-tm-tint-gold text-tm-gold-ink'
                      }`}
                    >
                      {OVERDUE_LABEL[flag]}
                    </span>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {editable ? (
                    <select
                      aria-label={`Stage for ${r.tutorName}`}
                      value={r.stage}
                      disabled={busy === r.id}
                      onChange={(e) => onStage(r, e.target.value as Stage)}
                      className="min-h-[40px] rounded-lg border border-gray-200 bg-white px-2 text-xs font-bold text-tm-navy"
                    >
                      {STAGES.map((s) => (
                        <option key={s} value={s}>
                          {STAGE_LABEL[s]}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="inline-flex min-h-[40px] items-center rounded-lg bg-tm-bg px-2 font-bold text-slate-700" title="Read only">
                      {STAGE_LABEL[r.stage]}
                    </span>
                  )}
                  {busy === r.id && <Loader2 aria-hidden size={14} className="animate-spin text-gray-500" />}
                  <span className="text-gray-600">
                    {timeAtStage(r.stageChangedAt, nowMs)} at this stage{r.stageChangedByName ? ` · by ${r.stageChangedByName}` : ''}
                  </span>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-gray-600">
                    Owner:{' '}
                    {isOwner ? (
                      <select
                        aria-label={`Owner of ${r.jobTitle}`}
                        value={r.ownerId ?? UNASSIGNED}
                        disabled={busy === 'owner'}
                        onChange={(e) => reassign([r.jobId], e.target.value === UNASSIGNED ? null : e.target.value)}
                        className="min-h-[36px] rounded-lg border border-gray-200 bg-white px-1 text-xs font-bold text-tm-navy"
                      >
                        <option value={UNASSIGNED}>Unassigned</option>
                        {staff.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                        {r.ownerId && !staff.some((s) => s.id === r.ownerId) && <option value={r.ownerId}>{r.ownerName}</option>}
                      </select>
                    ) : (
                      <span className="font-bold text-slate-700">{r.ownerName ?? 'Unassigned'}</span>
                    )}
                    <span className="ms-2">Applied {formatDate(r.createdAt)}</span>
                  </span>
                  <span className="flex flex-wrap gap-2">
                    {(() => {
                      const story = successStoryAction(r)
                      if (!story) return null
                      return 'href' in story ? (
                        <Link href={story.href} className="inline-flex min-h-[40px] items-center gap-1 rounded-lg border border-tm-navy px-3 font-bold text-tm-navy">
                          <Sparkles aria-hidden size={14} /> Success story
                        </Link>
                      ) : (
                        <span className="inline-flex min-h-[40px] items-center rounded-lg bg-tm-bg px-3 font-bold text-gray-600">{story.label}</span>
                      )
                    })()}
                    {r.tutorPhone && (
                      <a
                        href={`/api/admin/applications/whatsapp?applicationId=${r.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex min-h-[40px] items-center gap-1 rounded-lg bg-tm-green-deep px-3 font-bold text-white"
                      >
                        <MessageCircle aria-hidden size={14} /> WhatsApp
                      </a>
                    )}
                  </span>
                </div>
              </li>
            )
          })}
        </ul>
      )}
      {filtered.length > visible.length && (
        <button
          type="button"
          onClick={() => setShown((n) => n + STEP)}
          className="mx-auto block min-h-[44px] rounded-xl border border-gray-200 bg-white px-4 text-xs font-bold text-tm-navy"
        >
          Show more ({filtered.length - visible.length} left)
        </button>
      )}

      {hire && (
        <div role="dialog" aria-modal="true" aria-labelledby="hire-title" className="fixed inset-0 z-50 flex items-center justify-center bg-tm-black/50 p-4">
          <div className="w-full max-w-md space-y-3 rounded-2xl bg-white p-4 text-xs">
            <h2 id="hire-title" className="text-sm font-black text-tm-navy">
              Mark {hire.row.tutorName} as Hired?
            </h2>
            <p className="text-slate-700">This changes the application only. The tuition stays exactly as it is.</p>
            {hire.others.length > 0 ? (
              <fieldset className="space-y-1">
                <legend className="mb-1 font-bold text-slate-700">
                  Also mark the tuition&apos;s other open applications as Not selected? (Leave unticked to keep them.)
                </legend>
                {hire.others.map((o) => (
                  <label key={o.id} className="flex min-h-[36px] items-center gap-2">
                    <input
                      type="checkbox"
                      checked={hire.close.has(o.id)}
                      onChange={(e) => {
                        const next = new Set(hire.close)
                        if (e.target.checked) next.add(o.id)
                        else next.delete(o.id)
                        setHire({ ...hire, close: next })
                      }}
                      className="h-4 w-4"
                    />
                    {o.tutorName} <span className="text-gray-600">({STAGE_LABEL[o.stage]})</span>
                  </label>
                ))}
              </fieldset>
            ) : (
              <p className="text-gray-600">No other open applications on this tuition.</p>
            )}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setHire(null)} className="min-h-[44px] rounded-xl border border-gray-200 px-4 font-bold text-slate-700">
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  const h = hire
                  setHire(null)
                  void saveStage(h.row, 'hired', [...h.close])
                }}
                className="min-h-[44px] rounded-xl bg-tm-navy px-4 font-bold text-white"
              >
                Mark as Hired
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
