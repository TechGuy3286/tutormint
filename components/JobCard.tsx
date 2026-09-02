'use client'

import Link from 'next/link'
import { useState } from 'react'
import { GraduationCap, MapPin, Wallet, Clock, Building2 } from 'lucide-react'
import BadgeRow from '@/components/badges/BadgeRow'
import FeaturedTag from '@/components/badges/FeaturedTag'
import AuthGateModal from '@/components/AuthGateModal'
import ReportButton from '@/components/ReportButton'
import type { BadgeName } from '@/lib/planBadges'

// A posted tuition, in the same card language as TutorCard.
//
// The parent's badges are shown because tutors have asked for exactly one
// thing: to know before they spend an application whether the person on the
// other end can actually hire. Only a Featured parent can complete a hire, so
// `parentCanHire` is surfaced as plain words, not a colour.
//
// Applying happens here: guests get the sign-in modal with the job kept as a
// draft, and a signed-in tutor's press goes straight to /api/applications,
// which re-checks every gate (listed, not blocked, job open, not already
// applied, quota). The button never decides anything -- it only reports what
// the server said, including the upgrade path when the refusal is a quota one.

export type JobCardData = {
  id: string
  job_tx_id: string | null
  title: string
  subjects: string[] | null
  class_level: string | null
  city: string | null
  area: string | null
  teaching_mode: string | null
  budget_pkr: number | null
  description: string | null
  created_at: string
  is_featured: boolean | null
  parent_id: string | null
  parent_name: string | null
  parent_badges: BadgeName[]
  parent_can_hire: boolean
}

function postedAgo(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  return new Date(iso).toLocaleDateString('en-PK', { month: 'short', year: 'numeric' })
}

export default function JobCard({
  job,
  href,
  signedIn = false,
  showApply = false,
  applied = false,
}: {
  job: JobCardData
  href?: string
  signedIn?: boolean
  /** Rendered for tutors and guests; a parent browsing their own board has no use for it. */
  showApply?: boolean
  /** This tutor has already applied. */
  applied?: boolean
}) {
  const [gateOpen, setGateOpen] = useState(false)
  const [state, setState] = useState<'idle' | 'sending' | 'done'>(applied ? 'done' : 'idle')
  const [notice, setNotice] = useState<string | null>(null)
  const [upgrade, setUpgrade] = useState<string | null>(null)
  const detailHref = href ?? `/browse/tuitions?job=${job.job_tx_id ?? job.id}`

  const apply = async () => {
    if (!signedIn) return setGateOpen(true)
    setState('sending')
    setNotice(null)
    setUpgrade(null)
    try {
      const res = await fetch('/api/applications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId: job.id }),
      })
      const json = await res.json()
      if (!res.ok) {
        setNotice(json.error ?? 'Could not send your application.')
        setUpgrade(json.upgrade ?? null)
        setState('idle')
        return
      }
      setState('done')
      setNotice('Application sent.')
    } catch {
      setNotice('Could not send your application.')
      setState('idle')
    }
  }

  return (
    <>
      <article className="relative rounded-2xl border border-gray-200 bg-white p-4 transition-shadow hover:shadow-md sm:p-6">
        {job.is_featured && <FeaturedTag className="absolute right-3 top-3 sm:right-4 sm:top-4" />}

        <div className="space-y-3">
          <div className="space-y-1 pr-16 sm:pr-20">
            <h3 className="text-base font-black leading-snug text-tm-navy sm:text-lg">
              <Link href={detailHref} className="inline-block py-0.5 hover:underline">
                {job.title}
              </Link>
            </h3>
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-gray-500">
              <Clock size={12} className="shrink-0" />
              <span>{postedAgo(job.created_at)}</span>
              {job.parent_name && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="font-semibold text-slate-700">{job.parent_name}</span>
                </>
              )}
              {job.parent_badges.length > 0 && <BadgeRow badges={job.parent_badges} size="sm" />}
            </p>
          </div>

          {job.subjects && job.subjects.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {job.subjects.map((s) => (
                <span
                  key={s}
                  className="rounded-full bg-tm-bg px-2.5 py-1 text-[11px] font-bold text-slate-700 ring-1 ring-gray-200"
                >
                  {s}
                </span>
              ))}
            </div>
          )}

          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {job.class_level && (
              <p className="flex items-center gap-2 text-xs text-slate-700">
                <GraduationCap size={14} className="shrink-0 text-gray-500" />
                {job.class_level}
              </p>
            )}
            <p className="flex items-center gap-2 text-xs text-slate-700">
              <MapPin size={14} className="shrink-0 text-gray-500" />
              {[job.area, job.city].filter(Boolean).join(', ') || job.teaching_mode || 'Flexible'}
            </p>
            {job.teaching_mode && (
              <p className="flex items-center gap-2 text-xs text-slate-700">
                <Building2 size={14} className="shrink-0 text-gray-500" />
                {job.teaching_mode}
              </p>
            )}
            {job.budget_pkr ? (
              <p className="flex items-center gap-2 text-xs font-black text-tm-navy">
                <Wallet size={14} className="shrink-0 text-gray-500" />
                Rs. {job.budget_pkr.toLocaleString('en-PK')} / month
              </p>
            ) : null}
          </div>

          {job.description && (
            <p className="line-clamp-2 text-xs leading-relaxed text-slate-700">{job.description}</p>
          )}

          {/* Tutor-side steering: say plainly who can finish a hire. */}
          <p className="text-[11px] font-semibold text-gray-500">
            {job.parent_can_hire
              ? 'Featured parent — can complete a hire'
              : 'Verified parent — cannot complete a hire yet'}
          </p>

          <div className="flex flex-col gap-2 pt-1 sm:flex-row">
            <Link
              href={detailHref}
              className="inline-flex min-h-[44px] flex-1 items-center justify-center rounded-xl border border-gray-200 bg-tm-bg px-4 text-xs font-bold text-slate-700 transition-colors hover:bg-gray-100"
            >
              View details
            </Link>
            {showApply && (
              <button
                type="button"
                onClick={apply}
                disabled={state !== 'idle'}
                className="inline-flex min-h-[44px] flex-1 items-center justify-center rounded-xl bg-tm-red px-4 text-xs font-bold text-white transition-colors hover:bg-tm-red-hover disabled:bg-gray-300"
              >
                {state === 'done' ? 'Applied' : state === 'sending' ? 'Sending…' : 'Apply'}
              </button>
            )}
          </div>

          {/* Reporting a post is only meaningful once signed in -- an
              anonymous report has nobody to answer questions about it. */}
          {signedIn && job.parent_id && (
            <ReportButton
              reportedId={job.parent_id}
              targetType="job"
              targetId={job.id}
              label="Report this post"
            />
          )}

          {notice && (
            <p className="text-[11px] font-semibold leading-snug text-slate-700">
              {notice}{' '}
              {upgrade && (
                <Link href={upgrade} className="font-bold text-tm-red underline">
                  See options
                </Link>
              )}
            </p>
          )}
        </div>
      </article>

      <AuthGateModal
        open={gateOpen}
        intent="apply"
        draft={{ jobId: job.id, title: job.title }}
        onClose={() => setGateOpen(false)}
      />
    </>
  )
}
