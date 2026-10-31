'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { NO_LONGER_AVAILABLE } from '@/lib/hiddenTuitionCore'
import { useRouter } from 'next/navigation'
import { ChevronDown, Eye, Loader2, MessageCircle, Send, Sparkles } from 'lucide-react'

import { adminFetch } from '@/components/admin/adminFetch'
import { useToast } from '@/components/ui/Toast'
import QueueSearch from '@/components/admin/QueueSearch'
import LoadMoreLink from '@/components/admin/LoadMoreLink'
import type { AppsViewResult } from '@/lib/applicationsPagingCore'
import { formatDate } from '@/lib/datetime'
import type { BoardRow, StaffOption } from '@/lib/applicationTracking'
import type { ForwardCard } from '@/lib/applicantForwards'
import {
  APPLICATIONS_PATH,
  groupCountLine,
  mayEditStage,
  OVERDUE_LABEL,
  shortTitle,
  STAGE_LABEL,
  STAGES,
  successStoryAction,
  timeAtStage,
  type Stage,
  type StaffFilter,
} from '@/lib/applicationStageCore'
import {
  lastTutorUpdate,
  SECTION_LABEL,
  sentLine,
  type DueState,
  type Section,
} from '@/lib/applicationFollowUpCore'
import {
  ACTIVE_STAGES,
  buttonLabel,
  MESSAGE_LABEL,
  RECIPIENT_LABEL,
  STAGE_MESSAGE,
  STAGE_RECIPIENT,
  tutorUpdateMessage,
} from '@/lib/applicationMessagesCore'

import ForwardPanel from './ForwardToParents'

// Tuitions → Applications (owner, 22 Oct 2026; Applications v3).
// Two tabs (To do / Sent) and two views (By tuition / By tutor). Each row's
// WhatsApp button writes to the parent or the tutor by stage; a tap records a
// follow-up and offers a 10-second Undo. The forward panel opens from each
// tuition group. The search covers both tabs and Older, filters set aside, and
// says which tab each result is in. The server checks every change.
//
// Load more (owner, 28 Oct 2026): the server works out the tabs, the Staff
// filter, the stage chips, the search and every count over the whole board
// (lib/applicationsPagingCore) and sends 25 groups at a time; this component
// only draws them. Every change ends in router.refresh(), so the counts follow.

const UNASSIGNED = '__unassigned__'
const CTRL = 'min-h-[40px] sm:min-h-[24px] sm:py-0 rounded-md border border-gray-200 bg-white px-1.5 text-[11px] font-bold text-tm-navy'
const SMALL_BTN = 'inline-flex min-h-[40px] items-center gap-1 rounded-md px-2 font-bold sm:min-h-[24px]'
const UNDO_MS = 10_000

type Row = BoardRow & { due: DueState; section: Section }
type View = 'tuition' | 'tutor'
type OtherOpen = { id: string; tutorName: string; stage: Stage }

/** A filter link: the page shows its first 25 groups again (no ?n=); the search is kept. */
function hrefWith(p: { staff: StaffFilter; stage: Stage | 'any'; tab: 'todo' | 'sent'; view: View; q?: string }): string {
  const q = new URLSearchParams()
  q.set('staff', p.staff)
  if (p.stage !== 'any') q.set('show', p.stage)
  if (p.tab === 'sent') q.set('tab', 'sent')
  if (p.view === 'tutor') q.set('view', 'tutor')
  if (p.q?.trim()) q.set('q', p.q.trim())
  return `${APPLICATIONS_PATH}?${q.toString()}`
}

function ago(iso: string | null | undefined, nowMs: number): string {
  const t = timeAtStage(iso ?? null, nowMs)
  return t === 'just now' ? 'just now' : `${t} ago`
}

const SECTION_CHIP: Record<Section, string> = {
  todo: 'bg-tm-tint-red text-tm-red',
  sent: 'bg-tm-tint-green text-tm-green-deep',
  older: 'bg-gray-100 text-slate-700',
}

export default function ApplicationsClient({
  view: v,
  staff,
  actor,
  staffFilter,
  stageFilter,
  tab,
  listView: view,
  initialQuery,
  nowMs,
  olderPaged = false,
  forwardTemplate,
  canOpenMembers,
  initialPreview = null,
  tutorUpdateTemplate = null,
  supportDisplay = null,
}: {
  /** Worked out on the server over the whole board (lib/applicationsPagingCore). */
  view: AppsViewResult<BoardRow, ForwardCard>
  staff: StaffOption[]
  actor: { id: string; adminRole: string }
  staffFilter: StaffFilter
  stageFilter: Stage | 'any'
  tab: 'todo' | 'sent'
  listView: View
  initialQuery: string
  /** The server's clock, so "3 days" reads the same on both renders. */
  nowMs: number
  /** More than the first Older page is shown (?on=): open the section. */
  olderPaged?: boolean
  forwardTemplate: string
  canOpenMembers: boolean
  /** ?preview=<tutor id> opens that tutor's message preview (By tutor). */
  initialPreview?: string | null
  /** The stored By-tutor template (Team inbox → Templates) for the preview. */
  tutorUpdateTemplate?: string | null
  /** The support WhatsApp number from settings. */
  supportDisplay?: string | null
}) {
  const router = useRouter()
  const toast = useToast()
  const isOwner = actor.adminRole === 'owner'
  const [busy, setBusy] = useState<string | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [bulkOwner, setBulkOwner] = useState('')
  const [hire, setHire] = useState<{ row: Row; others: OtherOpen[]; close: Set<string> } | null>(null)
  const [olderOpen, setOlderOpen] = useState(olderPaged)
  const [panel, setPanel] = useState<{ jobId: string; title: string } | null>(null)
  const [preview, setPreview] = useState<string | null>(initialPreview)

  // Counts, chips, search and groups come from the server, over the whole
  // board; only the shown groups are here.
  const { counts, stageCounts, choices, searching, groups, older, viewedOnly } = v
  const hits = useMemo(() => new Set(v.hitIds), [v.hitIds])
  const allByJob = useMemo(() => new Map(Object.entries(v.related)), [v.related])
  const allByTutor = allByJob
  const cardBy = useMemo(() => new Map(v.cards.map((c) => [c.jobId, c])), [v.cards])
  const keep = { staff: staffFilter, show: stageFilter === 'any' ? undefined : stageFilter, tab: tab === 'sent' ? 'sent' : undefined, view: view === 'tutor' ? 'tutor' : undefined }

  // --------------------------------------------------------------- actions --

  async function undo(ids: string[]) {
    const { ok, data } = await adminFetch<{ error?: string }>('/api/admin/applications/follow-up/undo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ followUpIds: ids }),
    })
    if (!ok) return toast.error(data?.error ?? 'That did not undo. Please try again.')
    toast.success('Undone — it is back where it was.')
    router.refresh()
  }

  /** Open WhatsApp in a new tab, record the follow-up, offer Undo. */
  async function send(url: string, body: object, busyKey: string, done: string) {
    // Opened now, inside the tap, so the browser does not block it.
    const w = window.open('', '_blank')
    setBusy(busyKey)
    const { ok, data } = await adminFetch<{ error?: string; href?: string; followUpIds?: string[] }>(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    setBusy(null)
    if (!ok || !data?.href) {
      w?.close()
      return toast.error(data?.error ?? 'That did not open. Please try again.')
    }
    if (w) w.location.href = data.href
    else window.location.href = data.href
    const ids = data.followUpIds ?? []
    toast.success(done, ids.length ? { label: 'Undo', onClick: () => void undo(ids), ms: UNDO_MS } : undefined)
    router.refresh()
  }

  async function saveStage(row: Row, stage: Stage, alsoNotSelected: string[] = []) {
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

  async function onStage(row: Row, stage: Stage) {
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

  // ----------------------------------------------------------------- parts --

  function ownerControl(r: Row) {
    return isOwner ? (
      <select
        aria-label={`Owner of ${r.jobTitle}`}
        value={r.ownerId ?? UNASSIGNED}
        disabled={busy === 'owner'}
        onChange={(e) => reassign([r.jobId], e.target.value === UNASSIGNED ? null : e.target.value)}
        className={CTRL}
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
    )
  }

  function forwardButton(jobId: string, title: string) {
    return (
      <button type="button" onClick={() => setPanel({ jobId, title })} className={`${SMALL_BTN} ms-auto border border-tm-navy text-tm-navy`}>
        <Send aria-hidden size={12} /> Forward to parents
      </button>
    )
  }

  function statusLine(r: Row): string {
    const d = r.due
    // The parent account is hidden, test, suspended or banned (owner, 24 Oct 2026).
    if (d.unavailable) return NO_LONGER_AVAILABLE
    if (d.last) {
      return sentLine({
        messageLabel: MESSAGE_LABEL[d.last.messageKey],
        recipientLabel: RECIPIENT_LABEL[d.last.recipient],
        staffName: d.last.staffName,
        ago: ago(d.last.at, nowMs),
        nextDue: d.done ? null : formatDate(d.dueAt),
      })
    }
    if (d.tab === 'sent') {
      return `Moved to ${STAGE_LABEL[r.stage]}${r.stageChangedByName ? ` by ${r.stageChangedByName}` : ''}, ${ago(r.stageChangedAt, nowMs)} · next due ${formatDate(d.dueAt)}`
    }
    return 'Due now'
  }

  function rowView(r: Row, context: View) {
    const editable = mayEditStage(actor, r.ownerId) && !r.unavailable
    const hit = hits.has(r.id)
    const story = successStoryAction(r)
    const recipient = STAGE_RECIPIENT[r.stage]
    const hasNumber = !r.unavailable && (recipient === 'parent' ? r.hasParentNumber : !!r.tutorPhone)
    const tu = lastTutorUpdate(r.followUps)
    return (
      <li
        key={r.id}
        data-section={r.section}
        className={`flex flex-wrap items-center gap-x-2 gap-y-0.5 px-2 py-0.5 text-[11px] ${hit ? 'bg-tm-tint-gold' : r.section === 'sent' ? 'bg-tm-bg' : ''}`}
      >
        {context === 'tuition' ? (
          <>
            <span title={r.tutorName} className="w-40 shrink-0 truncate font-bold text-tm-navy">
              {r.tutorName}
            </span>
            {r.tutorPhone && <span className="font-mono text-slate-600">{r.tutorPhone}</span>}
          </>
        ) : (
          <span className="flex min-w-0 items-center gap-1" title={r.jobTitle}>
            {r.jobRef && <span className="rounded bg-tm-navy px-1 py-0.5 text-[10px] font-black text-white">{r.jobRef}</span>}
            <Link href={`/admin/jobs/${r.jobId}`} className="max-w-[16rem] truncate font-bold text-tm-navy hover:underline">
              {shortTitle(r.jobTitle, 48)}
            </Link>
          </span>
        )}
        {editable ? (
          <select aria-label={`Stage for ${r.tutorName}`} value={r.stage} disabled={busy === r.id} onChange={(e) => onStage(r, e.target.value as Stage)} className={CTRL}>
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
        {r.due.overdue && (
          <span
            className={`rounded-full px-1.5 py-0.5 text-[10px] font-black ${
              r.due.overdue === 'forward_overdue' ? 'bg-tm-tint-red text-tm-red' : 'bg-tm-tint-gold text-tm-gold-ink'
            }`}
          >
            {OVERDUE_LABEL[r.due.overdue]}
          </span>
        )}
        <span className={r.section === 'sent' ? 'text-tm-green-deep' : 'text-gray-600'}>{statusLine(r)}</span>
        {tu && context === 'tuition' && <span className="text-gray-600">· Tutor updated {ago(tu.at, nowMs)}</span>}
        {searching && <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-black ${SECTION_CHIP[r.section]}`}>{SECTION_LABEL[r.section]}</span>}
        <span className="ms-auto flex items-center gap-1">
          {story &&
            ('href' in story ? (
              <Link href={story.href} className={`${SMALL_BTN} border border-tm-navy text-tm-navy`}>
                <Sparkles aria-hidden size={12} /> Success story
              </Link>
            ) : (
              <span className={`${SMALL_BTN} bg-tm-bg text-gray-600`}>{story.label}</span>
            ))}
          <button
            type="button"
            disabled={!hasNumber || busy === `fu:${r.id}`}
            onClick={() =>
              void send('/api/admin/applications/follow-up', { applicationId: r.id }, `fu:${r.id}`, r.stage === 'applied' ? `Profile shared with the parent — ${r.tutorName} moved to Forwarded.` : `${MESSAGE_LABEL[STAGE_MESSAGE[r.stage]]} to ${RECIPIENT_LABEL[recipient]} recorded — ${r.tutorName}.`)
            }
            className={`${SMALL_BTN} ${hasNumber ? 'bg-tm-green-deep text-white' : 'border border-gray-200 bg-white text-gray-500'}`}
          >
            <MessageCircle aria-hidden size={12} /> {buttonLabel(recipient, hasNumber)}
          </button>
        </span>
      </li>
    )
  }

  function tuitionGroup(key: string, list: Row[]) {
    const head = list[0]
    const allRows = allByJob.get(key) ?? list
    const overdue = list.some((r) => !!r.due.overdue)
    return (
      <li key={key} className={`overflow-hidden rounded-xl border ${overdue ? 'border-tm-red/30' : 'border-gray-200'} bg-white`}>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 bg-tm-tint-navy px-2 py-1 text-[11px]">
          {isOwner && (
            <input
              type="checkbox"
              aria-label={`Select ${head.jobTitle}`}
              checked={picked.has(key)}
              onChange={(e) => {
                const next = new Set(picked)
                if (e.target.checked) next.add(key)
                else next.delete(key)
                setPicked(next)
              }}
              className="h-4 w-4"
            />
          )}
          {head.jobRef && <span className="rounded bg-tm-navy px-1 py-0.5 text-[10px] font-black text-white">{head.jobRef}</span>}
          <Link href={`/admin/jobs/${key}`} title={head.jobTitle} className="min-w-0 font-black text-tm-navy hover:underline">
            {shortTitle(head.jobTitle, 60)}
          </Link>
          {head.jobCity && <span className="text-gray-600">{head.jobCity}</span>}
          <span className="text-gray-600">· {ownerControl(head)}</span>
          <span className="font-bold text-slate-700">{groupCountLine(allRows.map((r) => r.stage))}</span>
          {!head.hasParentNumber && <span className="font-bold text-tm-red">No parent number</span>}
          {forwardButton(key, head.jobTitle)}
        </div>
        <ul className="divide-y divide-gray-100">{list.map((r) => rowView(r, 'tuition'))}</ul>
      </li>
    )
  }

  function tutorGroup(key: string, list: Row[]) {
    const head = list[0]
    const mine = allByTutor.get(key) ?? list
    const active = mine.filter((r) => ACTIVE_STAGES.includes(r.stage))
    const updated = mine
      .map((r) => lastTutorUpdate(r.followUps))
      .filter((u): u is NonNullable<typeof u> => !!u)
      .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0]
    const message = tutorUpdateMessage(
      head.tutorName,
      active.map((r) => ({ ref: r.jobRef, title: r.jobTitle, stage: r.stage })),
      { template: tutorUpdateTemplate, supportWhatsApp: supportDisplay },
    )
    const canSend = !!head.tutorPhone && active.length > 0
    return (
      <li key={key} className="overflow-hidden rounded-xl border border-gray-200 bg-white">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 bg-tm-tint-navy px-2 py-1 text-[11px]">
          <span className="font-black text-tm-navy">{head.tutorName}</span>
          {head.tutorPhone && <span className="font-mono text-slate-600">{head.tutorPhone}</span>}
          <span className="font-bold text-slate-700">{active.length} in progress</span>
          {updated && (
            <span className="text-gray-600">
              Tutor updated {ago(updated.at, nowMs)}
              {updated.staffName ? ` by ${updated.staffName}` : ''}
            </span>
          )}
          <span className="ms-auto flex items-center gap-1">
            <button
              type="button"
              aria-expanded={preview === key}
              onClick={() => setPreview(preview === key ? null : key)}
              className={`${SMALL_BTN} border border-gray-200 bg-white text-slate-700`}
            >
              <Eye aria-hidden size={12} /> Preview
            </button>
            <button
              type="button"
              disabled={!canSend || busy === `tu:${key}`}
              onClick={() => void send('/api/admin/applications/tutor-update', { tutorId: key }, `tu:${key}`, `Tutor update recorded — ${head.tutorName}.`)}
              className={`${SMALL_BTN} ${canSend ? 'bg-tm-green-deep text-white' : 'border border-gray-200 bg-white text-gray-500'}`}
            >
              <MessageCircle aria-hidden size={12} /> {head.tutorPhone ? (active.length ? 'WhatsApp tutor' : 'Nothing in progress') : 'No tutor number'}
            </button>
          </span>
        </div>
        {preview === key && <pre className="whitespace-pre-wrap border-b border-gray-100 bg-white px-3 py-2 font-sans text-[11px] text-slate-800">{message}</pre>}
        <ul className="divide-y divide-gray-100">{list.map((r) => rowView(r, 'tutor'))}</ul>
      </li>
    )
  }

  const renderGroup = (g: { key: string; rows: Row[] }) => (view === 'tutor' ? tutorGroup(g.key, g.rows) : tuitionGroup(g.key, g.rows))

  // ------------------------------------------------------------------ page --

  const pill = (on: boolean) =>
    `inline-flex min-h-[36px] items-center gap-1 rounded-full border px-3 text-[11px] font-bold ${
      on ? 'border-tm-navy bg-tm-navy text-white' : 'border-gray-200 bg-white text-tm-navy hover:border-tm-navy'
    }`
  const here = { staff: staffFilter, stage: stageFilter, tab, view, q: initialQuery }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <nav aria-label="View" className="flex gap-1 rounded-xl border border-gray-200 bg-white p-1">
          {(['tuition', 'tutor'] as const).map((v) => (
            <Link
              key={v}
              href={hrefWith({ ...here, view: v })}
              aria-current={v === view ? 'page' : undefined}
              className={`rounded-lg px-3 py-1.5 text-xs font-bold ${v === view ? 'bg-tm-navy text-white' : 'text-tm-navy hover:bg-tm-tint-navy'}`}
            >
              {v === 'tuition' ? 'By tuition' : 'By tutor'}
            </Link>
          ))}
        </nav>
        <nav aria-label="Tabs" className="flex gap-1">
          {(['todo', 'sent'] as const).map((t) => (
            <Link
              key={t}
              href={hrefWith({ ...here, tab: t })}
              aria-current={t === tab ? 'page' : undefined}
              className={`inline-flex min-h-[40px] items-center gap-1.5 rounded-xl px-3 text-xs font-bold ${
                t === tab ? 'bg-tm-navy text-white' : 'border border-gray-200 bg-white text-slate-700 hover:border-tm-navy'
              }`}
            >
              {SECTION_LABEL[t]}{' '}
              <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${t === tab ? 'bg-white text-tm-navy' : 'bg-tm-tint-navy text-tm-navy'}`}>{counts[t]}</span>
            </Link>
          ))}
        </nav>
        <label className="flex items-center gap-1 text-xs font-bold text-slate-700">
          Staff
          <select
            aria-label="Staff"
            value={staffFilter}
            onChange={(e) => router.push(hrefWith({ ...here, staff: e.target.value }))}
            className="min-h-[40px] rounded-lg border border-gray-200 bg-white px-2 text-xs font-bold text-tm-navy"
          >
            {choices.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label} ({c.count})
              </option>
            ))}
          </select>
        </label>
        <div className="min-w-[14rem] flex-1">
          {/* The search runs on the server over the WHOLE board (?q=). */}
          <QueueSearch
            basePath={APPLICATIONS_PATH}
            initialQuery={initialQuery}
            filter=""
            keep={keep}
            placeholder="Search everything: tutor, TM number, tuition or city"
            ariaLabel="Search applications"
          />
        </div>
      </div>

      <nav aria-label="Filter by stage" className="flex flex-wrap gap-1.5">
        {(['any', ...STAGES] as const).map((s) => (
          <Link key={s} href={hrefWith({ ...here, stage: s })} aria-current={s === stageFilter ? 'page' : undefined} className={pill(s === stageFilter)}>
            {s === 'any' ? 'All stages' : STAGE_LABEL[s]} <span className={s === stageFilter ? 'text-white' : 'text-gray-500'}>{stageCounts[s]}</span>
          </Link>
        ))}
      </nav>

      {searching && (
        <p className="text-[11px] font-bold text-slate-700">
          {v.hitCount} {v.hitCount === 1 ? 'application' : 'applications'} found across To do, Sent and Older (every staff member and stage). Each says which tab
          it is in.
        </p>
      )}

      {isOwner && picked.size > 0 && view === 'tuition' && (
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

      {groups.total === 0 ? (
        <p className="rounded-2xl border border-gray-200 bg-white p-6 text-center text-xs text-gray-600">
          {searching ? 'Nothing matches that search.' : tab === 'todo' ? 'Nothing is due right now.' : 'Nothing sent yet.'}
        </p>
      ) : (
        <>
          <ul className="space-y-1">{groups.rows.map(renderGroup)}</ul>
          <LoadMoreLink shown={groups.shown} total={groups.total} noun={view === 'tutor' ? 'tutors' : 'tuitions'} />
        </>
      )}

      {!searching && viewedOnly.total > 0 && view === 'tuition' && (
        <section className="space-y-1">
          <h3 className="text-xs font-black text-slate-700">
            {tab === 'todo' ? 'Viewed the number, no application yet' : 'Forwarded — viewed the number only'} ({viewedOnly.total})
          </h3>
          <ul className="space-y-1">
            {viewedOnly.rows.map((c) => (
              <li key={c.jobId} className="flex flex-wrap items-center gap-x-2 rounded-xl border border-gray-200 bg-white px-2 py-1 text-[11px]">
                {c.ref && <span className="rounded bg-tm-navy px-1 py-0.5 text-[10px] font-black text-white">{c.ref}</span>}
                <Link href={`/admin/jobs/${c.jobId}`} className="font-black text-tm-navy hover:underline">
                  {shortTitle(c.title, 60)}
                </Link>
                {c.city && <span className="text-gray-600">{c.city}</span>}
                <span className="font-bold text-slate-700">
                  {c.tutors.length} paid {c.tutors.length === 1 ? 'tutor' : 'tutors'}
                </span>
                {forwardButton(c.jobId, c.title)}
              </li>
            ))}
          </ul>
          <LoadMoreLink shown={viewedOnly.shown} total={viewedOnly.total} noun="tuitions" param="vn" />
        </section>
      )}

      {tab === 'todo' && older.total > 0 && (
        <section className="space-y-1">
          <button
            type="button"
            aria-expanded={olderOpen}
            onClick={() => setOlderOpen((v) => !v)}
            className="flex min-h-[40px] w-full items-center justify-between rounded-xl border border-gray-200 bg-tm-bg px-3 text-xs font-black text-slate-700"
          >
            <span>
              Older ({v.olderRowCount}) <span className="font-semibold text-gray-600">— tuitions posted more than 30 days ago; never overdue</span>
            </span>
            <ChevronDown aria-hidden size={14} className={olderOpen ? 'rotate-180' : ''} />
          </button>
          {olderOpen && (
            <>
              <ul className="space-y-1">{older.rows.map(renderGroup)}</ul>
              <LoadMoreLink shown={older.shown} total={older.total} noun={view === 'tutor' ? 'older tutors' : 'older tuitions'} param="on" />
            </>
          )}
        </section>
      )}

      {panel && (
        <ForwardPanel
          card={cardBy.get(panel.jobId) ?? null}
          template={forwardTemplate}
          canOpenMembers={canOpenMembers}
          nowMs={nowMs}
          title={panel.title}
          onClose={() => {
            setPanel(null)
            router.refresh()
          }}
        />
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
