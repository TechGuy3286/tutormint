import { ClipboardList, Users } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import Avatar from '@/components/Avatar'
import StatusChip from '@/components/admin/StatusChip'
import PublicProfileLink from '@/components/admin/PublicProfileLink'
import { requireAdminRole, roleSatisfies, SCREEN_ACCESS } from '@/lib/adminAuth'
import { createAdminClient } from '@/lib/supabase/admin'
import { loadDirectoryStatus } from '@/lib/directoryStatus'
import { loadDocumentStatuses } from '@/lib/tutorDocuments'
import { deriveCnicStatus } from '@/lib/cnicStatus'
import TutorDocumentReview from '@/components/admin/TutorDocumentReview'
import { formatDate } from '@/lib/datetime'
import { jobType, jobTypesLabel, verificationStatus } from '@/lib/display'
import SlugField from './SlugField'

// One tutor, as staff.
//
// This screen exists for the profile address. Everything else about a member
// -- their timeline, payments, suspension, the whole history -- is on
// /admin/users/[id] and is not duplicated here; there is a link to it, and to
// the moderation queue where the video and documents are decided.
//
// READ is the tutors screen (admin + operations), so operations working the
// queue can open a tutor from it and see what is being reviewed. EDITING the
// address is admin-only, and the route re-checks that regardless of what
// rendered -- a role must not be able to do through the API what the UI hides.

export const dynamic = 'force-dynamic'

export default async function AdminTutorPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireAdminRole(...SCREEN_ACCESS.tutors)
  const { id } = await params

  const admin = createAdminClient()
  if (!admin) {
    return (
      <p className="rounded-xl border border-tm-red/30 bg-tm-tint-red p-4 text-xs font-bold text-tm-red">
        SUPABASE_SERVICE_ROLE_KEY is not configured on the server.
      </p>
    )
  }

  const [{ data: tutor }, { data: profile }] = await Promise.all([
    admin
      .from('tutor_profiles')
      .select(
        'id, slug, full_name, headline, city, area, teaching_mode, job_types, verification_status, video_status, rating_avg, rating_count, imported, claimed_at, created_at',
      )
      .eq('id', id)
      .maybeSingle(),
    admin
      .from('profiles')
      .select('id, full_name, avatar_url, role, is_suspended, profile_completion, verification_state, cnic_verified_at, cnic_number, cnic_image_path')
      .eq('id', id)
      .maybeSingle(),
  ])

  if (!tutor || profile?.role !== 'tutor') notFound()

  const { data: history } = await admin
    .from('slug_history')
    .select('old_slug, created_at')
    .eq('tutor_id', id)
    .order('created_at', { ascending: false })
    .limit(20)

  const canEdit = roleSatisfies(actor.adminRole, SCREEN_ACCESS.tutorSlug)
  const canReview = roleSatisfies(actor.adminRole, SCREEN_ACCESS.tutors)
  // One name (PR66 §5): the canonical is profiles.full_name (what the member sees
  // on their dashboard); fall back to tutor_profiles only if it is blank.
  const name =
    ((profile.full_name as string) || '').trim() || ((tutor.full_name as string) || '').trim() || 'Tutor'
  const completion = Number(profile.profile_completion ?? 0)
  // One CNIC status (PR66 §4): the header must not claim "Verified" when the CNIC
  // is not truly approved (marker + number + image). Display-only; data unchanged.
  const cnicApproved =
    deriveCnicStatus({
      verification_state: profile.verification_state as string | null,
      cnic_verified_at: profile.cnic_verified_at as string | null,
      cnic_number: profile.cnic_number as string | null,
      cnic_image_path: profile.cnic_image_path as string | null,
    }) === 'approved'
  const verifiedShown = (tutor.verification_status as string) === 'verified' && cnicApproved
  const headerStatus = profile.is_suspended
    ? 'suspended'
    : verifiedShown
      ? 'verified'
      : (tutor.verification_status as string) === 'rejected'
        ? 'rejected'
        : 'pending'

  // Identity documents for review (PR60): the newest CNIC front/back and selfie,
  // plus each item's approval status. Read-resilient (statuses default to none
  // before the migration).
  const [{ data: idDocs }, docStatuses] = await Promise.all([
    admin
      .from('user_documents')
      .select('id, kind, label, created_at')
      .eq('user_id', id)
      .in('kind', ['cnic', 'selfie'])
      .order('created_at', { ascending: false }),
    loadDocumentStatuses(id),
  ])
  const docs = (idDocs ?? []) as { id: string; kind: string; label: string | null }[]
  const cnicFront = docs.find((d) => d.kind === 'cnic' && (d.label ?? 'front') !== 'back')
  const cnicBack = docs.find((d) => d.kind === 'cnic' && d.label === 'back')
  const selfieDoc = docs.find((d) => d.kind === 'selfie')
  // The shared listing rule, so "Open public profile" shows only when the page
  // resolves (PR39).
  const directory = await loadDirectoryStatus(id)

  return (
    <div className="space-y-4">
      <section className="flex items-start gap-4 rounded-2xl border border-gray-200 bg-white p-4">
        <Avatar
          name={name}
          src={profile.avatar_url as string | null}
          seed={id}
          decorative
          className="h-14 w-14 shrink-0 text-base"
        />
        <div className="min-w-0 flex-1 space-y-1.5">
          <h2 className="truncate text-base font-black text-tm-navy">{name}</h2>
          {tutor.headline && (
            <p className="truncate text-xs text-gray-500">{tutor.headline as string}</p>
          )}
          <div className="flex flex-wrap items-center gap-1.5">
            <StatusChip
              status={headerStatus}
              label={
                profile.is_suspended
                  ? 'Suspended'
                  : verifiedShown
                    ? 'Verified'
                    : (tutor.verification_status as string) === 'verified'
                      ? 'CNIC pending'
                      : verificationStatus(tutor.verification_status as string)
              }
            />
            <StatusChip status={tutor.video_status as string} label={`Video: ${tutor.video_status ?? 'none'}`} />
            <StatusChip
              status={completion >= 100 ? 'verified' : 'pending'}
              label={`${completion}% complete`}
            />
            {tutor.imported && (
              <StatusChip
                status={tutor.claimed_at ? 'verified' : 'pending'}
                label={tutor.claimed_at ? 'Import claimed' : 'Import unclaimed'}
              />
            )}
          </div>
          <p className="text-[11px] text-gray-500">
            {[tutor.area, tutor.city].filter(Boolean).join(', ') || 'No location set'}
            {jobTypesLabel(tutor.job_types as string[] | null)
              ? ` · ${jobTypesLabel(tutor.job_types as string[] | null)}`
              : ''}
            {' · '}
            Joined {formatDate(tutor.created_at as string)}
          </p>
        </div>
      </section>

      <SlugField tutorId={id} initialSlug={(tutor.slug as string | null) ?? null} canEdit={canEdit} />

      <TutorDocumentReview
        tutorId={id}
        canReview={canReview}
        avatarUrl={(profile.avatar_url as string | null) ?? null}
        cnicFrontId={cnicFront?.id ?? null}
        cnicBackId={cnicBack?.id ?? null}
        selfieDocId={selfieDoc?.id ?? null}
        statuses={docStatuses}
      />

      {/* The redirects that exist because of past changes. Shown so an admin
          can see what an address change actually left behind, rather than
          taking the promise on trust. */}
      <section className="space-y-2 rounded-2xl border border-gray-200 bg-white p-4">
        <h2 className="text-xs font-black uppercase tracking-wide text-gray-500">
          Retired addresses ({(history ?? []).length})
        </h2>
        {(history ?? []).length === 0 ? (
          <p className="text-xs text-gray-500">
            This tutor&apos;s address has never changed, so there is nothing redirecting here yet.
          </p>
        ) : (
          <ul className="space-y-1">
            {(history ?? []).map((h) => (
              <li key={h.old_slug as string} className="flex flex-wrap items-baseline gap-x-2 text-xs">
                <span className="font-bold text-slate-700">/tutor/{h.old_slug as string}</span>
                <span aria-hidden className="text-gray-500">
                  →
                </span>
                <span className="text-gray-500">
                  current, since {formatDate(h.created_at as string)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="flex flex-col gap-2 sm:flex-row">
        <PublicProfileLink
          slug={(tutor.slug as string | null) ?? null}
          listed={directory.listed}
          blockers={directory.blockers}
          completion={completion}
        />
        <Link
          href={`/admin/users/${id}`}
          className="gap-1.5 inline-flex min-h-[44px] items-center justify-center rounded-xl border border-gray-200 bg-white px-4 text-xs font-bold text-slate-700 hover:border-tm-navy"
        >
          <Users aria-hidden size={14} />
          Member record and timeline
        </Link>
        <Link
          href="/admin/tutors"
          className="gap-1.5 inline-flex min-h-[44px] items-center justify-center rounded-xl border border-gray-200 bg-white px-4 text-xs font-bold text-slate-700 hover:border-tm-navy"
        >
          <ClipboardList aria-hidden size={14} />
          Moderation queue
        </Link>
      </div>
    </div>
  )
}
