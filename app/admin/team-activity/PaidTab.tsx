import Link from 'next/link'

import JoinLinkCard from '@/components/admin/JoinLinkCard'
import { formatDateTime } from '@/lib/datetime'
import { loadClaims, loadSignupBoard, pendingClaimCount } from '@/lib/staffSignups'
import { maskMobile } from '@/lib/smsHealthCore'
import { changeLabel, type Change } from '@/lib/tuitionPostingCore'
import {
  IN_PROGRESS_STEPS,
  PARENT_STEPS,
  PERIODS,
  isParticipantRole,
  type BoardRow,
  type MemberRole,
  type Period,
  type Step,
} from '@/lib/staffSignupsCore'
import { teamActivityHref } from '@/lib/teamActivityCore'
import type { AdminActor } from '@/lib/adminAuth'

import ClaimForm from './ClaimForm'

// Team activity → "Paid sign-ups" (owner, 15 Oct 2026). Staff are paid for PAID
// tutor sign-ups only (an approved, not-refunded Verification Fee), so that is
// the first column, the sort, and the Team total. Tutors at an earlier step who
// have not paid are a separate "In progress (not counted)" block — a different
// rule (inProgressAt) that can never add to Paid. Parents are listed below, for
// information. Counts only — no prices, no amounts. The Owner, the Project
// Managers and Admin see every participant and the Team total; everyone else
// sees their own row only (decided on the server in lib/staffSignups).

const LIST_PATH = '/admin/team-activity/accounts'

function listHref(staffId: string, role: MemberRole, step: Step, period: Period, inProgress = false): string {
  const q = new URLSearchParams({ staff: staffId, role, step, period })
  if (inProgress) q.set('inprogress', '1')
  return `${LIST_PATH}?${q.toString()}`
}

export default async function PaidTab({ actor, period }: { actor: AdminActor; period: Period }) {
  const board = await loadSignupBoard(actor, period)
  const isParticipant = isParticipantRole(actor.adminRole)
  const [myClaims, pending] = await Promise.all([
    isParticipant ? loadClaims({ id: actor.id, adminRole: 'self' }) : Promise.resolve([]),
    board.everyone ? pendingClaimCount() : Promise.resolve(0),
  ])
  const rows = board.rows
  const total = board.everyone ? board.total : null
  const periodLabel = PERIODS.find((p) => p.key === period)?.label ?? ''

  return (
    <div className="space-y-5">
      {board.myLink && <JoinLinkCard url={board.myLink.url} code={board.myLink.code} />}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <nav aria-label="Period" className="flex flex-wrap gap-1">
          {PERIODS.map((p) => (
            <Link
              key={p.key}
              href={teamActivityHref('paid', { period: p.key === 'today' ? null : p.key })}
              aria-current={p.key === period ? 'page' : undefined}
              className={`min-h-[36px] rounded-full border px-3 py-1.5 text-xs font-bold ${
                p.key === period ? 'border-tm-navy bg-tm-navy text-white' : 'border-gray-200 bg-white text-slate-700 hover:border-tm-navy'
              }`}
            >
              {p.label}
            </Link>
          ))}
        </nav>
        {board.everyone && (
          <Link href="/admin/team-activity/claims" className="text-xs font-bold text-tm-red hover:underline">
            Claims to review ({pending})
          </Link>
        )}
      </div>

      {/* ------------------------------------------------ paid tutor sign-ups */}
      <section className="space-y-2">
        <h2 className="text-sm font-black text-tm-navy">Tutors — paid sign-ups</h2>
        {total && (
          <p className="text-xs text-gray-600">
            Team total, {periodLabel.toLowerCase()}:{' '}
            <span className="text-base font-black tabular-nums text-tm-navy">{total.tutor.paid}</span> paid sign-up
            {total.tutor.paid === 1 ? '' : 's'}
          </p>
        )}
        <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white">
          <table className="w-full min-w-[420px] text-left text-xs">
            <thead className="bg-tm-bg text-[11px] font-bold text-gray-600">
              <tr>
                <th className="px-3 py-2">Staff</th>
                <th className="px-3 py-2 text-right">Paid sign-ups</th>
                <th className="px-3 py-2 text-right">Paid: Today vs Yesterday</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-3 py-4 text-gray-500">
                    No staff with a join link yet.
                  </td>
                </tr>
              )}
              {rows.map((r) => (
                <PaidRow key={r.staffId} row={r} period={period} />
              ))}
              {total && rows.length > 0 && <PaidRow row={total} period={period} strong />}
            </tbody>
          </table>
        </div>
      </section>

      {/* ------------------------------------ in progress (not counted) */}
      <section className="space-y-2 rounded-2xl border border-dashed border-gray-300 bg-tm-bg p-3">
        <div>
          <h2 className="text-xs font-black text-slate-700">In progress (not counted)</h2>
          <p className="text-[11px] text-gray-600">
            Tutors who reached a step in this period ({periodLabel.toLowerCase()}) and have not paid yet. Open a number
            to follow up.
          </p>
        </div>
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full min-w-[420px] text-left text-[11px]">
            <thead className="text-gray-600">
              <tr>
                <th className="px-3 py-1.5 font-bold">Staff</th>
                {IN_PROGRESS_STEPS.map((s) => (
                  <th key={s.key} className="px-3 py-1.5 text-right font-bold">
                    {s.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((r) => (
                <InProgressRow key={r.staffId} row={r} period={period} />
              ))}
              {total && rows.length > 0 && <InProgressRow row={total} period={period} strong />}
            </tbody>
          </table>
        </div>
      </section>

      {/* --------------------------------------------------------- parents */}
      <section className="space-y-2">
        <h2 className="text-sm font-black text-tm-navy">Parents (for information)</h2>
        <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white">
          <table className="w-full min-w-[480px] text-left text-xs">
            <thead className="bg-tm-bg text-[11px] font-bold text-gray-600">
              <tr>
                <th className="px-3 py-2">Staff</th>
                {PARENT_STEPS.map((s) => (
                  <th key={s.key} className="px-3 py-2 text-right">
                    {s.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((r) => (
                <ParentRow key={r.staffId} row={r} period={period} />
              ))}
              {total && rows.length > 0 && <ParentRow row={total} period={period} strong />}
            </tbody>
          </table>
        </div>
      </section>

      <p className="text-xs font-bold text-tm-navy">Only paid tutor sign-ups count as results.</p>
      <p className="text-[11px] text-gray-500">
        Each step is counted on the day it happened, in Pakistan time. &ldquo;Paid: Today vs Yesterday&rdquo; compares
        today so far with yesterday up to the same time of day. No credit is given for test or staff accounts, a staff
        member&rsquo;s own mobile or email, accounts that duplicate an existing member, or accounts that existed before
        the link was opened.
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
                <StatusPill status={c.status} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

function StatusPill({ status }: { status: 'pending' | 'approved' | 'rejected' }) {
  const cls =
    status === 'approved'
      ? 'bg-tm-tint-green text-tm-green-deep'
      : status === 'rejected'
        ? 'bg-tm-tint-red text-tm-red'
        : 'bg-tm-tint-navy text-tm-navy'
  const word = status === 'approved' ? 'Approved' : status === 'rejected' ? 'Rejected' : 'Waiting for review'
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${cls}`}>{word}</span>
}

function CountLink({ n, href, big = false }: { n: number; href: string; big?: boolean }) {
  const size = big ? 'text-lg font-black' : 'font-bold'
  if (n <= 0) return <span className={`${size} text-gray-500`}>0</span>
  return (
    <Link href={href} className={`${size} text-tm-navy underline-offset-2 hover:text-tm-red hover:underline`}>
      {n}
    </Link>
  )
}

function PaidRow({ row, period, strong = false }: { row: BoardRow; period: Period; strong?: boolean }) {
  return (
    <tr className={strong ? 'bg-tm-bg font-black text-tm-navy' : 'text-slate-800'}>
      <td className="px-3 py-2 font-bold">{row.name}</td>
      <td className="px-3 py-2 text-right tabular-nums">
        <CountLink n={row.tutor.paid} href={listHref(row.staffId, 'tutor', 'paid', period)} big />
      </td>
      <td className="px-3 py-2 text-right tabular-nums">
        <ChangeCell value={row.paidChange} />
      </td>
    </tr>
  )
}

function InProgressRow({ row, period, strong = false }: { row: BoardRow; period: Period; strong?: boolean }) {
  return (
    <tr className={strong ? 'font-black text-slate-800' : 'text-slate-700'}>
      <td className="px-3 py-1.5 font-bold">{row.name}</td>
      {IN_PROGRESS_STEPS.map((s) => (
        <td key={s.key} className="px-3 py-1.5 text-right tabular-nums">
          <CountLink n={row.inProgress[s.key]} href={listHref(row.staffId, 'tutor', s.key, period, true)} />
        </td>
      ))}
    </tr>
  )
}

function ParentRow({ row, period, strong = false }: { row: BoardRow; period: Period; strong?: boolean }) {
  return (
    <tr className={strong ? 'bg-tm-bg font-black text-tm-navy' : 'text-slate-800'}>
      <td className="px-3 py-2 font-bold">{row.name}</td>
      {PARENT_STEPS.map((s) => (
        <td key={s.key} className="px-3 py-2 text-right tabular-nums">
          <CountLink n={row.parent[s.key]} href={listHref(row.staffId, 'parent', s.key, period)} />
        </td>
      ))}
    </tr>
  )
}

function ChangeCell({ value }: { value: Change }) {
  const cls = !value || value.direction === 'same' ? 'text-gray-500' : value.direction === 'up' ? 'font-bold text-tm-green-deep' : 'font-bold text-tm-red'
  return <span className={cls}>{changeLabel(value)}</span>
}
