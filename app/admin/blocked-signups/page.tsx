import { requireAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { canApprove } from '@/lib/adminAccessCore'
import { formatDate, formatDateTime } from '@/lib/datetime'
import { fingerprintSecret, loadBlockedSignups } from '@/lib/eraseFingerprint'
import { FINGERPRINT_ENV, KIND_LABEL, maskedLastTwo, STEP_LABEL } from '@/lib/eraseFingerprintCore'
import BlockedSignupActions from './BlockedSignupActions'

// Blocked re-sign-ups (owner, 20 Nov 2026 — PR-11). A sign-up, mobile
// verification or CNIC entry refused because the number belongs to an account
// erased on request. Only the last two digits of what was entered are shown —
// the number itself is never stored. The Owner can Allow (reason, logged,
// Undo) or Keep blocked; the Partner views.

export const dynamic = 'force-dynamic'

export default async function BlockedSignupsPage() {
  const actor = await requireAdminRole(...SCREEN_ACCESS.blockedSignups)
  const owner = canApprove(actor.adminRole)
  const rows = await loadBlockedSignups()
  const keySet = !!fingerprintSecret()
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <header className="space-y-1">
        <h1 className="text-lg font-black text-tm-navy">Blocked re-sign-ups</h1>
        <p className="text-xs text-gray-600">
          When an account is erased on request, its mobile numbers and CNIC are kept only as a one-way fingerprint. Signing up
          again with one of them is refused, and the attempt is listed here. Allow lets that number sign up again.
        </p>
        {!keySet && (
          <p className="rounded-xl border border-tm-red/30 bg-tm-tint-red p-3 text-xs font-bold text-tm-red">
            {FINGERPRINT_ENV} is not set, so erases are not fingerprinted and nothing can be blocked. Add it in Vercel (production).
          </p>
        )}
      </header>
      {rows.length === 0 ? (
        <p className="rounded-2xl border border-gray-200 bg-white p-4 text-sm text-gray-600">
          No blocked sign-ups yet. When someone tries to sign up with the number or CNIC of an erased account, it appears here
          and in your bell.
        </p>
      ) : (
        <ul className="divide-y divide-gray-100 rounded-2xl border border-gray-200 bg-white">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-xs" data-blocked-row="">
              <div className="min-w-0 space-y-0.5">
                <p className="font-bold text-tm-navy">
                  {KIND_LABEL[r.kind]} {maskedLastTwo(r.last2)} · {STEP_LABEL[r.step]}
                </p>
                <p className="text-gray-600">
                  {formatDateTime(r.at)} · closed account erased {formatDate(r.erasedAt)}
                  {r.allowed ? ` · Allowed ${r.allowedAt ? formatDateTime(r.allowedAt) : ''}${r.allowReason ? ` — ${r.allowReason}` : ''}` : r.reviewedAt ? ' · Kept blocked' : ''}
                </p>
              </div>
              {owner && <BlockedSignupActions attemptId={r.id} allowed={r.allowed} reviewed={!!r.reviewedAt} />}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
