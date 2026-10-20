import Link from 'next/link'
import { avatarOriginalUrl } from '@/lib/avatarCrop'
import SecondRoleCard from './SecondRoleCard'
import { secondRoleState } from '@/lib/secondRole'
import { notFound } from 'next/navigation'
import { requireAdminRole, roleBadge, roleSatisfies, SCREEN_ACCESS, roleMayWrite } from '@/lib/adminAuth'
import { formatDate, formatDateTime } from '@/lib/datetime'
import { describeUtm } from '@/lib/utm'
import { describeSource } from '@/lib/signupSourceCore'
import { applicationStatus, jobStatus } from '@/lib/display'
import { createAdminClient } from '@/lib/supabase/admin'
import MemberActions from './MemberActions'
import { loadDirectoryStatus } from '@/lib/directoryStatus'
import { loadStaffCountsFor } from '@/lib/staffActivity'
import StaffActivityTable from '@/components/admin/StaffActivityTable'
import { flagStageLabel } from '@/lib/abuse/warnings'
import { flagSourceLabel } from '@/lib/adminFlagsShared'
import Timeline from './Timeline'
import { formatName } from '@/lib/formatName'
import { loadParentDocs } from '@/lib/parentDocuments'
import { loadDocumentStatuses } from '@/lib/tutorDocuments'
import { loadAdminLockInfo, type AdminLockInfo } from '@/lib/docLocks'
import { maskCnicHeavy } from '@/lib/cnic'
import ParentDocumentReview from '@/components/admin/ParentDocumentReview'
import TutorDocumentReview from '@/components/admin/TutorDocumentReview'
import ProfileShareButtons from '@/components/admin/ProfileShareButtons'
import { profileShareState } from '@/lib/profileShareCore'
import { loadUnifiedTimeline } from '@/lib/memberTimeline'
import { activitySummaryLine, parseTimelineGroup } from '@/lib/memberTimelineCore'
import { loadActivitySummary } from '@/lib/adminActivity'
import { docSummary } from '@/lib/tutorDocSummaryCore'
import { documentsFact, emptySectionsLine, parentDocKind, tutorStatusFact, videoFact, type MemberBox } from '@/lib/memberPageCore'
import { paymentLabel, paymentNeedsFollowUp, paymentPlanName, type PaymentFacts } from '@/lib/paymentLabelCore'
import { fillPaymentNotFinished, payAgainLink, PAYMENT_NOT_FINISHED_FALLBACK, PAYMENT_NOT_FINISHED_KEY } from '@/lib/startedPaymentCore'
import { normalisePkMobile } from '@/lib/phone'
import { ExternalLink } from 'lucide-react'
import PaymentFollowUp from './PaymentFollowUp'

// One member, everything about them in one place.
//
// PRIVACY: message events appear on the timeline as "a message was sent in
// thread X" and never as content. There is no way to open a conversation from
// this page — reading a thread requires a report that names it, which is the
// line CLAUDE.md draws and the reason the reports queue exists.
//
// Everything here is read with the service-role client: an admin needs to see
// a member's payments and subscriptions, and those tables are self-read under
// RLS by design.

export const dynamic = 'force-dynamic'

/** The request's clock, read once per render. */
const requestNow = () => Date.now()


export default async function AdminMemberPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ group?: string }>
}) {
  const actor = await requireAdminRole(...SCREEN_ACCESS.users)
  const { id } = await params
  const group = parseTimelineGroup((await searchParams).group)

  const admin = createAdminClient()
  if (!admin) {
    return (
      <p className="rounded-xl border border-tm-red/30 bg-tm-tint-red p-4 text-xs font-bold text-tm-red">
        SUPABASE_SERVICE_ROLE_KEY is not configured on the server.
      </p>
    )
  }

  const { data: profile } = await admin
    .from('profiles')
    .select(
      'id, full_name, email, phone_number, whatsapp, avatar_url, role, admin_role, city, profile_completion, cnic_verified_at, address_verified_at, verification_state, is_suspended, suspension_reason, suspended_at, suspended_by, is_banned, banned_reason, paused_by_user_at, phone_verified_via, phone_verified_at, created_at, utm_source, utm_medium, utm_campaign, utm_content, linked_account_id',
    )
    .eq('id', id)
    .maybeSingle()

  if (!profile) notFound()

  const isTutor = profile.role === 'tutor'
  // The one shared listing rule, so "Open public profile" shows only when the
  // page actually resolves (PR39).
  const directory = isTutor ? await loadDirectoryStatus(id) : null

  const [
    { data: tutor },
    { data: jobs },
    { data: applications },
    { data: payments },
    { data: subs },
    { data: reportsAbout },
    { data: reportsBy },
    { data: penalties },
    { data: abuseFlags },
  ] = await Promise.all([
    admin
      .from('tutor_profiles')
      .select('id, slug, verification_status, verified_fee_paid_at, video_status, video_visibility, rating_avg, rating_count, is_featured')
      .eq('id', id)
      .maybeSingle(),
    admin
      .from('jobs')
      .select('id, job_tx_id, title, status, is_featured, created_at')
      .eq('parent_id', id)
      .order('created_at', { ascending: false })
      .limit(25),
    admin
      .from('applications')
      .select('id, job_id, status, withdrawn_at, created_at')
      .eq('tutor_id', id)
      .order('created_at', { ascending: false })
      .limit(25),
    admin
      .from('payments')
      .select('id, plan_code, amount_pkr, status, provider, created_at, screenshot_path, reference, refunded_amount_pkr, refunded_at, checkout_closed_at, checkout_close_reason')
      .eq('user_id', id)
      .order('created_at', { ascending: false })
      .limit(25),
    admin
      .from('subscriptions')
      .select('id, plan_code, status, starts_at, expires_at, source')
      .eq('user_id', id)
      .order('starts_at', { ascending: false })
      .limit(25),
    admin
      .from('reports')
      .select('id, reason, status, target_type, created_at')
      .eq('reported_id', id)
      .order('created_at', { ascending: false })
      .limit(25),
    admin
      .from('reports')
      .select('id, reason, status, target_type, created_at')
      .eq('reporter_id', id)
      .order('created_at', { ascending: false })
      .limit(25),
    admin
      .from('penalties_log')
      .select('id, kind, reason, created_at')
      .eq('user_id', id)
      .order('created_at', { ascending: false })
      .limit(25),
    admin
      .from('abuse_flags')
      .select('id, source, matched, status, warning_level, withheld, created_at')
      .eq('subject_id', id)
      .order('created_at', { ascending: false })
      .limit(25),
  ])

  // Titles for the tuitions this member applied to, so the applications panel
  // names the job rather than repeating its own status. One query for the
  // whole panel, and it is what makes each row linkable.
  const appliedJobIds = Array.from(
    new Set((applications ?? []).map((a) => a.job_id as string).filter(Boolean)),
  )
  const { data: appliedJobs } = appliedJobIds.length
    ? await admin.from('jobs').select('id, title').in('id', appliedJobIds)
    : { data: [] as Record<string, unknown>[] }
  const appliedJobTitle = new Map(
    (appliedJobs ?? []).map((j) => [j.id as string, j.title as string]),
  )

  // ONE timeline (owner, 20 Oct 2026): the member's own events, every admin
  // action about them (with who did it) and — for the roles that saw the old
  // Activity box — their visits. lib/memberTimeline.
  const withVisits = roleSatisfies(actor.adminRole, ['admin'])
  const [timeline, activity] = await Promise.all([
    loadUnifiedTimeline({ userId: id, group, withVisits }),
    withVisits ? loadActivitySummary(id) : Promise.resolve(null),
  ])

  // A staff account's work never shows in "Jobs (0)": a team tuition is posted
  // on the team account, so it belongs to that account, not the staff member.
  // The audit log records who ACTED, so read the staff card by actor (PR29 §2).
  const isStaff = profile.role === 'admin'
  const staffCounts = isStaff ? await loadStaffCountsFor(id) : null

  // ---- Documents box (owner, 8 Oct 2026): every member's submitted identity
  // documents, each approved or rejected on its own, right under the summary.
  // Parents: CNIC front + back and the typed address. Tutors: CNIC, profile
  // photo and selfie (the same review the tutor record uses). Images are served
  // only through /api/documents/[id]/preview (owner or staff, never public).
  const isParent = profile.role === 'parent' || profile.role === 'academy'
  const secondRole = await secondRoleState(id)
  const canReviewParent = roleMayWrite(actor.adminRole, SCREEN_ACCESS.parents)
  const canReviewTutor = roleMayWrite(actor.adminRole, SCREEN_ACCESS.tutors)
  const parentDocs = isParent ? await loadParentDocs(id) : null
  let tutorDocs: {
    cnicFrontId: string | null
    cnicBackId: string | null
    selfieId: string | null
    statuses: Awaited<ReturnType<typeof loadDocumentStatuses>>
    cnicNumberMasked: string | null
  } | null = null
  // Approved-document locks (owner, 9 Oct 2026) for whichever card renders.
  const lockInfo: AdminLockInfo | null = isTutor || isParent ? await loadAdminLockInfo(id) : null
  const canUnlock = roleMayWrite(actor.adminRole, SCREEN_ACCESS.documentUnlock)
  if (isTutor) {
    const { data: numRow } = await admin.from('profiles').select('cnic_number').eq('id', id).maybeSingle()
    const [{ data: idDocs }, statuses] = await Promise.all([
      admin
        .from('user_documents')
        .select('id, kind, label, created_at')
        .eq('user_id', id)
        .in('kind', ['cnic', 'selfie'])
        .eq('status', 'active')
        .order('created_at', { ascending: false }),
      loadDocumentStatuses(id),
    ])
    const d = (idDocs ?? []) as { id: string; kind: string; label: string | null }[]
    tutorDocs = {
      cnicFrontId: d.find((x) => x.kind === 'cnic' && (x.label ?? 'front') !== 'back')?.id ?? null,
      cnicBackId: d.find((x) => x.kind === 'cnic' && x.label === 'back')?.id ?? null,
      selfieId: d.find((x) => x.kind === 'selfie')?.id ?? null,
      statuses,
      cnicNumberMasked: maskCnicHeavy((numRow?.cnic_number as string | null) ?? null),
    }
  }
  // The Documents fact uses the tutor cards' words and colours (owner, 20 Oct
  // 2026): green approved, amber waiting or partly approved, red only for
  // rejected, grey for not uploaded.
  const docKind = tutorDocs
    ? docSummary(tutorDocs.statuses).kind
    : parentDocs
      ? parentDocKind([parentDocs.cnic, parentDocs.addressItem])
      : null
  const docFact = docKind ? documentsFact(docKind) : null

  // Copy profile link / Share on WhatsApp — the public address, or why not.
  const share = isTutor
    ? profileShareState({ slug: (tutor?.slug as string | null) ?? null, listed: !!directory?.listed, blockers: directory?.blockers ?? [] })
    : null

  // Plain payment labels (owner, 20 Oct 2026). Amounts only for the viewers who
  // may see amounts (SCREEN_ACCESS.paymentAmounts: the Owner and the Partner).
  const showAmounts = roleSatisfies(actor.adminRole, SCREEN_ACCESS.paymentAmounts)
  const nowMs = requestNow()
  const paymentRows = (payments ?? []).map((p) => {
    const facts: PaymentFacts = {
      planCode: (p.plan_code as string | null) ?? null,
      amountPkr: (p.amount_pkr as number | null) ?? null,
      status: p.status as string,
      provider: (p.provider as string | null) ?? null,
      createdAt: p.created_at as string,
      hasReceipt: !!p.screenshot_path || !!(p.reference as string | null)?.trim(),
      refundedAmountPkr: (p.refunded_amount_pkr as number | null) ?? null,
      refundedAt: (p.refunded_at as string | null) ?? null,
      checkoutClosedAt: (p.checkout_closed_at as string | null) ?? null,
      checkoutCloseReason: (p.checkout_close_reason as string | null) ?? null,
    }
    return { id: p.id as string, facts }
  })
  const memberMsisdn = normalisePkMobile((profile.whatsapp as string | null) ?? (profile.phone_number as string | null) ?? null)
  const callMsisdn = normalisePkMobile((profile.phone_number as string | null) ?? (profile.whatsapp as string | null) ?? null)
  let notFinishedBody = PAYMENT_NOT_FINISHED_FALLBACK
  if (memberMsisdn && paymentRows.some((r) => paymentNeedsFollowUp(r.facts, nowMs))) {
    const { data: tpl } = await admin.from('admin_message_templates').select('body').eq('key', PAYMENT_NOT_FINISHED_KEY).maybeSingle()
    if (tpl?.body) notFinishedBody = tpl.body as string
  }
  const followUpHref = (planCode: string | null) =>
    memberMsisdn
      ? `https://wa.me/${memberMsisdn}?text=${encodeURIComponent(fillPaymentNotFinished(notFinishedBody, { name: formatName(profile.full_name as string | null), payLink: payAgainLink(planCode) }))}`
      : null

  // Only the boxes with something in them; the rest on one grey line.
  const boxes: Record<MemberBox, number> = {
    jobs: (jobs ?? []).length,
    applications: (applications ?? []).length,
    payments: paymentRows.length,
    subscriptions: (subs ?? []).length,
    reportsAbout: (reportsAbout ?? []).length,
    reportsBy: (reportsBy ?? []).length,
    penalties: (penalties ?? []).length,
    flags: (abuseFlags ?? []).length,
  }
  const emptyLine = emptySectionsLine((Object.keys(boxes) as MemberBox[]).filter((k) => boxes[k] === 0))

  return (
    <div className="space-y-5">
      <header className="space-y-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="truncate text-xl font-black text-tm-navy sm:text-2xl">
              {formatName(profile.full_name as string | null)}
            </h2>
            {share && (
              <div className="mt-1.5 flex flex-wrap items-start gap-1.5">
                {share.url ? (
                  <a
                    href={share.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2.5 text-[11px] font-bold text-tm-navy hover:border-tm-navy"
                  >
                    Public profile <ExternalLink aria-hidden size={12} />
                  </a>
                ) : (
                  <span aria-disabled="true" className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-dashed border-gray-300 px-2.5 text-[11px] font-bold text-gray-500">
                    Public profile <ExternalLink aria-hidden size={12} />
                  </span>
                )}
                <ProfileShareButtons share={share} />
              </div>
            )}
            <p className="truncate text-xs text-gray-500">
              {profile.email as string}
              {profile.phone_number ? ` · ${profile.phone_number}` : ''}
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-1.5">
            {profile.is_banned && (
              <span className="rounded-full bg-tm-tint-red px-2 py-0.5 text-[10px] font-black uppercase text-tm-red">
                banned
              </span>
            )}
            {profile.is_suspended && (
              <span className="rounded-full bg-tm-tint-gold px-2 py-0.5 text-[10px] font-black uppercase text-tm-gold-ink">
                suspended
              </span>
            )}
            {profile.paused_by_user_at && (
              // Self-pause (owner, 8 Oct 2026): the member hid their own account;
              // signing in brings it back. Separate from a staff suspension.
              <span className="rounded-full bg-tm-tint-navy px-2 py-0.5 text-[10px] font-bold text-tm-navy">
                Paused by user · {formatDate(profile.paused_by_user_at as string)}
              </span>
            )}
            {profile.phone_verified_via === 'bridge' && (
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase text-slate-700">
                bridge-verified
              </span>
            )}
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase text-slate-700">
              {profile.admin_role ? roleBadge(profile.admin_role as string, actor.adminRole) : (profile.role as string)}
            </span>
          </div>
        </div>
      </header>

      {profile.is_banned && (
        <p className="rounded-2xl border border-tm-red/30 bg-tm-tint-red p-3 text-xs leading-relaxed text-tm-red">
          <strong>Banned</strong>
          {profile.banned_reason ? `: ${profile.banned_reason as string}` : '.'} Their mobile and CNIC
          are on the signup blocklist.
        </p>
      )}

      {profile.is_suspended && profile.suspension_reason && (
        <p className="rounded-2xl border border-tm-gold/30 bg-tm-tint-gold p-3 text-xs leading-relaxed text-tm-gold-ink">
          <strong>Suspended</strong>
          {profile.suspended_at
            ? ` on ${formatDateTime(profile.suspended_at as string)}`
            : ''}
          : {profile.suspension_reason as string}
        </p>
      )}

      {/* -------------------------------------------------------- summary --- */}
      <section className="grid grid-cols-2 gap-3 rounded-2xl border border-gray-200 bg-white p-4 sm:grid-cols-4">
        <Fact label="Completion" value={`${profile.profile_completion ?? 0}%`} />
        {/* The IDENTITY DOCUMENTS review (CNIC/selfie/photo for a tutor; CNIC +
            address for a parent). Distinct from the tutor's platform
            verification below — the two were both labelled "Verification" and
            read as a contradiction (PR99 §3). */}
        <Fact
          label="Documents"
          value={docFact?.text ?? '—'}
          tone={docFact?.tone}
          href={parentDocs || tutorDocs ? '#documents' : undefined}
        />
        <Fact label="City" value={(profile.city as string) ?? '—'} />
        <Fact
          label="Joined"
          value={formatDate(profile.created_at as string)}
        />
        {/* First touch. Shown as one line rather than four facts because the
            question an admin has is "which ad brought them", and source ·
            medium · campaign answers it at a glance. A member who arrived
            without a campaign shows the honest dash. */}
        <Fact
          label="Came from"
          value={describeSource(profile as Parameters<typeof describeUtm>[0], describeUtm(profile as Parameters<typeof describeUtm>[0])) ?? 'Direct'}
          verbatim
        />
        {isTutor && tutor && (
          <>
            {/* The real directory state (the same gate the public site uses),
                not the verification-pipeline status — a tutor can be
                "verified" yet not listed, or listed while verification is
                pending. Both are shown, each under its true label (PR39). */}
            <Fact label="Listing" value={directory?.listed ? 'Listed' : 'Not listed'} />
            {/* The tutor's platform verification pipeline (video + CNIC + degree
                audit → badge/listing). Its own label, not "Verification" again. */}
            <Fact
              label="Tutor status"
              value={tutorStatusFact(tutor.verification_status as string | null, { feePaid: !!tutor.verified_fee_paid_at, docKind: docKind ?? 'none' })}
            />
            {/* The one-time Rs 199 verification fee — the status the owner reads
                as "paid or not" (PR99 §3). */}
            <Fact label="Verification Fee" value={tutor.verified_fee_paid_at ? 'Paid' : 'Not paid'} />
            <Fact label="Video" value={videoFact(tutor.video_status as string | null, tutor.video_visibility as string | null)} />
            <Fact
              label="Rating"
              value={`${Number(tutor.rating_avg ?? 0).toFixed(2)} (${tutor.rating_count ?? 0})`}
            />
          </>
        )}
      </section>

      {(parentDocs || tutorDocs) && (
        <section id="documents" className="scroll-mt-20 space-y-3 rounded-2xl border border-gray-200 bg-white p-4 sm:p-5">
          <h2 className="text-xs font-black uppercase tracking-wide text-gray-500">Documents</h2>
          {parentDocs && (
            <ParentDocumentReview
              canReview={canReviewParent}
              docs={{
                parentId: parentDocs.parentId,
                cnicFrontId: parentDocs.cnicFrontId,
                cnicBackId: parentDocs.cnicBackId,
                cnicNumber: parentDocs.cnicNumber,
                address: parentDocs.address,
                city: parentDocs.city,
                cnic: parentDocs.cnic,
                addressItem: parentDocs.addressItem,
                verified: parentDocs.verified,
                whatsapp: parentDocs.whatsapp,
                cnicFrontReviewId: parentDocs.cnicFrontReviewId,
                cnicBackReviewId: parentDocs.cnicBackReviewId,
              }}
              lockable={!!lockInfo?.lockable.cnic}
              unlockOpen={!!lockInfo?.unlockOpen.cnic}
              canUnlock={canUnlock}
            />
          )}
          {tutorDocs && (
            <TutorDocumentReview
              tutorId={id}
              canReview={canReviewTutor}
              avatarUrl={(profile.avatar_url as string | null) ?? null}
              avatarOriginalUrl={await avatarOriginalUrl(id, (profile.avatar_url as string | null) ?? null)}
              cnicFrontId={tutorDocs.cnicFrontId}
              cnicBackId={tutorDocs.cnicBackId}
              selfieDocId={tutorDocs.selfieId}
              statuses={tutorDocs.statuses}
              memberWhatsapp={(profile.whatsapp as string | null) ?? (profile.phone_number as string | null) ?? null}
              lockInfo={lockInfo ?? undefined}
              canUnlock={canUnlock}
              cnicNumberMasked={tutorDocs.cnicNumberMasked}
              canEditNumber={roleMayWrite(actor.adminRole, SCREEN_ACCESS.tutorEdit)}
            />
          )}
        </section>
      )}

      <MemberActions
        userId={id}
        name={formatName(profile.full_name as string | null)}
        suspended={!!profile.is_suspended}
        banned={!!profile.is_banned}
        canBan={roleMayWrite(actor.adminRole, ['admin', 'partner'])}
        canUnban={roleMayWrite(actor.adminRole, ['partner'])}
        isSelf={id === actor.id}
        isStaff={profile.role === 'admin'}
        isOwner={profile.admin_role === 'owner'}
        isTutor={isTutor}
        canVerifyMobile={roleMayWrite(actor.adminRole, ['admin', 'partner'])}
        mobileVerified={!!profile.phone_verified_at}
        hasMobile={!!profile.phone_number}
        whatsappMsisdn={memberMsisdn}
        callMsisdn={callMsisdn}
        editTutorHref={isTutor && roleSatisfies(actor.adminRole, SCREEN_ACCESS.tutors) ? `/admin/tutors/${id}` : null}
        secondRole={
          roleMayWrite(actor.adminRole, SCREEN_ACCESS.secondRole) && profile.role !== 'admin' ? (
            <SecondRoleCard
              memberId={id}
              role={secondRole.canCreate ? secondRole.role : null}
              defaultName={formatName(profile.full_name as string | null)}
              linkedId={(profile.linked_account_id as string | null) ?? null}
              reason={secondRole.canCreate ? null : secondRole.reason}
            />
          ) : null
        }
      />

      {/* ---------------------------------------------- staff activity --- */}
      {staffCounts && (
        <section className="space-y-2 rounded-2xl border border-gray-200 bg-white p-4">
          <h2 className="text-xs font-black uppercase tracking-wide text-gray-500">
            Staff activity
          </h2>
          <StaffActivityTable counts={staffCounts} />
        </section>
      )}

      {/* ------------------------------------------------ linked objects --- */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Panel title={`Jobs (${(jobs ?? []).length})`}>
          {(jobs ?? []).map((j) => (
            <Row
              key={j.id as string}
              href={`/admin/jobs/${j.id as string}`}
              main={j.title as string}
              sub={`${(j.job_tx_id as string) ?? ''} · ${jobStatus(j.status as string)}${j.is_featured ? ' · featured' : ''} · ${formatDate(j.created_at as string)}`}
            />
          ))}
        </Panel>

        <Panel title={`Applications (${(applications ?? []).length})`}>
          {(applications ?? []).map((a) => (
            <Row
              key={a.id as string}
              href={a.job_id ? `/admin/jobs/${a.job_id as string}` : undefined}
              main={appliedJobTitle.get(a.job_id as string) ?? 'A tuition'}
              sub={`${a.withdrawn_at ? 'Withdrawn' : applicationStatus(a.status as string)} · ${formatDate(a.created_at as string)}`}
            />
          ))}
        </Panel>

        <Panel title={`Payments (${paymentRows.length})`}>
          {paymentRows.map((p) => {
            const wa = paymentNeedsFollowUp(p.facts, nowMs) ? followUpHref(p.facts.planCode) : null
            return (
              <Row
                key={p.id}
                main={paymentLabel(p.facts, nowMs, { showAmount: showAmounts })}
                sub={`${p.facts.provider === 'manual' ? 'Bank transfer' : p.facts.provider === 'paypro' ? 'PayPro' : (p.facts.provider ?? 'Payment')} · ${formatDate(p.facts.createdAt)}`}
                extra={wa ? <PaymentFollowUp memberId={id} href={wa} /> : null}
              />
            )
          })}
        </Panel>

        <Panel title={`Subscriptions (${(subs ?? []).length})`}>
          {(subs ?? []).map((s) => (
            <Row
              key={s.id as string}
              main={paymentPlanName(s.plan_code as string)}
              sub={`${s.status} · ${s.source} · until ${s.expires_at ? formatDate(s.expires_at as string) : '—'}`}
            />
          ))}
        </Panel>

        <Panel title={`Reports about them (${(reportsAbout ?? []).length})`}>
          {(reportsAbout ?? []).map((r) => (
            <Row
              key={r.id as string}
              main={`${r.reason} on a ${r.target_type}`}
              sub={`${r.status} · ${formatDate(r.created_at as string)}`}
            />
          ))}
        </Panel>

        <Panel title={`Reports they filed (${(reportsBy ?? []).length})`}>
          {(reportsBy ?? []).map((r) => (
            <Row
              key={r.id as string}
              main={`${r.reason} on a ${r.target_type}`}
              sub={`${r.status} · ${formatDate(r.created_at as string)}`}
            />
          ))}
        </Panel>

        <Panel title={`Penalties (${(penalties ?? []).length})`}>
          {(penalties ?? []).map((p) => (
            <Row
              key={p.id as string}
              main={`${p.kind}: ${p.reason}`}
              sub={formatDateTime(p.created_at as string)}
            />
          ))}
        </Panel>

        {/* Abuse flags — the warnings (1, 2) and the suspension (3), so it is
            plain the member was warned before being suspended (PR41 §4). */}
        <Panel title={`Abuse flags (${(abuseFlags ?? []).length})`}>
          {(abuseFlags ?? []).map((f) => (
            <Row
              key={f.id as string}
              main={`${flagStageLabel((f.warning_level as number | null) ?? null)} — ${flagSourceLabel(f.source as string)}`}
              sub={`${f.withheld ? 'content withheld' : 'delivered'} · ${(f.status as string) === 'cleared' ? 'cleared' : 'open'} · ${formatDateTime(f.created_at as string)}`}
            />
          ))}
        </Panel>

      </div>

      {emptyLine && <p className="text-xs text-gray-500">{emptyLine}</p>}

      <Timeline
        events={timeline.rows}
        memberId={id}
        group={group}
        initialCursor={timeline.nextCursor}
        total={timeline.total}
        summaryLine={activity ? activitySummaryLine(activity) : null}
      />
    </div>
  )
}

function Fact({
  label,
  value,
  verbatim = false,
  href,
  tone,
}: {
  label: string
  value: string
  /** A colour for the value (the Documents status). */
  tone?: string
  /** Makes the value a link (e.g. "Documents: Submitted" → the Documents box). */
  href?: string
  /**
   * Render the value exactly as stored.
   *
   * `capitalize` is right for a status word and wrong for an identifier. A UTM
   * campaign has to match what is in Ads Manager character for character --
   * "Meta · Cpc · Tutors-Lahore-Sep" is not a campaign anybody can search for,
   * and an admin comparing this screen to a spend report would find nothing.
   */
  verbatim?: boolean
}) {
  // A long value ("Pending: Fee Not Paid · Documents waiting") wraps onto a
  // second line — never cut off with "…" (owner, 20 Oct 2026).
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-bold uppercase tracking-wide text-gray-500">{label}</p>
      {href ? (
        <a href={href} className={`block break-words text-sm font-black leading-snug underline-offset-2 hover:underline ${tone ?? 'text-tm-red'} ${verbatim || tone ? '' : 'capitalize'}`}>
          {value}
        </a>
      ) : (
        <p className={`break-words text-sm font-black leading-snug text-tm-navy ${verbatim ? '' : 'capitalize'}`}>
          {value}
        </p>
      )}
    </div>
  )
}

/** A box with something in it; an empty box is not drawn (owner, 20 Oct
 *  2026) — the page lists the empty ones on one grey line instead. */
function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  const items = Array.isArray(children) ? children.filter(Boolean) : children
  const empty = Array.isArray(items) ? items.length === 0 : !items
  if (empty) return null
  return (
    <section className="space-y-2 rounded-2xl border border-gray-200 bg-white p-4">
      <h2 className="text-xs font-black uppercase tracking-wide text-gray-500">{title}</h2>
      <ul className="space-y-1.5">{items}</ul>
    </section>
  )
}

function Row({ main, sub, href, extra = null }: { main: string; sub: string; href?: string; extra?: React.ReactNode }) {
  return (
    <li className="min-w-0">
      {/* Every job reference in admin links to its detail page, and shows the
          job_tx_id beside the title -- that reference is what a parent quotes
          in a support message. */}
      {href ? (
        <Link
          href={href}
          className="block truncate text-xs font-semibold text-tm-navy hover:text-tm-red hover:underline"
        >
          {main}
        </Link>
      ) : (
        <p className="truncate text-xs font-semibold text-tm-navy">{main}</p>
      )}
      <p className="truncate text-[11px] text-gray-500">{sub}</p>
      {extra}
    </li>
  )
}
