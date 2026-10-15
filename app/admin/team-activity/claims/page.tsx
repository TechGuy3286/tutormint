import Link from 'next/link'

import { requireAdminRole, roleMayWrite, SCREEN_ACCESS } from '@/lib/adminAuth'
import { formatDateTime } from '@/lib/datetime'
import { loadClaims } from '@/lib/staffSignups'
import { maskMobile } from '@/lib/smsHealthCore'
import { mayDecideClaim } from '@/lib/staffSignupsCore'

import ClaimDecision from '../ClaimDecision'

// Claims to review (owner, 15 Oct 2026): sign-ups staff say they brought in
// without a link. The Owner and Admin approve or reject (one click, optional
// reason); the Project Managers view. Nobody decides their own claim. Every
// decision is audited and the claimant sees it on Team activity → Paid sign-ups.

export const dynamic = 'force-dynamic'

export default async function ClaimsPage() {
  const actor = await requireAdminRole(...SCREEN_ACCESS.staffClaimsReview)
  const canDecide = roleMayWrite(actor.adminRole, SCREEN_ACCESS.staffClaimsReview)
  const claims = await loadClaims(actor)
  const pending = claims.filter((c) => c.status === 'pending')
  const decided = claims.filter((c) => c.status !== 'pending').slice(0, 50)

  return (
    <div className="space-y-4">
      <Link href="/admin/team-activity" className="text-xs font-bold text-tm-navy hover:underline">
        ← Back to Team activity
      </Link>
      <h1 className="text-base font-black text-tm-navy">Claims to review ({pending.length})</h1>
      {pending.length === 0 && (
        <p className="rounded-2xl border border-gray-200 bg-white p-4 text-xs text-gray-500">No claims waiting.</p>
      )}
      <div className="space-y-2">
        {pending.map((c) => (
          <section key={c.id} className="space-y-2 rounded-2xl border border-gray-200 bg-white p-4 text-xs">
            <p>
              <span className="font-black text-tm-navy">{c.staffName}</span> claims{' '}
              <span className="font-bold text-slate-800">{c.memberName}</span>{' '}
              <span className="text-gray-500">
                ({c.memberRole === 'parent' ? 'parent' : 'tutor'} · {c.memberMobile ? maskMobile(c.memberMobile) : 'no mobile'}
                {c.memberJoinedAt ? ` · signed up ${formatDateTime(c.memberJoinedAt)}` : ''})
              </span>
            </p>
            <p className="text-slate-700">Note: {c.note}</p>
            <p className="text-[11px] text-gray-500">Claimed {formatDateTime(c.createdAt)}</p>
            {canDecide && mayDecideClaim(actor.id, c.staffId) ? (
              <ClaimDecision claimId={c.id} />
            ) : canDecide ? (
              <p className="text-[11px] font-bold text-gray-600">Your own claim. The Owner reviews it.</p>
            ) : null}
          </section>
        ))}
      </div>
      {decided.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-black text-tm-navy">Decided</h2>
          <ul className="divide-y divide-gray-100 rounded-2xl border border-gray-200 bg-white text-xs">
            {decided.map((c) => (
              <li key={c.id} className="space-y-0.5 px-4 py-2">
                <p>
                  <span className="font-bold text-slate-800">{c.memberName}</span>{' '}
                  <span className="text-gray-500">claimed by {c.staffName}</span> ·{' '}
                  <span className={c.status === 'approved' ? 'font-bold text-tm-green-deep' : 'font-bold text-tm-red'}>
                    {c.status === 'approved' ? 'Approved' : 'Rejected'}
                  </span>
                  {c.decidedByName ? <span className="text-gray-500"> by {c.decidedByName}</span> : null}
                  {c.decidedAt ? <span className="text-gray-500"> · {formatDateTime(c.decidedAt)}</span> : null}
                </p>
                {c.reason && <p className="text-gray-600">Reason: {c.reason}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
