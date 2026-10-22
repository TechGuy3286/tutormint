'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ChevronDown, Loader2, MessageCircle, Search, Send, Sparkles } from 'lucide-react'

import { adminFetch } from '@/components/admin/adminFetch'
import { useToast } from '@/components/ui/Toast'
import { setUrlParam } from '@/lib/useUrlState'
import type { BoardRow, StaffOption } from '@/lib/applicationTracking'
import {
  APPLICATIONS_PATH,
  groupBoard,
  groupCountLine,
  isWorked,
  itemOverdue,
  matchesStaff,
  mayEditStage,
  OVERDUE_LABEL,
  searchMatches,
  shortTitle,
  STAGE_LABEL,
  STAGES,
  staffChoices,
  successStoryAction,
  timeAtStage,
  workedLine,
  type BoardGroup,
  type Stage,
  type StaffFilter,
} from '@/lib/applicationStageCore'

// Tuitions → Applications (owner, 22 Oct 2026). One compact row per
// application, grouped by tuition. Overdue groups first (oldest first), then
// groups with something not yet worked, then fully worked groups (most
// recently worked last). Worked rows are muted and sink to the bottom of their
// group. Tuitions posted more than 30 days ago are in the collapsed "Older"
// section. The search covers every application whatever the filters, and
// highlights what it finds. The server checks every change (own tuitions only;
// the Owner any; only the Owner reassigns).

const UNASSIGNED = '__unassigned__'
const CTRL = 'min-h-[40px] sm:min-h-[24px] sm:py-0 rounded-md border border-gray-200 bg-white px-1.5 text-[11px] font-bold text-tm-navy'

type OtherOpen = { id: string; tutorName: string; stage: Stage }

function hrefWith(staff: StaffFilter, stage: Stage | 'any'): string {
  const q = new URLSearchParams()
  q.set('staff', staff)
  if (stage !== 'any') q.set('show', stage)
  return `${APPLICATIONS_PATH}?${q.toString()}`
}

export default function ApplicationsClient({
  rows,
  staff,
  ownerNames,
  actor,
  staffFilter,
  stageFilter,
  initialQuery,
  nowMs,
}: {
  rows: BoardRow[]
  staff: StaffOption[]
  ownerNames: Record<string, string>
  actor: { id: string; adminRole: string }
  staffFilter: StaffFilter
  stageFilter: Stage | 'any'
  initialQuery: string
  /** The server's clock, so "3 days" reads the same on both renders. */
  nowMs: number
}) {
  const router = useRouter()
  const toast = useToast()
  const isOwner = actor.adminRole === 'owner'
  const [q, setQ] = useState(initialQuery)
  const [busy, setBusy] = useState<string | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [bulkOwner, setBulkOwner] = useState('')
  const [hire, setHire] = useState<{ row: BoardRow; others: OtherOpen[]; close: Set<string> } | null>(null)
  const [olderOpen, setOlderOpen] = useState(false)

  const names = useMemo(() => new Map(Object.entries(ownerNames)), [ownerNames])
  const choices = useMemo(() => staffChoices(rows, names, actor), [rows, names, actor])
  const byStaff = useMemo(() => rows.filter((r) => matchesStaff(r, staffFilter)), [rows, staffFilter])
  const stageCounts = useMemo(() => {
    const c: Record<string, number> = { any: byStaff.length }
    for (const s of STAGES) c[s] = 0
    for (const r of byStaff) c[r.stage]++
    return c
  }, [byStaff])
  const allByJob = useMemo(() => {
    const m = new Map<string, BoardRow[]>()
    for (const r of rows) m.set(r.jobId, [...(m.get(r.jobId) ?? []), r])
    return m
  }, [rows])

  const searching = q.trim().length > 0
  const hits = useMemo(() => new Set(searching ? rows.filter((r) => searchMatches(r, q)).map((r) => r.id) : []), [rows, q, searching])
  // While searching: every application (filters set aside), only the ones found.
  const listed = searching ? rows.filter((r) => hits.has(r.id)) : byStaff.filter((r) => stageFilter === 'any' || r.stage === stageFilter)
  const { main, older } = useMemo(() => groupBoard(listed, nowMs), [listed, nowMs])
  const showOlder = olderOpen || (searching && older.length > 0)
  const olderCount = older.reduce((n, g) => n + g.rows.length, 0)

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

  function renderGroup(g: BoardGroup<BoardRow>) {
    const head = g.rows[0]
    const all = allByJob.get(g.jobId) ?? g.rows
    return (
      <li key={g.jobId} className={`overflow-hidden rounded-xl border ${g.state === 'overdue' ? 'border-tm-red/30' : 'border-gray-200'} bg-white`}>
        <div className={`flex flex-wrap items-center gap-x-2 gap-y-0.5 px-2 py-1 text-[11px] ${g.state === 'worked' ? 'bg-tm-bg' : 'bg-tm-tint-navy'}`}>
          {isOwner && (
            <input
              type="checkbox"
              aria-label={`Select ${head.jobTitle}`}
              checked={picked.has(g.jobId)}
              onChange={(e) => {
                const next = new Set(picked)
                if (e.target.checked) next.add(g.jobId)
                else next.delete(g.jobId)
                setPicked(next)
              }}
              className="h-4 w-4"
            />
          )}
          {head.jobRef && <span className="rounded bg-tm-navy px-1 py-0.5 text-[10px] font-black text-white">{head.jobRef}</span>}
          <Link href={`/admin/jobs/${g.jobId}`} title={head.jobTitle} className="min-w-0 font-black text-tm-navy hover:underline">
            {shortTitle(head.jobTitle, 60)}
          </Link>
          {head.jobCity && <span className="text-gray-600">{head.jobCity}</span>}
          <span className="text-gray-600">
            ·{' '}
            {isOwner ? (
              <select
                aria-label={`Owner of ${head.jobTitle}`}
                value={head.ownerId ?? UNASSIGNED}
                disabled={busy === 'owner'}
                onChange={(e) => reassign([g.jobId], e.target.value === UNASSIGNED ? null : e.target.value)}
                className={CTRL}
              >
                <option value={UNASSIGNED}>Unassigned</option>
                {staff.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
                {head.ownerId && !staff.some((s) => s.id === head.ownerId) && <option value={head.ownerId}>{head.ownerName}</option>}
              </select>
            ) : (
              <span className="font-bold text-slate-700">{head.ownerName ?? 'Unassigned'}</span>
            )}
          </span>
          <span className="font-bold text-slate-700">{groupCountLine(all.map((r) => r.stage))}</span>
          <Link
            href={`${APPLICATIONS_PATH}?view=forward`}
            className="ms-auto inline-flex min-h-[40px] items-center gap-1 rounded-md border border-tm-navy px-2 font-bold text-tm-navy sm:min-h-[24px]"
          >
            <Send aria-hidden size={12} /> Forward to parents
          </Link>
        </div>
        <ul className="divide-y divide-gray-100">{g.rows.map(renderRow)}</ul>
      </li>
    )
  }

  function renderRow(r: BoardRow) {
    const flag = itemOverdue(r, nowMs)
    const worked = isWorked(r, nowMs)
    const editable = mayEditStage(actor, r.ownerId)
    const hit = hits.has(r.id)
    const story = successStoryAction(r)
    const updated = worked ? workedLine(r.workedAt, r.workedByName, nowMs) : null
    return (
      <li
        key={r.id}
        data-worked={worked ? 'yes' : undefined}
        className={`flex flex-wrap items-center gap-x-2 gap-y-0.5 px-2 py-0.5 text-[11px] ${hit ? 'bg-tm-tint-gold' : worked ? 'bg-tm-bg text-gray-600' : ''}`}
      >
        <span title={r.tutorName} className={`w-40 shrink-0 truncate font-bold ${worked ? 'text-gray-600' : 'text-tm-navy'}`}>{r.tutorName}</span>
        {r.tutorPhone && <span className="font-mono text-slate-600">{r.tutorPhone}</span>}
        {editable ? (
          <select
            aria-label={`Stage for ${r.tutorName}`}
            value={r.stage}
            disabled={busy === r.id}
            onChange={(e) => onStage(r, e.target.value as Stage)}
            className={CTRL}
          >
            {STAGES.map((s) => (
              <option key={s} value={s}>
                {STAGE_LABEL[s]}
              </option>
            ))}
          </select>
        ) : (
          <span className="rounded bg-tm-bg px-1.5 py-0.5 font-bold text-slate-700" title="Read only">
            {STAGE_LABEL[r.stage]}
          </span>
        )}
        {busy === r.id && <Loader2 aria-hidden size={12} className="animate-spin text-gray-500" />}
        <span className="text-gray-600">{timeAtStage(r.stageChangedAt, nowMs)}</span>
        {flag && (
          <span
            className={`rounded-full px-1.5 py-0.5 text-[10px] font-black ${
              flag === 'forward_overdue' ? 'bg-tm-tint-red text-tm-red' : 'bg-tm-tint-gold text-tm-gold-ink'
            }`}
          >
            {OVERDUE_LABEL[flag]}
          </span>
        )}
        {updated && <span className="italic text-gray-600">{updated}</span>}
        <span className="ms-auto flex items-center gap-1">
          {story &&
            ('href' in story ? (
              <Link href={story.href} className="inline-flex min-h-[40px] items-center gap-1 rounded-md border border-tm-navy px-2 font-bold text-tm-navy sm:min-h-[24px]">
                <Sparkles aria-hidden size={12} /> Success story
              </Link>
            ) : (
              <span className="inline-flex min-h-[40px] items-center rounded-md bg-tm-bg px-2 font-bold text-gray-600 sm:min-h-[24px]">{story.label}</span>
            ))}
          {r.tutorPhone && (
            <a
              href={`/api/admin/applications/whatsapp?applicationId=${r.id}`}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => window.setTimeout(() => router.refresh(), 1500)}
              className="inline-flex min-h-[40px] items-center gap-1 rounded-md bg-tm-green-deep px-2 font-bold text-white sm:min-h-[24px]"
            >
              <MessageCircle aria-hidden size={12} /> WhatsApp
            </a>
          )}
        </span>
      </li>
    )
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1 text-xs font-bold text-slate-700">
          Staff
          <select
            aria-label="Staff"
            value={staffFilter}
            onChange={(e) => router.push(hrefWith(e.target.value, stageFilter))}
            className="min-h-[40px] rounded-lg border border-gray-200 bg-white px-2 text-xs font-bold text-tm-navy"
          >
            {choices.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label} ({c.count})
              </option>
            ))}
          </select>
        </label>
        <label className="relative min-w-[14rem] flex-1">
          <span className="sr-only">Search applications</span>
          <Search aria-hidden size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            type="search"
            value={q}
            onChange={(e) => {
              setQ(e.target.value)
              setUrlParam('q', e.target.value.trim() || null)
            }}
            placeholder="Search everything: tutor, TM number, tuition or city"
            className="min-h-[40px] w-full rounded-lg border border-gray-200 bg-white pl-9 pr-3 text-xs outline-none focus:border-tm-navy"
          />
        </label>
      </div>

      <nav aria-label="Filter by stage" className="flex flex-wrap gap-1.5">
        {(['any', ...STAGES] as const).map((s) => (
          <Link
            key={s}
            href={hrefWith(staffFilter, s)}
            aria-current={s === stageFilter ? 'page' : undefined}
            className={`inline-flex min-h-[36px] items-center gap-1 rounded-full border px-3 text-[11px] font-bold ${
              s === stageFilter ? 'border-tm-navy bg-tm-navy text-white' : 'border-gray-200 bg-white text-tm-navy hover:border-tm-navy'
            }`}
          >
            {s === 'any' ? 'All stages' : STAGE_LABEL[s]} <span className={s === stageFilter ? 'text-white' : 'text-gray-500'}>{stageCounts[s]}</span>
          </Link>
        ))}
      </nav>

      {searching && (
        <p className="text-[11px] font-bold text-slate-700">
          {hits.size} {hits.size === 1 ? 'application' : 'applications'} found across every staff member, stage and the Older section.
        </p>
      )}

      {isOwner && picked.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-tm-navy/30 bg-tm-tint-navy p-2 text-xs">
          <span className="font-bold text-tm-navy">
            {picked.size} {picked.size === 1 ? 'tuition' : 'tuitions'} selected
          </span>
          <select aria-label="New owner" value={bulkOwner} onChange={(e) => setBulkOwner(e.target.value)} className="min-h-[40px] rounded-lg border border-gray-200 bg-white px-2 text-xs">
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
            onClick={() => reassign([...picked], bulkOwner === UNASSIGNED ? null : bulkOwner)}
            className="inline-flex min-h-[40px] items-center rounded-lg bg-tm-navy px-3 font-bold text-white disabled:opacity-50"
          >
            Reassign
          </button>
          <button type="button" onClick={() => setPicked(new Set())} className="min-h-[40px] px-2 font-bold text-tm-navy underline">
            Clear
          </button>
        </div>
      )}

      {main.length === 0 && older.length === 0 ? (
        <p className="rounded-2xl border border-gray-200 bg-white p-6 text-center text-xs text-gray-600">
          {searching ? 'Nothing matches that search.' : 'No applications here.'}
        </p>
      ) : (
        <ul className="space-y-1">{main.map(renderGroup)}</ul>
      )}

      {older.length > 0 && (
        <section className="space-y-1.5">
          <button
            type="button"
            aria-expanded={showOlder}
            onClick={() => setOlderOpen((v) => !v)}
            className="flex min-h-[40px] w-full items-center justify-between rounded-xl border border-gray-200 bg-tm-bg px-3 text-xs font-black text-slate-700"
          >
            <span>
              Older ({olderCount}) <span className="font-semibold text-gray-600">— tuitions posted more than 30 days ago; never overdue</span>
            </span>
            <ChevronDown aria-hidden size={14} className={showOlder ? 'rotate-180' : ''} />
          </button>
          {showOlder && <ul className="space-y-1.5">{older.map(renderGroup)}</ul>}
        </section>
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
