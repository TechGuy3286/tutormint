import Link from 'next/link'

import JoinLinkCard from '@/components/admin/JoinLinkCard'
import { formatDateTime } from '@/lib/datetime'
import { loadClaims, loadSignupBoard, pendingClaimCount } from '@/lib/staffSignups'
import { maskMobile } from '@/lib/smsHealthCore'
import { changeLabel, type Change } from '@/lib/tuitionPostingCore'
import {
  PARENT_STEPS,
  PERIODS,
  TUTOR_STEPS,
  isParticipantRole,
  type BoardRow,
  type MemberRole,
  type Period,
  type Step,
} from '@/lib/staffSignupsCore'
import type { AdminActor } from '@/lib/adminAuth'

import ClaimForm from './ClaimForm'

// Tuitions → Tuition posting activity → "Sign-ups by staff" (owner, 15 Oct
// 2026). Counts only — no prices, no amounts. The Owner, the Project Managers
// and Admin see every participant and the Team total; everyone else sees their
// own row only (decided on the server in lib/staffSignups). Each number opens
// the accounts behind it.

export default async function SignupsTab({ actor, period }: { actor: AdminActor; period: Period }) {
  const board = await loadSignupBoard(actor, period)
  const isParticipant = isParticipantRole(actor.adminRole)
  const [myClaims, pending] = await Promise.all([
    isParticipant ? loadClaims({ id: actor.id, adminRole: 'self' }) : Promise.resolve([]),
    board.everyone ? pendingClaimCount() : Promise.resolve(0),
  ])

  return (
    <div className="space-y-4">
      {board.myLink && <JoinLinkCard url={board.myLink.url} code={board.myLink.code} />}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <nav aria-label="Period" className="flex flex-wrap gap-1">
          {PERIODS.map((p) => (
            <Link
              key={p.key}
              href={`/admin/jobs/posting-activity?tab=signups&period=${p.key}`}
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
          <Link href="/admin/jobs/posting-activity/claims" className="text-xs font-bold text-tm-red hover:underline">
            Claims to review ({pending})
          </Link>
        )}
      </div>

      <BoardTable title="Tutors" role="tutor" rows={board.rows} total={board.total} period={period} />
      <BoardTable title="Parents" role="parent" rows={board.rows} total={board.total} period={period} />

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

function BoardTable({
  title,
  role,
  rows,
  total,
  period,
}: {
  title: string
  role: MemberRole
  rows: BoardRow[]
  total: BoardRow | null
  period: Period
}) {
  const steps = role === 'tutor' ? TUTOR_STEPS : PARENT_STEPS
  const cols = steps.length + 1 + (role === 'tutor' ? 1 : 0)
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-black text-tm-navy">{title}</h2>
      <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white">
        <table className="w-full min-w-[560px] text-left text-xs">
          <thead className="bg-tm-bg text-[11px] font-bold text-gray-600">
            <tr>
              <th className="px-3 py-2">Staff</th>
              {steps.map((s) => (
                <th key={s.key} className="px-3 py-2 text-right">
                  {s.label}
                </th>
              ))}
              {role === 'tutor' && <th className="px-3 py-2 text-right">Paid: Today vs Yesterday</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.length === 0 && (
              <tr>
                <td colSpan={cols} className="px-3 py-4 text-gray-500">
                  No staff with a join link yet.
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <Row key={r.staffId} row={r} role={role} period={period} />
            ))}
            {total && rows.length > 0 && <Row row={total} role={role} period={period} strong />}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function Row({ row, role, period, strong = false }: { row: BoardRow; role: MemberRole; period: Period; strong?: boolean }) {
  const steps = role === 'tutor' ? TUTOR_STEPS : PARENT_STEPS
  const counts = (role === 'tutor' ? row.tutor : row.parent) as Record<Step, number>
  return (
    <tr className={strong ? 'bg-tm-bg font-black text-tm-navy' : 'text-slate-800'}>
      <td className="px-3 py-2 font-bold">{row.name}</td>
      {steps.map((s) => {
        const n = counts[s.key]
        return (
          <td key={s.key} className="px-3 py-2 text-right tabular-nums">
            {n > 0 ? (
              <Link
                href={`/admin/jobs/posting-activity/signups?staff=${encodeURIComponent(row.staffId)}&role=${role}&step=${s.key}&period=${period}`}
                className="font-bold text-tm-navy underline-offset-2 hover:text-tm-red hover:underline"
              >
                {n}
              </Link>
            ) : (
              <span className="text-gray-500">0</span>
            )}
          </td>
        )
      })}
      {role === 'tutor' && (
        <td className="px-3 py-2 text-right tabular-nums">
          <ChangeCell value={row.paidChange} />
        </td>
      )}
    </tr>
  )
}

function ChangeCell({ value }: { value: Change }) {
  const cls = !value || value.direction === 'same' ? 'text-gray-500' : value.direction === 'up' ? 'font-bold text-tm-green-deep' : 'font-bold text-tm-red'
  return <span className={cls}>{changeLabel(value)}</span>
}
