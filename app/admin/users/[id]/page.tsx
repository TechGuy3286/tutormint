import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { createAdminClient } from '@/lib/supabase/admin'
import MemberActions from './MemberActions'
import Timeline, { type TimelineEvent } from './Timeline'

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

const EVENT_LABEL: Record<string, string> = {
  registered: 'Registered',
  login: 'Signed in',
  otp_verified: 'Verified their phone',
  profile_updated: 'Updated their profile',
  completion_changed: 'Profile completion changed',
  subjects_changed: 'Changed their subjects',
  document_uploaded: 'Uploaded a document',
  video_submitted: 'Submitted an introduction video',
  verification_submitted: 'Submitted verification',
  verification_decision_received: 'Verification decision',
  job_posted: 'Posted a job',
  job_edited: 'Edited a job',
  job_closed: 'Closed a job',
  application_submitted: 'Applied for a job',
  application_withdrawn: 'Withdrew an application',
  demo_requested: 'Requested a demo',
  demo_accepted: 'Accepted a demo',
  demo_declined: 'Declined a demo',
  demo_completed: 'Completed a demo',
  message_sent: 'Sent a message',
  shortlist_added: 'Shortlisted a tutor',
  shortlist_removed: 'Removed a shortlist',
  profile_viewed: 'Viewed a tutor profile',
  search_performed: 'Searched',
  blocked: 'Blocked a member',
  blocked_by: 'Was blocked',
  unblocked: 'Unblocked a member',
  reported: 'Filed a report',
  reported_by: 'Was reported',
  report_resolved: 'A report they filed was resolved',
  payment_submitted: 'Started a payment',
  payment_rejected: 'A payment was rejected',
  plan_purchased: 'Bought a plan',
  plan_expiring: 'Plan expiry reminder',
  plan_granted: 'Plan granted by an admin',
  plan_revoked: 'Plan revoked by an admin',
  plan_expired: 'Plan expired',
  warned: 'Warned',
  suspended: 'Suspended',
  unsuspended: 'Reinstated',
  staff_created: 'Staff account created',
  staff_role_changed: 'Staff role changed',
  staff_suspended: 'Staff access suspended',
  staff_reactivated: 'Staff access restored',
  video_visibility_changed: 'Video visibility changed',
}

/** Broad buckets for the timeline filter. */
const GROUPS: Record<string, string[]> = {
  account: [
    'registered', 'login', 'otp_verified', 'profile_updated', 'completion_changed',
    'subjects_changed', 'document_uploaded', 'video_submitted', 'verification_submitted',
    'verification_decision_received', 'video_visibility_changed',
  ],
  activity: [
    'job_posted', 'job_edited', 'job_closed', 'application_submitted', 'application_withdrawn',
    'demo_requested', 'demo_accepted', 'demo_declined', 'demo_completed', 'message_sent',
    'shortlist_added', 'shortlist_removed', 'profile_viewed', 'search_performed',
  ],
  money: [
    'payment_submitted', 'payment_rejected', 'plan_purchased', 'plan_expiring', 'plan_granted',
    'plan_revoked', 'plan_expired',
  ],
  moderation: [
    'blocked', 'blocked_by', 'unblocked', 'reported', 'reported_by', 'report_resolved',
    'warned', 'suspended', 'unsuspended', 'staff_created', 'staff_role_changed',
    'staff_suspended', 'staff_reactivated',
  ],
}

export default async function AdminMemberPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ group?: string }>
}) {
  const actor = await requireAdminRole(...SCREEN_ACCESS.users)
  const { id } = await params
  const { group = 'all' } = await searchParams

  const admin = createAdminClient()
  if (!admin) {
    return (
      <p className="rounded-xl border border-red-200 bg-red-50 p-4 text-xs font-bold text-[#d60008]">
        SUPABASE_SERVICE_ROLE_KEY is not configured on the server.
      </p>
    )
  }

  const { data: profile } = await admin
    .from('profiles')
    .select(
      'id, full_name, email, phone_number, whatsapp, role, admin_role, city, profile_completion, cnic_verified_at, address_verified_at, verification_state, is_suspended, suspension_reason, suspended_at, suspended_by, created_at',
    )
    .eq('id', id)
    .maybeSingle()

  if (!profile) notFound()

  const isTutor = profile.role === 'tutor'

  const [
    { data: tutor },
    { data: activity },
    { data: jobs },
    { data: applications },
    { data: payments },
    { data: subs },
    { data: reportsAbout },
    { data: reportsBy },
    { data: penalties },
    { data: auditAbout },
    { data: plans },
  ] = await Promise.all([
    admin
      .from('tutor_profiles')
      .select('id, slug, verification_status, video_status, video_visibility, rating_avg, rating_count, is_featured')
      .eq('id', id)
      .maybeSingle(),
    admin
      .from('user_activity_log')
      .select('id, event, target_type, target_id, meta, created_at')
      .eq('user_id', id)
      .order('created_at', { ascending: false })
      .limit(300),
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
      .select('id, plan_code, amount_pkr, status, provider, created_at')
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
      .from('admin_audit_log')
      .select('id, action, actor_email, actor_role, detail, created_at')
      .eq('target_id', id)
      .order('created_at', { ascending: false })
      .limit(50),
    admin.from('plans').select('code, name'),
  ])

  const planName = new Map((plans ?? []).map((p) => [p.code as string, p.name as string]))

  const allowed = group === 'all' ? null : new Set(GROUPS[group] ?? [])
  const events: TimelineEvent[] = (activity ?? [])
    .filter((a) => !allowed || allowed.has(a.event as string))
    .map((a) => ({
      id: a.id as string,
      event: a.event as string,
      label: EVENT_LABEL[a.event as string] ?? (a.event as string),
      targetType: (a.target_type as string) ?? null,
      targetId: (a.target_id as string) ?? null,
      meta: (a.meta as Record<string, unknown>) ?? {},
      at: a.created_at as string,
    }))

  const verified = !!profile.cnic_verified_at && !!profile.address_verified_at

  return (
    <div className="space-y-5">
      <header className="space-y-2">
        <Link href="/admin/users" className="text-xs font-bold text-[#d60008] hover:underline">
          ← All members
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <h1 className="truncate text-xl font-black text-[#0F172A] sm:text-2xl">
              {profile.full_name as string}
            </h1>
            <p className="truncate text-xs text-gray-500">
              {profile.email as string}
              {profile.phone_number ? ` · ${profile.phone_number}` : ''}
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-1.5">
            {profile.is_suspended && (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-black uppercase text-amber-700">
                suspended
              </span>
            )}
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase text-slate-500">
              {profile.admin_role ?? (profile.role as string)}
            </span>
          </div>
        </div>
      </header>

      {profile.is_suspended && profile.suspension_reason && (
        <p className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-[#92400E]">
          <strong>Suspended</strong>
          {profile.suspended_at
            ? ` on ${new Date(profile.suspended_at as string).toLocaleString('en-PK')}`
            : ''}
          : {profile.suspension_reason as string}
        </p>
      )}

      {/* -------------------------------------------------------- summary --- */}
      <section className="grid grid-cols-2 gap-3 rounded-2xl border border-gray-200 bg-white p-4 sm:grid-cols-4">
        <Fact label="Completion" value={`${profile.profile_completion ?? 0}%`} />
        <Fact label="Verification" value={verified ? 'Verified' : (profile.verification_state as string) ?? 'none'} />
        <Fact label="City" value={(profile.city as string) ?? '—'} />
        <Fact
          label="Joined"
          value={new Date(profile.created_at as string).toLocaleDateString('en-PK')}
        />
        {isTutor && tutor && (
          <>
            <Fact label="Listing" value={(tutor.verification_status as string) ?? '—'} />
            <Fact label="Video" value={(tutor.video_status as string) ?? 'none'} />
            <Fact label="Video visibility" value={(tutor.video_visibility as string) ?? 'private'} />
            <Fact
              label="Rating"
              value={`${Number(tutor.rating_avg ?? 0).toFixed(2)} (${tutor.rating_count ?? 0})`}
            />
          </>
        )}
      </section>

      {isTutor && tutor?.slug && (
        <Link
          href={`/tutor/${tutor.slug}`}
          className="inline-flex min-h-[44px] items-center rounded-xl border border-gray-200 bg-white px-4 text-xs font-bold text-[#334155]"
        >
          Open public profile
        </Link>
      )}

      <MemberActions
        userId={id}
        name={profile.full_name as string}
        suspended={!!profile.is_suspended}
        isSelf={id === actor.id}
        isStaff={profile.role === 'admin'}
        isOwner={profile.admin_role === 'owner'}
        isTutor={isTutor}
      />

      {/* ------------------------------------------------ linked objects --- */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Panel title={`Jobs (${(jobs ?? []).length})`}>
          {(jobs ?? []).map((j) => (
            <Row
              key={j.id as string}
              main={j.title as string}
              sub={`${j.status}${j.is_featured ? ' · featured' : ''} · ${new Date(j.created_at as string).toLocaleDateString('en-PK')}`}
            />
          ))}
        </Panel>

        <Panel title={`Applications (${(applications ?? []).length})`}>
          {(applications ?? []).map((a) => (
            <Row
              key={a.id as string}
              main={a.withdrawn_at ? 'Withdrawn' : (a.status as string)}
              sub={new Date(a.created_at as string).toLocaleDateString('en-PK')}
            />
          ))}
        </Panel>

        <Panel title={`Payments (${(payments ?? []).length})`}>
          {(payments ?? []).map((p) => (
            <Row
              key={p.id as string}
              main={`${planName.get(p.plan_code as string) ?? p.plan_code} — Rs. ${(p.amount_pkr as number).toLocaleString('en-PK')}`}
              sub={`${p.status} · ${p.provider} · ${new Date(p.created_at as string).toLocaleDateString('en-PK')}`}
            />
          ))}
        </Panel>

        <Panel title={`Subscriptions (${(subs ?? []).length})`}>
          {(subs ?? []).map((s) => (
            <Row
              key={s.id as string}
              main={planName.get(s.plan_code as string) ?? (s.plan_code as string)}
              sub={`${s.status} · ${s.source} · until ${s.expires_at ? new Date(s.expires_at as string).toLocaleDateString('en-PK') : '—'}`}
            />
          ))}
        </Panel>

        <Panel title={`Reports about them (${(reportsAbout ?? []).length})`}>
          {(reportsAbout ?? []).map((r) => (
            <Row
              key={r.id as string}
              main={`${r.reason} on a ${r.target_type}`}
              sub={`${r.status} · ${new Date(r.created_at as string).toLocaleDateString('en-PK')}`}
            />
          ))}
        </Panel>

        <Panel title={`Reports they filed (${(reportsBy ?? []).length})`}>
          {(reportsBy ?? []).map((r) => (
            <Row
              key={r.id as string}
              main={`${r.reason} on a ${r.target_type}`}
              sub={`${r.status} · ${new Date(r.created_at as string).toLocaleDateString('en-PK')}`}
            />
          ))}
        </Panel>

        <Panel title={`Penalties (${(penalties ?? []).length})`}>
          {(penalties ?? []).map((p) => (
            <Row
              key={p.id as string}
              main={`${p.kind}: ${p.reason}`}
              sub={new Date(p.created_at as string).toLocaleString('en-PK')}
            />
          ))}
        </Panel>

        <Panel title={`Admin actions about them (${(auditAbout ?? []).length})`}>
          {(auditAbout ?? []).map((a) => (
            <Row
              key={a.id as string}
              main={a.action as string}
              sub={`${a.actor_email ?? 'system'} (${a.actor_role ?? '—'}) · ${new Date(a.created_at as string).toLocaleString('en-PK')}`}
            />
          ))}
        </Panel>
      </div>

      <Timeline events={events} memberId={id} group={group} />
    </div>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-bold uppercase tracking-wide text-gray-400">{label}</p>
      <p className="truncate text-sm font-black capitalize text-[#0F172A]">{value}</p>
    </div>
  )
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  const items = Array.isArray(children) ? children.filter(Boolean) : children
  const empty = Array.isArray(items) ? items.length === 0 : !items
  return (
    <section className="space-y-2 rounded-2xl border border-gray-200 bg-white p-4">
      <h2 className="text-xs font-black uppercase tracking-wide text-gray-400">{title}</h2>
      {empty ? (
        <p className="text-xs text-gray-300">Nothing yet.</p>
      ) : (
        <ul className="space-y-1.5">{items}</ul>
      )}
    </section>
  )
}

function Row({ main, sub }: { main: string; sub: string }) {
  return (
    <li className="min-w-0">
      <p className="truncate text-xs font-semibold text-[#0F172A]">{main}</p>
      <p className="truncate text-[11px] text-gray-400">{sub}</p>
    </li>
  )
}
