import Link from 'next/link'

import JoinLinkCard from '@/components/admin/JoinLinkCard'
import { formatDateTime } from '@/lib/datetime'
import { loadClaims, pendingClaimCount } from '@/lib/staffSignups'
import { loadTargetBoard, type StatusCounts, type TargetCard } from '@/lib/staffTargets'
import { maskMobile } from '@/lib/smsHealthCore'
import { changeLabel, type Change } from '@/lib/tuitionPostingCore'
import { allUnpaidHref } from '@/lib/teamActivityCore'
import { isParticipantRole, type MemberRole, type StaffStatus, type Step } from '@/lib/staffSignupsCore'
import { PACE_LABEL, monthLabel, perDayLabel, type MonthKey, type Pace, type PaceStatus } from '@/lib/staffTargetsCore'
import type { AdminActor } from '@/lib/adminAuth'

import ClaimForm from './ClaimForm'
import CumulativeChart from './CumulativeChart'
import MonthPicker from './MonthPicker'
import SetTargetsPanel from './SetTargetsPanel'
import SourceTable from './SourceTable'

// Team activity → "Paid sign-ups" (owner, 16 Oct 2026). A month at a time:
//   a) the team strip (target-list staff only): paid · target · % · status ·
//      needed per day · days left;
//   b) one card per target-list staff member, highest % of target first;
//   c) the running-total chart against the straight target line;
//   d) "No target" (collapsed): others who still brought paid sign-ups;
//   e) "Pending and signed up" (collapsed): per staff member, Pending (not
//      paid, whatever the step) and Signed up (paid) — owner, 16 Oct 2026.
// A paid sign-up is the first approved, not refunded Verification Fee (tutor)
// or plan purchase (parent) — lib/staffTargetsCore. Counts only, never an
// amount. What each viewer sees is cut on the SERVER (lib/staffTargets): staff
// on the target list see their own card, own line, own lists and the team's
// status only; other staff see their own paid count and lists only.

const LIST_PATH = '/admin/team-activity/accounts'

function listHref(staffId: string, role: MemberRole, step: Step, month: MonthKey): string {
  const q = new URLSearchParams({ staff: staffId, role, step, month })
  return `${LIST_PATH}?${q.toString()}`
}

function statusHref(staffId: string, role: MemberRole, status: StaffStatus, month: MonthKey): string {
  const q = new URLSearchParams({ staff: staffId, role, status, month })
  return `${LIST_PATH}?${q.toString()}`
}

const STATUS_CHIP: Record<PaceStatus, string> = {
  on_pace: 'bg-tm-tint-green text-tm-green-deep',
  slightly_behind: 'bg-tm-tint-gold text-tm-gold-ink',
  behind: 'bg-tm-tint-red text-tm-red',
}
const STATUS_BAR: Record<PaceStatus, string> = {
  on_pace: 'bg-tm-green-deep',
  slightly_behind: 'bg-tm-gold',
  behind: 'bg-tm-red',
}

export default async function PaidTab({ actor, month }: { actor: AdminActor; month: MonthKey }) {
  const board = await loadTargetBoard(actor, month)
  const everyone = board.scope === 'everyone'
  const isParticipant = isParticipantRole(actor.adminRole)
  const [myClaims, pending] = await Promise.all([
    isParticipant ? loadClaims({ id: actor.id, adminRole: 'self' }) : Promise.resolve([]),
    everyone ? pendingClaimCount() : Promise.resolve(0),
  ])
  const label = monthLabel(month)
  const current = board.tense === 'current'

  return (
    <div className="space-y-5">
      {board.myLink && <JoinLinkCard url={board.myLink.url} code={board.myLink.code} />}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <MonthPicker month={month} options={board.months.map((m) => ({ key: m, label: monthLabel(m) }))} />
        {everyone && (
          <Link href="/admin/team-activity/claims" className="text-xs font-bold text-tm-red hover:underline">
            Claims to review ({pending})
          </Link>
        )}
      </div>

      <SourceTable actor={actor} />

      {board.setPanel && (
        <SetTargetsPanel key={month} month={month} monthLabel={label} rows={board.setPanel} countingStarts={board.countingStarts} />
      )}

      {/* a) team strip */}
      {everyone && board.team && <TeamStrip pace={board.team} countingFrom={board.countingFrom} />}
      {!everyone && board.scope === 'target_self' && board.teamStatus && (
        <p className="flex flex-wrap items-center gap-2 text-xs font-bold text-slate-700">
          Team: <StatusChip status={board.teamStatus} />
          {board.teamReached && <span className="text-tm-green-deep">Target reached ✓</span>}
        </p>
      )}

      {/* b) cards */}
      {board.cards.length > 0 && (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {board.cards.map((c) => (
            <Card key={c.staffId} card={c} current={current} month={month} viewerId={actor.id} />
          ))}
        </ul>
      )}
      {everyone && board.cards.length === 0 && (
        <p className="rounded-2xl border border-gray-200 bg-white p-4 text-xs text-gray-600">Nobody is on the target list for {label}.</p>
      )}

      {/* the "self" view: their own paid count */}
      {board.ownPaid && (
        <section className="rounded-2xl border border-gray-200 bg-white p-4">
          <h2 className="text-xs font-bold text-gray-600">Your paid sign-ups, {label}</h2>
          <p className="text-3xl font-black tabular-nums text-tm-navy">
            {board.ownPaid.paid}
          </p>
          <SplitLine staffId={actor.id} tutors={board.ownPaid.tutors} parents={board.ownPaid.parents} month={month} />
        </section>
      )}

      {/* c) chart */}
      {board.chart && (board.chart.team || board.chart.people.length > 0) && (
        <CumulativeChart
          days={board.chart.days}
          team={board.chart.team}
          teamTarget={board.chart.teamTarget}
          people={board.chart.people}
          monthLabel={label}
        />
      )}

      {/* d) no target */}
      {everyone && board.noTarget.length > 0 && (
        <details className="rounded-2xl border border-gray-200 bg-white p-4">
          <summary className="min-h-[44px] cursor-pointer text-sm font-black text-tm-navy">
            No target ({board.noTarget.reduce((s, r) => s + r.paid, 0)} paid)
          </summary>
          <p className="mt-1 text-[11px] text-gray-600">Paid sign-ups from staff who are not on the target list. Not added to the team target.</p>
          <ul className="mt-2 divide-y divide-gray-100 text-xs">
            {board.noTarget.map((r) => (
              <li key={r.staffId} className="flex items-baseline justify-between gap-2 py-2">
                <span className="font-bold text-slate-800">{r.name}</span>
                <span className="text-right">
                  <span className="block text-base font-black tabular-nums text-tm-navy">{r.paid}</span>
                  <SplitLine staffId={r.staffId} tutors={r.tutors} parents={r.parents} month={month} />
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {/* e) pending and signed up */}
      {board.statusCounts.length > 0 && (
        <details className="rounded-2xl border border-dashed border-gray-300 bg-tm-bg p-4">
          <summary className="min-h-[44px] cursor-pointer text-sm font-black text-slate-700">Pending and signed up</summary>
          <p className="mt-1 text-[11px] text-gray-600">
            Pending: not paid yet, whatever step they reached in {label} — not a result. Signed up: paid in {label}.
            Open a number to see the people.
          </p>
          <ul className="mt-2 space-y-2">
            {board.statusCounts.map((r) => (
              <StatusRow key={r.staffId} row={r} month={month} />
            ))}
          </ul>
        </details>
      )}

      <p className="text-xs font-bold text-tm-navy">Only paid sign-ups count as results.</p>
      <p className="text-[11px] text-gray-500">
        A paid sign-up is a tutor&rsquo;s approved Verification Fee or a parent&rsquo;s approved plan purchase, counted
        once on the day it was approved (Pakistan time). A refund removes it from that month. Free grants do not count.
      </p>

      {isParticipant && <ClaimForm />}

      {isParticipant && myClaims.length > 0 && (
        <section className="space-y-2 rounded-2xl border border-gray-200 bg-white p-4">
          <h2 className="text-sm font-black text-tm-navy">Your claims</h2>
          <ul className="divide-y divide-gray-100 text-xs">
            {myClaims.map((c) => (
              <li key={c.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
                <span>
                  <span className="font-bold text-slate-800">{c.memberName}</span>{' '}
                  <span className="text-gray-500">{c.memberMobile ? maskMobile(c.memberMobile) : ''}</span>
                  <span className="block text-gray-500">Claimed {formatDateTime(c.createdAt)}</span>
                  {c.reason && <span className="block text-gray-600">Reason: {c.reason}</span>}
                </span>
                <ClaimPill status={c.status} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

function StatusChip({ status }: { status: PaceStatus }) {
  return <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${STATUS_CHIP[status]}`}>{PACE_LABEL[status]}</span>
}

function NeededLine({ pace }: { pace: Pace }) {
  if (pace.target == null || pace.target <= 0) return <span className="text-gray-500">No target set</span>
  if (pace.reached) return <span className="font-bold text-tm-green-deep">Target reached ✓</span>
  if (pace.neededPerDay == null) return <span className="text-gray-500">Month ended</span>
  return (
    <span>
      Needed per day: <strong className="tabular-nums text-slate-800">{perDayLabel(pace.neededPerDay)}</strong>
    </span>
  )
}

function TeamStrip({ pace, countingFrom }: { pace: Pace; countingFrom: string | null }) {
  return (
    <section className="grid grid-cols-2 gap-3 rounded-2xl border border-gray-200 bg-white p-4 sm:grid-cols-3 lg:grid-cols-6">
      {countingFrom && (
        <p className="col-span-full text-[11px] font-bold text-gray-600">
          {countingFrom}. Pace and &ldquo;Needed per day&rdquo; count from this date; earlier paid sign-ups still count in the total.
        </p>
      )}
      <Stat label="Paid this month" value={String(pace.paid)} />
      <Stat label="Team target" value={pace.target ? String(pace.target) : '—'} />
      <Stat label="% done" value={pace.pct == null ? '—' : `${pace.pct}%`} />
      <div>
        <p className="text-[11px] font-bold text-gray-600">Status</p>
        <p className="mt-1">{pace.status ? <StatusChip status={pace.status} /> : <span className="text-xs text-gray-500">—</span>}</p>
      </div>
      <div>
        <p className="text-[11px] font-bold text-gray-600">Needed per day</p>
        <p className="mt-1 text-xs">
          {pace.reached ? (
            <span className="font-bold text-tm-green-deep">Target reached ✓</span>
          ) : pace.neededPerDay == null ? (
            <span className="text-gray-500">—</span>
          ) : (
            <span className="text-lg font-black tabular-nums text-tm-navy">{perDayLabel(pace.neededPerDay)}</span>
          )}
        </p>
      </div>
      <Stat label="Days left" value={String(pace.daysLeft)} />
    </section>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] font-bold text-gray-600">{label}</p>
      <p className="text-lg font-black tabular-nums text-tm-navy">{value}</p>
    </div>
  )
}

function Card({ card, current, month, viewerId }: { card: TargetCard; current: boolean; month: MonthKey; viewerId: string }) {
  const p = card.pace
  const width = p.pct == null ? 0 : Math.min(100, p.pct)
  return (
    <li className="space-y-2 rounded-2xl border border-gray-200 bg-white p-4">
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-black text-tm-navy">{card.name}</h3>
        {p.status && <StatusChip status={p.status} />}
      </div>
      <p className="flex items-baseline gap-2">
        <span className="text-3xl font-black tabular-nums text-tm-navy">
          {p.paid}
          <span className="text-lg text-gray-500"> / {p.target ?? '—'}</span>
        </span>
        {p.pct != null && <span className="text-sm font-bold text-slate-700">{p.pct}%</span>}
      </p>
      <SplitLine staffId={card.staffId} tutors={card.tutors} parents={card.parents} month={month} />
      <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100" role="presentation">
        <div className={`h-full rounded-full ${p.status ? STATUS_BAR[p.status] : 'bg-gray-300'}`} style={{ width: `${width}%` }} />
      </div>
      {current && (
        <p className="text-[11px] text-gray-600">
          Today <strong className="tabular-nums text-slate-800">{card.today}</strong> · Yesterday{' '}
          <strong className="tabular-nums text-slate-800">{card.yesterday}</strong> · Today vs Yesterday{' '}
          <ChangeText value={card.change} />
        </p>
      )}
      <p className="text-[11px] text-gray-600">
        <NeededLine pace={p} />
      </p>
      <PendingLine card={card} month={month} viewerId={viewerId} />
    </li>
  )
}

/** Outstanding follow-up, not a result (owner, 17 Oct 2026): small and muted
 *  under the paid figures, never part of the pace. The numbers are the status
 *  counts' own Pending and open the same lists. */
const PENDING_HELP = 'Signed up but has not paid — needs follow-up'

function PendingLine({ card, month, viewerId }: { card: TargetCard; month: MonthKey; viewerId: string }) {
  const n = (v: number, role: MemberRole) =>
    v > 0 ? (
      <Link href={statusHref(card.staffId, role, 'pending', month)} className="font-bold text-gray-600 hover:text-tm-red hover:underline">
        {v}
      </Link>
    ) : (
      <span className="text-gray-500">0</span>
    )
  return (
    <div className="border-t border-gray-100 pt-2 text-[11px] text-gray-500" title={PENDING_HELP}>
      <p>
        Pending (unpaid): Tutors {n(card.pending.tutors, 'tutor')} · Parents {n(card.pending.parents, 'parent')}
        <span aria-hidden="true"> | </span>
        <Link href={allUnpaidHref(card.staffId, viewerId)} className="font-bold text-gray-600 hover:text-tm-red hover:underline">
          All unpaid <span className="tabular-nums">{card.allUnpaid}</span>
        </Link>
      </p>
      <p className="text-[10px]">{PENDING_HELP}</p>
    </div>
  )
}

/** "Tutors x · Parents y" — each number opens the list behind it. */
function SplitLine({ staffId, tutors, parents, month }: { staffId: string; tutors: number; parents: number; month: MonthKey }) {
  const n = (v: number, role: MemberRole) =>
    v > 0 ? (
      <Link href={listHref(staffId, role, 'paid', month)} className="font-bold text-tm-navy hover:text-tm-red hover:underline">
        {v}
      </Link>
    ) : (
      <span className="font-bold text-gray-500">0</span>
    )
  return (
    <p className="text-[11px] text-gray-600">
      Tutors {n(tutors, 'tutor')} · Parents {n(parents, 'parent')}
    </p>
  )
}

function StatusRow({ row, month }: { row: StatusCounts; month: MonthKey }) {
  const cell = (n: number, role: MemberRole, status: StaffStatus, label: string) => (
    <span className="whitespace-nowrap">
      {label}{' '}
      {n > 0 ? (
        <Link href={statusHref(row.staffId, role, status, month)} className="font-bold text-tm-navy hover:text-tm-red hover:underline">
          {n}
        </Link>
      ) : (
        <span className="font-bold text-gray-500">0</span>
      )}
    </span>
  )
  return (
    <li className="rounded-xl border border-gray-200 bg-white p-3 text-[11px] text-slate-700">
      <p className="text-xs font-bold text-slate-800">{row.name}</p>
      <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
        <span className="font-bold text-gray-600">Tutors:</span>
        {cell(row.tutor.pending, 'tutor', 'pending', 'Pending')}
        {cell(row.tutor.signed_up, 'tutor', 'signed_up', 'Signed up')}
      </p>
      <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
        <span className="font-bold text-gray-600">Parents:</span>
        {cell(row.parent.pending, 'parent', 'pending', 'Pending')}
        {cell(row.parent.signed_up, 'parent', 'signed_up', 'Signed up')}
      </p>
    </li>
  )
}

function ClaimPill({ status }: { status: 'pending' | 'approved' | 'rejected' }) {
  const cls =
    status === 'approved'
      ? 'bg-tm-tint-green text-tm-green-deep'
      : status === 'rejected'
        ? 'bg-tm-tint-red text-tm-red'
        : 'bg-tm-tint-navy text-tm-navy'
  const word = status === 'approved' ? 'Approved' : status === 'rejected' ? 'Rejected' : 'Waiting for review'
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${cls}`}>{word}</span>
}

function ChangeText({ value }: { value: Change }) {
  const cls = !value || value.direction === 'same' ? 'text-gray-500' : value.direction === 'up' ? 'font-bold text-tm-green-deep' : 'font-bold text-tm-red'
  return <span className={cls}>{changeLabel(value)}</span>
}
