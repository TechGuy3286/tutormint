import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getAdminActor, roleSatisfies, SCREEN_ACCESS, type AdminRole } from '@/lib/adminAuth'

// Server gate for the whole /admin subtree, plus the shell.
//
// Replaces the old client-side password prompt (literals shipped in the
// browser bundle, bypassable via localStorage.adminAuth) and the hardcoded
// email check. role='admin' plus a non-null admin_role is required, and both
// are settable only by SQL — 14_handle_new_user.sql refuses to mint an admin
// from signup metadata.
//
// The nav lists only screens this admin_role may open; every screen and every
// mutation route re-checks independently, so hiding a link is presentation,
// never the control.
//
// Mobile-first: bottom nav under sm, sidebar from sm up.

const NAV: { href: string; label: string; icon: string; allowed: AdminRole[] }[] = [
  { href: '/admin/tutors', label: 'Tutors', icon: '🎓', allowed: SCREEN_ACCESS.tutors },
  { href: '/admin/parents', label: 'Parents', icon: '👪', allowed: SCREEN_ACCESS.parents },
  { href: '/admin/plans', label: 'Plans', icon: '💳', allowed: SCREEN_ACCESS.plans },
  { href: '/admin/payments', label: 'Payments', icon: '💰', allowed: SCREEN_ACCESS.payments },
  { href: '/admin/reports', label: 'Reports', icon: '🚩', allowed: SCREEN_ACCESS.reports },
  { href: '/admin/users', label: 'Members', icon: '🧑', allowed: SCREEN_ACCESS.users },
  { href: '/admin/audit', label: 'Audit', icon: '📜', allowed: SCREEN_ACCESS.audit },
  { href: '/admin/ads', label: 'Ads', icon: '📢', allowed: SCREEN_ACCESS.ads },
  { href: '/admin/social', label: 'Social', icon: '📸', allowed: SCREEN_ACCESS.social },
  { href: '/admin/import', label: 'Import', icon: '📥', allowed: SCREEN_ACCESS.import },
  { href: '/admin/team', label: 'Team', icon: '🔑', allowed: SCREEN_ACCESS.team },
]

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const actor = await getAdminActor()

  if (!actor) {
    // Not an admin: the existence of this area is not worth advertising.
    redirect('/')
  }

  const visible = NAV.filter((n) => roleSatisfies(actor.adminRole, n.allowed))

  return (
    <div className="min-h-screen bg-tm-bg text-slate-700">
      <header className="bg-tm-black text-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
          <Link href="/admin" className="flex min-h-[44px] items-center font-black text-sm">
            Tutor<span className="text-tm-red">Mint</span>
            <span className="ml-2 text-[10px] uppercase tracking-wider bg-white/10 px-2 py-0.5 rounded">
              Admin
            </span>
          </Link>
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-[10px] uppercase tracking-wider bg-tm-green-deep px-2 py-1 rounded font-bold shrink-0">
              {actor.adminRole}
            </span>
            <span className="text-[11px] text-gray-300 truncate hidden sm:block">{actor.email}</span>
            <Link href="/" className="text-[11px] font-bold text-gray-300 hover:text-white shrink-0 min-h-[44px] px-3 flex items-center">
              Exit
            </Link>
          </div>
        </div>
      </header>

      <div className="max-w-6xl mx-auto sm:flex sm:gap-6 sm:px-6 sm:py-6">
        <nav className="hidden sm:block w-44 shrink-0" aria-label="Admin sections">
          <ul className="space-y-1 sticky top-6">
            {visible.map((n) => (
              <li key={n.href}>
                <Link
                  href={n.href}
                  className="flex items-center gap-2 min-h-[44px] px-3 py-2 rounded-xl bg-white border border-gray-200 hover:border-tm-navy text-xs font-bold transition-colors"
                >
                  <span aria-hidden="true">{n.icon}</span>
                  {n.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <main className="flex-1 min-w-0 px-4 py-5 sm:p-0 pb-24 sm:pb-0">{children}</main>
      </div>

      {/* Bottom nav on mobile */}
      {visible.length > 0 && (
        <nav
          className="sm:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 flex overflow-x-auto"
          aria-label="Admin sections"
        >
          {visible.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className="flex-1 shrink-0 basis-[72px] min-h-[56px] flex flex-col items-center justify-center gap-0.5 text-[10px] font-bold text-slate-700"
            >
              <span className="text-base" aria-hidden="true">
                {n.icon}
              </span>
              {n.label}
            </Link>
          ))}
        </nav>
      )}
    </div>
  )
}
