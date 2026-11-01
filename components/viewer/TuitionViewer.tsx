'use client'

import { createContext, useContext, useEffect, useState } from 'react'
import Link from 'next/link'
import { useHeaderSession } from '@/components/session/HeaderSessionProvider'
import ApplyPanel from '@/app/(site)/tuitions/[city]/[slug]/ApplyPanel'
import ResumeInline from '@/app/(site)/tuitions/[city]/[slug]/ResumeInline'
import RefreshInline from '@/app/(site)/tuitions/[city]/[slug]/RefreshInline'
import ContactReveal from '@/components/ContactReveal'
import ViewNumberLink from '@/components/ViewNumberLink'
import ReportButton from '@/components/ReportButton'
import { genderApplyBlocked, genderPrefSentence } from '@/lib/genderPref'
import { showApplyForViewer, type TuitionViewer } from '@/lib/tuitionViewerCore'
import { posterToolsVisible, keepOpenNotice } from '@/lib/posterToolsCore'

// The signed-in parts of a cached tuition page (push 3, owner 1 Nov 2026). The
// page is the same HTML for everyone and renders as a guest sees it; when the
// visitor has a sign-in cookie this asks /api/viewer/tuition once and the parts
// below redraw for them. Each part reads exactly what the server page read
// before, so a signed-in visitor sees what they saw before.

const Ctx = createContext<TuitionViewer | null>(null)

export default function TuitionViewerProvider({ jobId, children }: { jobId: string; children: React.ReactNode }) {
  const session = useHeaderSession()
  const [viewer, setViewer] = useState<TuitionViewer | null>(null)
  useEffect(() => {
    // Signed out: nothing to ask; the value below reads null (no state reset).
    if (session.status !== 'signed-in') return
    let live = true
    fetch(`/api/viewer/tuition?id=${encodeURIComponent(jobId)}`, { cache: 'no-store', credentials: 'same-origin' })
      .then((r) => (r.ok ? (r.json() as Promise<TuitionViewer>) : null))
      .then((v) => live && setViewer(v))
      .catch(() => {})
    return () => {
      live = false
    }
  }, [session.status, jobId])
  return <Ctx.Provider value={session.status === 'signed-in' ? viewer : null}>{children}</Ctx.Provider>
}

function useViewer(): Extract<TuitionViewer, { signedIn: true }> | null {
  const v = useContext(Ctx)
  return v && v.signedIn ? v : null
}

/** Inside the paused banner: the poster's Resume, or an admin's link. */
export function PosterBannerActions({ jobId, paused }: { jobId: string; paused: boolean }) {
  const v = useViewer()
  if (!v) return null
  if (paused && posterToolsVisible(v, v.teamPost)) return <ResumeInline jobId={jobId} admin={!v.isPoster} />
  if (v.isAdmin && !v.isPoster)
    return (
      <Link
        href={`/admin/jobs/${jobId}`}
        className="inline-flex min-h-[44px] items-center justify-center rounded-xl border border-current px-4 text-xs font-bold"
      >
        Manage this tuition in admin
      </Link>
    )
  return null
}

/** Move to top and Keep it open — the tuition's poster only (the parent who
 *  posted it, or staff on a team-posted tuition). */
export function PosterOpenTools({ jobId, isOpen }: { jobId: string; isOpen: boolean }) {
  const v = useViewer()
  if (!v || !isOpen || !posterToolsVisible(v, v.teamPost)) return null
  const admin = v.isAdmin && !v.isPoster
  return (
    <>
      <RefreshInline jobId={jobId} admin={admin} nextAt={v.refreshNextAt} />
      {v.pauseDaysLeft != null && (
        <RefreshInline jobId={jobId} admin={admin} nextAt={v.refreshNextAt} keepOpen notice={keepOpenNotice(v.pauseDaysLeft)} />
      )}
    </>
  )
}

/** The masked contact line: teaser + "View number", or the number for a tutor
 *  who already has access. */
export function ContactLine({ jobId, teaser }: { jobId: string; teaser: string }) {
  const v = useViewer()
  const revealed = v?.revealedContact ?? null
  return (
    <p className="flex flex-wrap items-center gap-1.5 rounded-xl bg-tm-tint-navy px-3 py-2 text-sm font-semibold text-tm-navy">
      Contact: {revealed ? null : <span className="tabular-nums">{teaser}</span>}
      <ViewNumberLink key={v ? 'viewer' : 'guest'} jobId={jobId} signedIn={!!v} canReveal={!!v?.isTutor} initialContact={revealed} />
    </p>
  )
}

/** The Apply panel, for a guest or a tutor on an open tuition. */
export function ApplyIsland({
  jobId,
  title,
  isOpen,
  underReview,
  genderPreference,
  city,
}: {
  jobId: string
  title: string
  isOpen: boolean
  underReview: boolean
  genderPreference: string | null
  city: string | null
}) {
  const raw = useContext(Ctx)
  const v = useViewer()
  if (!showApplyForViewer(raw, isOpen)) return null
  const blocked = v?.isTutor && genderApplyBlocked(genderPreference, v.tutorGender) ? genderPrefSentence(genderPreference) : null
  return (
    <div className="border-t border-gray-100 pt-4">
      <ApplyPanel
        key={v ? 'viewer' : 'guest'}
        jobId={jobId}
        title={title}
        signedIn={!!v}
        applied={!!v?.applied}
        underReview={underReview}
        genderBlockedNotice={blocked}
        city={city}
        applyBlock={v?.applyBlock ?? null}
        feeReceiptPending={!!v?.feeReceiptPending}
      />
    </div>
  )
}

/** A tutor's contact reveal on the "Posted by" card. */
export function TutorContactReveal({ jobId, className }: { jobId: string; className?: string }) {
  const v = useViewer()
  if (!v?.isTutor) return null
  return <ContactReveal jobId={jobId} className={className} />
}

/** "Report this post" — signed-in visitors only. */
export function SignedInReport(props: React.ComponentProps<typeof ReportButton>) {
  const v = useViewer()
  if (!v) return null
  return <ReportButton {...props} />
}

/** The team tuition's box (contact reveal + Report) — signed-in visitors only. */
export function TeamTuitionBox({ jobId, showContact }: { jobId: string; showContact: boolean }) {
  const v = useViewer()
  if (!v) return null
  return (
    <section className="space-y-3 rounded-2xl border border-gray-200 bg-white p-4 sm:p-5">
      {v.isTutor && showContact && <ContactReveal jobId={jobId} />}
      <ReportButton reportedId={null} targetType="job" targetId={jobId} teamJob label="Report this post" />
    </section>
  )
}
