import Link from 'next/link'
import { LogIn, Star } from 'lucide-react'

import Breadcrumbs from '@/components/Breadcrumbs'
import ReviewForm from '@/components/ReviewForm'
import { getSessionUser } from '@/lib/auth'
import { reviewableHires } from '@/lib/reviews'
import { REVIEW_STATUS_LABEL } from '@/lib/reviewsCore'
import { formatDate } from '@/lib/datetime'

// /review — "Leave a review" (owner, 27 Oct 2026; rules lib/reviewsCore).
//
// Signed out: a sign-in prompt that returns here. A parent: every tutor they
// hired on a tuition they posted, with a form for each hire not yet reviewed
// (?application=<id> opens that one) and the status of each review left —
// reviews are pending until our team approves them. Anyone else is told
// reviews are left by parents. Nothing here is indexed (layout.tsx).

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f-]{36}$/i

export default async function ReviewPage({ searchParams }: { searchParams: Promise<{ application?: string }> }) {
  const sp = await searchParams
  const focus = sp.application && UUID.test(sp.application) ? sp.application : null
  const session = await getSessionUser()
  const back = focus ? `/review?application=${focus}` : '/review'

  return (
    <main className="min-h-screen bg-tm-bg px-4 py-6 text-slate-700 sm:px-6 sm:py-8 lg:px-8">
      <div className="mx-auto max-w-2xl space-y-4">
        <Breadcrumbs items={[{ label: 'Leave a review' }]} />
        <header className="space-y-1">
          <h1 className="text-xl font-black text-tm-navy sm:text-2xl">Leave a review</h1>
          <p className="text-xs text-gray-500">Parents review the tutors they hired through TutorMint. Our team checks every review before it appears.</p>
        </header>

        {!session ? (
          <section className="space-y-3 rounded-2xl border border-gray-200 bg-white p-6 text-center" data-review-signin="">
            <p className="text-sm font-bold text-tm-navy">Sign in to review your tutor</p>
            <p className="text-xs text-gray-500">Use the account you posted your tuition from.</p>
            <Link
              href={`/login?next=${encodeURIComponent(back)}`}
              className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl bg-tm-red px-5 text-xs font-bold text-white hover:bg-tm-red-hover"
            >
              <LogIn aria-hidden size={14} />
              Sign in
            </Link>
          </section>
        ) : session.profile?.role !== 'parent' && session.profile?.role !== 'academy' ? (
          <p className="rounded-2xl border border-gray-200 bg-white p-6 text-center text-xs text-gray-500">
            Reviews are left by parents after they hire a tutor through TutorMint.
          </p>
        ) : (
          <ParentReviews parentId={session.user.id} focus={focus} />
        )}
      </div>
    </main>
  )
}

async function ParentReviews({ parentId, focus }: { parentId: string; focus: string | null }) {
  const hires = await reviewableHires(parentId)
  if (hires.length === 0) {
    return (
      <p className="rounded-2xl border border-gray-200 bg-white p-6 text-center text-xs text-gray-500">
        You can review a tutor after you hire them through TutorMint.{' '}
        <Link href="/parent/dashboard" className="font-bold text-tm-red underline">
          Go to your dashboard
        </Link>
      </p>
    )
  }
  const ordered = focus ? [...hires].sort((a, b) => Number(b.applicationId === focus) - Number(a.applicationId === focus)) : hires
  return (
    <ul className="space-y-2">
      {ordered.map((h) => (
        <li key={h.applicationId} className="space-y-1 rounded-2xl border border-gray-200 bg-white p-4" data-review-hire="">
          <p className="text-xs font-black text-tm-navy">
            {h.tutorSlug ? (
              <Link href={`/tutor/${h.tutorSlug}`} className="hover:underline">
                {h.tutorName}
              </Link>
            ) : (
              h.tutorName
            )}
          </p>
          <p className="text-[11px] text-gray-500">
            {h.tuitionTitle}
            {h.hiredAt ? ` · hired ${formatDate(h.hiredAt)}` : ''}
          </p>
          {h.review ? (
            <p className="inline-flex items-center gap-1 text-[11px] font-bold text-tm-green-deep">
              <Star aria-hidden size={12} className="fill-tm-gold stroke-tm-gold" />
              {h.review.rating} out of 5 · {REVIEW_STATUS_LABEL[h.review.status]}
            </p>
          ) : (
            <div className="pt-1">
              <ReviewForm applicationId={h.applicationId} tutorName={h.tutorName} startOpen={h.applicationId === focus} />
            </div>
          )}
        </li>
      ))}
    </ul>
  )
}
