import Link from 'next/link'
import { getAdminActor, roleSatisfies, SCREEN_ACCESS, type AdminRole } from '@/lib/adminAuth'
import { createAdminClient } from '@/lib/supabase/admin'
import { currentPeriod } from '@/lib/entitlements'

// The admin landing, as a dashboard rather than a menu.
//
// Every tile is a number that means "there is work here", and every tile links
// to the queue that clears it. A role only sees the tiles for screens it may
// open, so a verifier is never shown a payments backlog they cannot touch --
// and never sent to a screen that would bounce them.
//
// Counts are read with the service-role client and use head:true counts rather
// than pulling rows: this page must stay cheap enough to be the default
// landing for every admin, every session.

export const dynamic = 'force-dynamic'

type Tile = {
  label: string
  value: string
  hint: string
  href: string
  allowed: AdminRole[]
  urgent?: boolean
}

export default async function AdminHome() {
  const actor = await getAdminActor()
  if (!actor) return null // the layout has already redirected

  const admin = createAdminClient()
  if (!admin) {
    return (
      <p className="rounded-xl border border-tm-red/30 bg-tm-tint-red p-4 text-xs font-bold text-tm-red">
        SUPABASE_SERVICE_ROLE_KEY is not configured on the server, so the dashboard cannot be
        loaded.
      </p>
    )
  }

  const now = new Date()
  const weekAhead = new Date(now.getTime() + 7 * 86_400_000).toISOString()
  const monthStart = `${currentPeriod(now)}-01T00:00:00.000Z`

  const count = (q: PromiseLike<{ count: number | null }>) => q

  const [
    tutors,
    parents,
    suspended,
    pendingTutors,
    pendingParents,
    pendingPayments,
    openReports,
    expiringSoon,
    activeSubs,
    revenueRows,
    staff,
    liveAds,
    unclaimed,
  ] = await Promise.all([
    count(admin.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'tutor')),
    count(
      admin
        .from('profiles')
        .select('id', { count: 'exact', head: true })
        .in('role', ['parent', 'academy']),
    ),
    count(
      admin.from('profiles').select('id', { count: 'exact', head: true }).eq('is_suspended', true),
    ),
    count(
      admin
        .from('tutor_profiles')
        .select('id', { count: 'exact', head: true })
        .eq('video_status', 'uploaded'),
    ),
    count(
      admin
        .from('profiles')
        .select('id', { count: 'exact', head: true })
        .eq('verification_state', 'submitted'),
    ),
    count(
      admin.from('payments').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
    ),
    count(admin.from('reports').select('id', { count: 'exact', head: true }).eq('status', 'open')),
    count(
      admin
        .from('subscriptions')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'active')
        .gt('expires_at', now.toISOString())
        .lte('expires_at', weekAhead),
    ),
    count(
      admin
        .from('subscriptions')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'active')
        .gt('expires_at', now.toISOString()),
    ),
    admin
      .from('payments')
      .select('amount_pkr')
      .eq('status', 'approved')
      .gte('created_at', monthStart),
    count(
      admin
        .from('profiles')
        .select('id', { count: 'exact', head: true })
        .eq('role', 'admin')
        .not('admin_role', 'is', null),
    ),
    count(
      admin
        .from('advertisements')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'active')
        .lte('starts_at', now.toISOString())
        .or(`ends_at.is.null,ends_at.gt.${now.toISOString()}`),
    ),
    count(
      admin
        .from('tutor_profiles')
        .select('id', { count: 'exact', head: true })
        .eq('imported', true)
        .is('claimed_at', null),
    ),
  ])

  const revenue = (revenueRows.data ?? []).reduce(
    (sum, r) => sum + ((r.amount_pkr as number) ?? 0),
    0,
  )

  const tiles: Tile[] = [
    {
      label: 'Videos to review',
      value: String(pendingTutors.count ?? 0),
      hint: 'Tutors waiting on a decision',
      href: '/admin/tutors',
      allowed: SCREEN_ACCESS.tutors,
      urgent: (pendingTutors.count ?? 0) > 0,
    },
    {
      label: 'CNICs to verify',
      value: String(pendingParents.count ?? 0),
      hint: 'Parents who cannot post until approved',
      href: '/admin/parents',
      allowed: SCREEN_ACCESS.parents,
      urgent: (pendingParents.count ?? 0) > 0,
    },
    {
      label: 'Open reports',
      value: String(openReports.count ?? 0),
      hint: 'Waiting on a moderator',
      href: '/admin/reports',
      allowed: SCREEN_ACCESS.reports,
      urgent: (openReports.count ?? 0) > 0,
    },
    {
      label: 'Payments to confirm',
      value: String(pendingPayments.count ?? 0),
      hint: 'Transfers a member has already sent',
      href: '/admin/payments',
      allowed: SCREEN_ACCESS.payments,
      urgent: (pendingPayments.count ?? 0) > 0,
    },
    {
      label: 'Expiring this week',
      value: String(expiringSoon.count ?? 0),
      hint: `of ${activeSubs.count ?? 0} active plans`,
      href: '/admin/payments',
      allowed: SCREEN_ACCESS.payments,
    },
    {
      label: 'Revenue this month',
      value: `Rs. ${revenue.toLocaleString('en-PK')}`,
      hint: `Approved payments since ${currentPeriod(now)}-01`,
      href: '/admin/payments?filter=approved',
      allowed: SCREEN_ACCESS.payments,
    },
    {
      label: 'Tutors',
      value: String(tutors.count ?? 0),
      hint: 'Registered accounts',
      href: '/admin/users?role=tutor',
      allowed: SCREEN_ACCESS.users,
    },
    {
      label: 'Parents',
      value: String(parents.count ?? 0),
      hint: 'Registered accounts',
      href: '/admin/users?role=parent',
      allowed: SCREEN_ACCESS.users,
    },
    {
      label: 'Suspended',
      value: String(suspended.count ?? 0),
      hint: 'Members currently locked out',
      href: '/admin/users?status=suspended',
      allowed: SCREEN_ACCESS.users,
    },
    {
      label: 'Live ads',
      value: String(liveAds.count ?? 0),
      hint: 'Sponsored banners in rotation',
      href: '/admin/ads',
      allowed: SCREEN_ACCESS.ads,
    },
    {
      label: 'Unclaimed imports',
      value: String(unclaimed.count ?? 0),
      hint: 'Imported tutors yet to claim their profile',
      href: '/admin/import',
      allowed: SCREEN_ACCESS.import,
    },
    {
      label: 'Staff',
      value: String(staff.count ?? 0),
      hint: 'Accounts with an admin role',
      href: '/admin/team',
      allowed: SCREEN_ACCESS.team,
    },
  ].filter((t) => roleSatisfies(actor.adminRole, t.allowed))

  return (
    <div className="space-y-5">
      <header className="space-y-1">
        <h1 className="text-xl font-black text-tm-navy sm:text-2xl">Admin</h1>
        <p className="text-xs text-gray-500">
          Signed in as {actor.email} · role <strong>{actor.adminRole}</strong>
        </p>
      </header>

      {tiles.length === 0 ? (
        <div className="space-y-1 rounded-2xl border border-gray-200 bg-white p-6 text-center">
          <p className="text-sm font-bold text-tm-navy">Nothing here yet for your role</p>
          <p className="text-xs text-gray-500">
            Ask the owner if you should have access to a queue you cannot see.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          {tiles.map((t) => (
            <Link
              key={t.label}
              href={t.href}
              className={`flex min-h-[96px] flex-col justify-between rounded-2xl border bg-white p-4 transition-colors hover:border-tm-navy ${
                t.urgent ? 'border-tm-gold' : 'border-gray-200'
              }`}
            >
              <p className="text-[11px] font-bold uppercase tracking-wide text-gray-500">
                {t.label}
              </p>
              <p
                className={`text-2xl font-black ${t.urgent ? 'text-tm-red' : 'text-tm-navy'}`}
              >
                {t.value}
              </p>
              <p className="text-[10px] leading-snug text-gray-500">{t.hint}</p>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
