import Link from 'next/link'
import { Star } from 'lucide-react'

import { requireAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { loadReviewQueue } from '@/lib/reviews'
import { parseReviewStatus, REVIEW_STATUS_LABEL, type ReviewStatus } from '@/lib/reviewsCore'
import { formatDateTime } from '@/lib/datetime'
import ReviewDecision from './ReviewDecision'

// Trust → Reviews (owner, 27 Oct 2026; lib/reviewsCore). Parent reviews of
// tutors they hired. Each is pending until the site Owner approves or rejects
// it; only approved reviews are public and count in the tutor's rating. Staff
// with access may read the queue; the decision buttons are the Owner's alone
// (the route refuses everyone else). Every decision is in Audit.

export const dynamic = 'force-dynamic'

const TABS: ReviewStatus[] = ['pending', 'approved', 'rejected']

export default async function AdminReviewsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  await requireAdminRole(...SCREEN_ACCESS.reviews)
  const tab = parseReviewStatus((await searchParams).tab)
  const { rows, counts } = await loadReviewQueue(tab)

  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-xl font-black text-tm-navy">Reviews</h1>
        <p className="text-xs text-gray-500">Reviews from parents who hired a tutor. A review appears on the tutor&apos;s profile only once it is approved.</p>
      </header>

      <nav className="flex flex-wrap gap-2" aria-label="Review status">
        {TABS.map((t) => (
          <Link
            key={t}
            href={t === 'pending' ? '/admin/reviews' : `/admin/reviews?tab=${t}`}
            aria-current={t === tab ? 'page' : undefined}
            className={`inline-flex min-h-[36px] items-center rounded-full border px-3 text-xs font-bold ${
              t === tab ? 'border-tm-navy bg-tm-navy text-white' : 'border-gray-200 bg-white text-slate-700 hover:border-tm-navy'
            }`}
          >
            {REVIEW_STATUS_LABEL[t]} ({counts[t]})
          </Link>
        ))}
      </nav>

      {rows.length === 0 ? (
        <p className="rounded-2xl border border-gray-200 bg-white p-8 text-center text-xs text-gray-500">
          {tab === 'pending' ? 'No reviews are waiting for approval.' : 'Nothing here yet.'}
        </p>
      ) : (
        <ul className="space-y-2" data-review-queue="">
          {rows.map((r) => (
            <li key={r.id} className="space-y-2 rounded-2xl border border-gray-200 bg-white p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-slate-700">
                  {r.parentId ? (
                    <Link href={`/admin/users/${r.parentId}`} className="font-bold text-tm-navy hover:underline">
                      {r.parentName}
                    </Link>
                  ) : (
                    <span className="font-bold text-tm-navy">{r.parentName}</span>
                  )}{' '}
                  reviewed{' '}
                  {r.tutorId ? (
                    <Link href={`/admin/users/${r.tutorId}`} className="font-bold text-tm-navy hover:underline">
                      {r.tutorName}
                    </Link>
                  ) : (
                    <span className="font-bold text-tm-navy">{r.tutorName}</span>
                  )}
                </p>
                <span className="inline-flex items-center gap-1 text-xs font-black text-tm-gold-ink" aria-label={`${r.rating} out of 5`}>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <Star key={n} aria-hidden size={14} className={n <= r.rating ? 'fill-tm-gold stroke-tm-gold' : 'fill-gray-200 stroke-gray-200'} />
                  ))}
                  <span className="ml-1">{r.rating}/5</span>
                </span>
              </div>
              <p className="whitespace-pre-line rounded-xl bg-tm-bg p-3 text-xs text-slate-700">{r.comment}</p>
              <p className="text-[11px] text-gray-500">
                {r.tuitionTitle ? `${r.tuitionTitle} · ` : ''}
                Sent {formatDateTime(r.createdAt)}
                {r.decidedAt ? ` · ${REVIEW_STATUS_LABEL[r.status]} ${formatDateTime(r.decidedAt)}${r.decidedByName ? ` by ${r.decidedByName}` : ''}` : ''}
                {r.reason ? ` · ${r.reason}` : ''}
              </p>
              {r.status === 'pending' && <ReviewDecision reviewId={r.id} />}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
