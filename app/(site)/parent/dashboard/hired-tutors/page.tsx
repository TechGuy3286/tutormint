import Breadcrumbs from '@/components/Breadcrumbs'
import Link from 'next/link'
import { getSessionUser } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import BadgeRow from '@/components/badges/BadgeRow'
import { badgesForPlan } from '@/lib/entitlements'
import { loadVerifiedBadgeOk } from '@/lib/badgeFacts'
import { reviewableHires } from '@/lib/reviews'
import { REVIEW_STATUS_LABEL } from '@/lib/reviewsCore'
import ReviewForm from '@/components/ReviewForm'
import { formatDate } from '@/lib/datetime'

// Tutors this parent has hired, and the review each hire earns (owner,
// 27 Oct 2026 — lib/reviewsCore): one per hire, saved as pending until our
// team approves it. A hire is an application at stage Hired on a tuition this
// parent posted — whether the parent or staff moved it there.

export const dynamic = 'force-dynamic'

export default async function HiredTutorsPage() {
  const session = await getSessionUser()
  const userId = session!.user.id
  const hires = await reviewableHires(userId)

  // Badges through the service-role client: public-profile facts only.
  const admin = createAdminClient()
  const facts = new Map<string, { plan: string | null; complete: boolean; verifiedOk: boolean }>()
  const tutorIds = [...new Set(hires.map((h) => h.tutorId))]
  if (admin && tutorIds.length > 0) {
    const [{ data: subs }, { data: profiles }, okSet] = await Promise.all([
      admin.from('subscriptions').select('user_id, plan_code').in('user_id', tutorIds).eq('status', 'active').gt('expires_at', new Date().toISOString()),
      admin.from('profiles').select('id, profile_completion').in('id', tutorIds),
      loadVerifiedBadgeOk(tutorIds),
    ])
    const planBy = new Map((subs ?? []).map((s) => [s.user_id as string, s.plan_code as string]))
    for (const p of profiles ?? []) {
      facts.set(p.id as string, {
        plan: planBy.get(p.id as string) ?? null,
        complete: ((p.profile_completion as number) ?? 0) >= 100,
        verifiedOk: okSet.has(p.id as string),
      })
    }
  }

  return (
    <main className="min-h-screen bg-tm-bg px-4 py-6 text-slate-700 sm:px-6 sm:py-8 lg:px-8">
      <div className="mx-auto max-w-2xl space-y-4">
        <Breadcrumbs items={[{ label: 'Parent dashboard', href: '/parent/dashboard' }, { label: 'Hired tutors' }]} />
        <header className="space-y-1">
          <h1 className="text-xl font-black text-tm-navy sm:text-2xl">Hired tutors</h1>
        </header>

        {hires.length === 0 ? (
          <p className="rounded-2xl border border-gray-200 bg-white p-8 text-center text-xs text-gray-500">
            You have not hired anyone yet. Hire an applicant from one of your tuitions.
          </p>
        ) : (
          <ul className="space-y-2">
            {hires.map((h) => {
              const f = facts.get(h.tutorId)
              return (
                <li key={h.applicationId} className="space-y-1 rounded-2xl border border-gray-200 bg-white p-4">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-xs font-black text-tm-navy">
                      {h.tutorSlug ? (
                        <Link href={`/tutor/${h.tutorSlug}`} className="hover:underline">
                          {h.tutorName}
                        </Link>
                      ) : (
                        h.tutorName
                      )}
                    </span>
                    {f && <BadgeRow badges={badgesForPlan(f.plan, f.complete, f.verifiedOk)} size="sm" />}
                  </div>
                  <p className="text-[11px] text-gray-500">
                    {h.tuitionTitle}
                    {h.hiredAt ? ` · hired ${formatDate(h.hiredAt)}` : ''}
                  </p>
                  {h.review ? (
                    <p className="text-[11px] font-bold text-tm-green-deep">
                      You reviewed this tutor · {REVIEW_STATUS_LABEL[h.review.status]}
                    </p>
                  ) : (
                    <div className="pt-1">
                      <ReviewForm applicationId={h.applicationId} tutorName={h.tutorName} />
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </main>
  )
}
