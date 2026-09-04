import { ExternalLink } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { formatDate, formatDateTime } from '@/lib/datetime'
import { describeUtm } from '@/lib/utm'
import { applicationStatus, jobStatus } from '@/lib/display'
import { createAdminClient } from '@/lib/supabase/admin'
import MemberActions from './MemberActions'
import { loadMemberTimeline } from '@/lib/adminQueues'
import Timeline from './Timeline'

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
      <p className="rounded-xl border border-tm-red/30 bg-tm-tint-red p-4 text-xs font-bold text-tm-red">
        SUPABASE_SERVICE_ROLE_KEY is not configured on the server.
      </p>
    )
  }

  const { data: profile } = await admin
    .from('profiles')
    .select(
      'id, full_name, email, phone_number, whatsapp, role, admin_role, city, profile_completion, cnic_verified_at, address_verified_at, verification_state, is_suspended, suspension_reason, suspended_at, suspended_by, created_at, utm_source, utm_medium, utm_campaign, utm_content',
    )
    .eq('id', id)
    .maybeSingle()

  if (!profile) notFound()

  const isTutor = profile.role === 'tutor'

  const [
    { data: tutor },
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

  const planName = new Map((plans ?? []).map((p) => [p.code as string, p.name as string]))

  // The group is applied in the query, not over a fetched window -- see
  // lib/adminQueues.ts for why that mattered.
  const timeline = await loadMemberTimeline({ userId: id, group })

  const verified = !!profile.cnic_verified_at && !!profile.address_verified_at

  return (
    <div className="space-y-5">
      <header className="space-y-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="truncate text-xl font-black text-tm-navy sm:text-2xl">
              {profile.full_name as string}
            </h2>
            <p className="truncate text-xs text-gray-500">
              {profile.email as string}
              {profile.phone_number ? ` · ${profile.phone_number}` : ''}
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-1.5">
            {profile.is_suspended && (
              <span className="rounded-full bg-tm-tint-gold px-2 py-0.5 text-[10px] font-black uppercase text-tm-gold-ink">
                suspended
              </span>
            )}
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase text-slate-700">
              {profile.admin_role ?? (profile.role as string)}
            </span>
          </div>
        </div>
      </header>

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
        <Fact label="Verification" value={verified ? 'Verified' : (profile.verification_state as string) ?? 'none'} />
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
          value={describeUtm(profile as Parameters<typeof describeUtm>[0]) ?? 'Direct'}
          verbatim
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

      {isTutor && (
        <div className="flex flex-col gap-2 sm:flex-row">
          <Link
            href={`/admin/tutors/${id}`}
            className="inline-flex min-h-[44px] items-center justify-center rounded-xl border border-gray-200 bg-white px-4 text-xs font-bold text-slate-700 hover:border-tm-navy"
          >
            Tutor record &amp; profile address
          </Link>
          {tutor?.slug && (
            <Link
              href={`/tutor/${tutor.slug}`}
              className="gap-1.5 inline-flex min-h-[44px] items-center justify-center rounded-xl border border-gray-200 bg-white px-4 text-xs font-bold text-slate-700 hover:border-tm-navy"
            >
              <ExternalLink aria-hidden size={14} />
              Open public profile
            </Link>
          )}
        </div>
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

        <Panel title={`Payments (${(payments ?? []).length})`}>
          {(payments ?? []).map((p) => (
            <Row
              key={p.id as string}
              main={`${planName.get(p.plan_code as string) ?? p.plan_code} — Rs. ${(p.amount_pkr as number).toLocaleString('en-PK')}`}
              sub={`${p.status} · ${p.provider} · ${formatDate(p.created_at as string)}`}
            />
          ))}
        </Panel>

        <Panel title={`Subscriptions (${(subs ?? []).length})`}>
          {(subs ?? []).map((s) => (
            <Row
              key={s.id as string}
              main={planName.get(s.plan_code as string) ?? (s.plan_code as string)}
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

        <Panel title={`Admin actions about them (${(auditAbout ?? []).length})`}>
          {(auditAbout ?? []).map((a) => (
            <Row
              key={a.id as string}
              main={a.action as string}
              sub={`${a.actor_email ?? 'system'} (${a.actor_role ?? '—'}) · ${formatDateTime(a.created_at as string)}`}
            />
          ))}
        </Panel>
      </div>

      <Timeline
        events={timeline.rows}
        memberId={id}
        group={group}
        initialCursor={timeline.nextCursor}
        total={timeline.total}
      />
    </div>
  )
}

function Fact({
  label,
  value,
  verbatim = false,
}: {
  label: string
  value: string
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
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-bold uppercase tracking-wide text-gray-500">{label}</p>
      <p className={`truncate text-sm font-black text-tm-navy ${verbatim ? '' : 'capitalize'}`}>
        {value}
      </p>
    </div>
  )
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  const items = Array.isArray(children) ? children.filter(Boolean) : children
  const empty = Array.isArray(items) ? items.length === 0 : !items
  return (
    <section className="space-y-2 rounded-2xl border border-gray-200 bg-white p-4">
      <h2 className="text-xs font-black uppercase tracking-wide text-gray-500">{title}</h2>
      {empty ? (
        <p className="text-xs text-gray-300">Nothing yet.</p>
      ) : (
        <ul className="space-y-1.5">{items}</ul>
      )}
    </section>
  )
}

function Row({ main, sub, href }: { main: string; sub: string; href?: string }) {
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
    </li>
  )
}
