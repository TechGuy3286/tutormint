'use client'

import { applicationStatus } from '@/lib/display'

import { postGated } from '@/lib/gatedFetch'
import { useUpgradeSheet } from '@/components/upgrade/UpgradeProvider'
import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Lock } from 'lucide-react'
import BadgeRow from '@/components/badges/BadgeRow'
import type { BadgeName } from '@/lib/planBadges'

// The applicants on one job, and what a parent can do with them.
//
// Hire is the line between the free and Featured tiers. A free parent sees the
// button, presses it, and is told plainly what it costs and why -- rather than
// a greyed-out control with no explanation, which teaches people nothing and
// makes them think the site is broken. The route refuses independently, so the
// button being present is not the same as the action being available.

export type Applicant = {
  id: string
  tutorId: string
  tutorName: string
  tutorSlug: string | null
  headline: string | null
  city: string | null
  ratingAvg: number
  ratingCount: number
  badges: BadgeName[]
  message: string | null
  status: 'applied' | 'shortlisted' | 'hired' | 'rejected'
  withdrawn: boolean
  createdAt: string
}

const BTN =
  'inline-flex min-h-[44px] flex-1 items-center justify-center rounded-xl px-3 text-xs font-bold transition-colors disabled:opacity-60'

export default function ApplicantList({
  applicants,
  canHire,
  jobStatus,
}: {
  applicants: Applicant[]
  canHire: boolean
  jobStatus: string
}) {
  const router = useRouter()
  const upgradeSheet = useUpgradeSheet()
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const act = async (url: string, payload: Record<string, unknown>, id: string) => {
    setBusy(id)
    setError(null)
    const r = await postGated(url, payload, upgradeSheet?.showGate)
    // A gate is not an error: the sheet has said what is needed and offers the
    // one tap that fixes it. Echoing the sentence here as well would read as a
    // separate failure.
    if (r.ok) router.refresh()
    else if (!r.gated) setError(r.error)
    setBusy(null)
  }

  const message = async (tutorId: string) => {
    setBusy(tutorId)
    setError(null)
    const r = await postGated<{ threadId: string }>(
      '/api/messages/thread',
      { otherId: tutorId },
      upgradeSheet?.showGate,
    )
    if (r.ok) router.push(`/messages/${r.data.threadId}`)
    else if (!r.gated) setError(r.error)
    setBusy(null)
  }

  const live = applicants.filter((a) => !a.withdrawn)

  if (live.length === 0) {
    return (
      <p className="rounded-2xl border border-gray-200 bg-white p-6 text-center text-xs text-gray-500">
        No applications yet. Tutors whose subjects match will see this job on their dashboard.
      </p>
    )
  }

  return (
    <div className="space-y-3">
      {/* Real failures only. A plan or suspension refusal is the upgrade
          sheet's, so no 'See Featured' link competes with its CTA. */}
      {error && (
        <p className="rounded-2xl border border-tm-red/30 bg-tm-tint-red p-3 text-xs font-bold text-tm-red">
          {error}
        </p>
      )}

      {live.map((a) => (
        <article
          key={a.id}
          className={`space-y-3 rounded-2xl border bg-white p-4 ${
            a.status === 'hired' ? 'border-tm-green-deep ring-1 ring-tm-green-deep' : 'border-gray-200'
          }`}
        >
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-sm font-black text-tm-navy">
              {a.tutorSlug ? (
                <Link href={`/tutor/${a.tutorSlug}`} className="hover:underline">
                  {a.tutorName}
                </Link>
              ) : (
                a.tutorName
              )}
            </h3>
            <span className="text-[10px] font-bold uppercase tracking-wide text-gray-500">
              {applicationStatus(a.status)}
            </span>
          </div>

          {a.badges.length > 0 && <BadgeRow badges={a.badges} size="sm" showLabel />}

          <p className="text-[11px] text-gray-500">
            {a.headline ?? 'Tutor'}
            {a.city ? ` · ${a.city}` : ''}
            {a.ratingCount > 0 ? ` · ★ ${a.ratingAvg.toFixed(1)} (${a.ratingCount})` : ''}
          </p>

          {a.message && (
            <p className="rounded-xl bg-tm-bg p-3 text-xs leading-relaxed">{a.message}</p>
          )}

          {jobStatus === 'open' && a.status !== 'hired' && (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <button
                type="button"
                disabled={busy === a.id}
                onClick={() =>
                  act(
                    '/api/applications/status',
                    {
                      applicationId: a.id,
                      status: a.status === 'shortlisted' ? 'applied' : 'shortlisted',
                    },
                    a.id,
                  )
                }
                className={`${BTN} border border-gray-200 text-slate-700`}
              >
                {a.status === 'shortlisted' ? 'Un-shortlist' : 'Shortlist'}
              </button>

              <button
                type="button"
                disabled={busy === a.tutorId}
                onClick={() => message(a.tutorId)}
                className={`${BTN} bg-tm-green-deep text-white`}
              >
                Message
              </button>

              <button
                type="button"
                disabled={busy === a.id}
                onClick={() =>
                  act('/api/applications/status', { applicationId: a.id, status: 'rejected' }, a.id)
                }
                className={`${BTN} border border-gray-200 text-slate-700`}
              >
                Not suitable
              </button>

              <button
                type="button"
                disabled={busy === a.id}
                onClick={() => act('/api/parent/hire', { applicationId: a.id }, a.id)}
                className={`${BTN} ${
                  canHire ? 'bg-tm-red text-white' : 'bg-tm-gold text-tm-navy'
                }`}
              >
                {canHire ? (
                  'Hire'
                ) : (
                  <>
                    <Lock size={12} className="mr-1" />
                    Upgrade to hire
                  </>
                )}
              </button>
            </div>
          )}

          {a.status === 'hired' && (
            <p className="rounded-xl bg-tm-green-deep/10 p-3 text-center text-[11px] font-black text-tm-green-deep">
              Hired for this tuition
            </p>
          )}
        </article>
      ))}
    </div>
  )
}
