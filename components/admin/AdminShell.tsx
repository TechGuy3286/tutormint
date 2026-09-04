'use client'

import { useEffect, useId, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  Camera,
  ChevronsLeft,
  ChevronsRight,
  ClipboardList,
  Contact,
  CreditCard,
  Flag,
  Gauge,
  GraduationCap,
  KeyRound,
  Megaphone,
  Menu,
  Newspaper,
  ListChecks,
  Scroll,
  Search,
  Upload,
  Users,
  Wallet,
  X,
} from 'lucide-react'

import type { NavGroup } from '@/lib/adminNav'

// The admin shell: one sidebar, one header, one content column.
//
// WHY A CLIENT COMPONENT WRAPS SERVER CONTENT. The collapse state and the
// mobile drawer are interaction, so they need a client boundary -- but the
// pages, the page head and the bell are server-rendered and simply pass
// through as props. Nothing about the admin data crosses into the browser
// bundle because of this file.
//
// THE COLLAPSE STATE IS A COOKIE, NOT localStorage. Not for any rule about
// storage -- a sidebar width is not login or role state -- but because the
// server can read a cookie and render the correct width in the FIRST paint.
// Read from localStorage in an effect, a collapsed sidebar expands for one
// frame on every navigation, which is the flicker the header pass in September
// went to some trouble to remove elsewhere.
//
// THE NAV IS ALREADY FILTERED. The layout resolves SCREEN_ACCESS and passes
// only the groups this admin_role may open; a group whose every item was
// filtered out does not render its heading either. Hiding a link is
// presentation -- every screen and every route re-checks -- but offering a door
// that is locked is its own small betrayal.

const ICONS: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  gauge: Gauge,
  graduation: GraduationCap,
  users: Users,
  contact: Contact,
  key: KeyRound,
  clipboard: ClipboardList,
  wallet: Wallet,
  card: CreditCard,
  flag: Flag,
  scroll: Scroll,
  megaphone: Megaphone,
  camera: Camera,
  upload: Upload,
  search: Search,
  newspaper: Newspaper,
  listChecks: ListChecks,
}

const COOKIE = 'tm_admin_nav'

function rememberCollapsed(collapsed: boolean) {
  // A year, path-scoped to the whole site so it survives a trip out to the
  // public pages and back.
  document.cookie = `${COOKIE}=${collapsed ? 'collapsed' : 'open'}; path=/; max-age=31536000; samesite=lax`
}

export default function AdminShell({
  groups,
  initialCollapsed,
  pageHead,
  search,
  bell,
  signOut,
  roleLabel,
  email,
  children,
}: {
  groups: NavGroup[]
  initialCollapsed: boolean
  pageHead: React.ReactNode
  search: React.ReactNode
  bell: React.ReactNode
  signOut: React.ReactNode
  roleLabel: string
  email: string | null
  children: React.ReactNode
}) {
  const pathname = usePathname() ?? '/admin'
  const [collapsed, setCollapsed] = useState(initialCollapsed)
  const [drawer, setDrawer] = useState(false)
  const drawerId = useId()
  const closeRef = useRef<HTMLButtonElement | null>(null)

  // A drawer that survives the navigation it triggered would cover the screen
  // it just opened.
  useEffect(() => {
    setDrawer(false)
  }, [pathname])

  // Escape closes it, and focus moves in when it opens: it is a full-height
  // overlay, so leaving focus behind it means a keyboard user is tabbing
  // through a page they cannot see.
  useEffect(() => {
    if (!drawer) return
    closeRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDrawer(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [drawer])

  const isActive = (href: string) =>
    href === '/admin' ? pathname === '/admin' : pathname === href || pathname.startsWith(href + '/')

  const NavList = ({ compact }: { compact: boolean }) => (
    <nav aria-label="Admin sections" className="flex-1 overflow-y-auto px-3 pb-6">
      {groups.map((g) => (
        <div key={g.title} className="mb-4">
          <p
            className={`px-2 pb-1 text-[10px] font-black uppercase tracking-widest text-gray-300 ${
              compact ? 'sr-only' : ''
            }`}
          >
            {g.title}
          </p>
          <ul className="space-y-0.5">
            {g.items.map((item) => {
              const Icon = ICONS[item.icon] ?? Gauge
              const active = isActive(item.href)
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? 'page' : undefined}
                    // The label is always in the DOM. Collapsed, it is sr-only
                    // rather than removed, so the icons keep their names for a
                    // screen reader and `title` gives a pointer user the same
                    // thing on hover.
                    title={compact ? item.label : undefined}
                    className={`flex min-h-[44px] items-center gap-3 rounded-xl px-2.5 text-xs font-bold transition-colors ${
                      active
                        ? 'bg-white/12 text-white'
                        : 'text-gray-300 hover:bg-white/8 hover:text-white'
                    } ${compact ? 'justify-center' : ''}`}
                  >
                    <span
                      aria-hidden
                      className={`grid h-6 w-6 shrink-0 place-items-center rounded-lg ${
                        active ? 'text-tm-mint' : ''
                      }`}
                    >
                      <Icon size={16} />
                    </span>
                    <span className={compact ? 'sr-only' : 'truncate'}>{item.label}</span>
                  </Link>
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </nav>
  )

  const Wordmark = ({ compact }: { compact: boolean }) => (
    <Link
      href="/admin"
      className="flex min-h-[52px] shrink-0 items-center gap-2 px-4 text-sm font-black text-white"
    >
      {compact ? (
        <span aria-hidden className="text-tm-mint">
          TM
        </span>
      ) : (
        <span>
          Tutor<span className="text-tm-mint">Mint</span>
        </span>
      )}
      <span className="sr-only">TutorMint admin</span>
    </Link>
  )

  return (
    <div className="min-h-screen bg-tm-bg text-slate-700">
      {/* -------------------------------------------------------- sidebar -- */}
      <aside
        className={`fixed inset-y-0 left-0 z-30 hidden flex-col bg-tm-black md:flex ${
          collapsed ? 'w-[68px]' : 'w-56'
        }`}
      >
        <Wordmark compact={collapsed} />
        <NavList compact={collapsed} />
        <button
          type="button"
          onClick={() => {
            setCollapsed((c) => {
              rememberCollapsed(!c)
              return !c
            })
          }}
          aria-expanded={!collapsed}
          className="flex min-h-[44px] shrink-0 items-center gap-2 border-t border-white/10 px-4 text-[11px] font-bold text-gray-300 transition-colors hover:text-white"
        >
          {collapsed ? (
            <ChevronsRight aria-hidden size={16} />
          ) : (
            <ChevronsLeft aria-hidden size={16} />
          )}
          <span className={collapsed ? 'sr-only' : ''}>Collapse</span>
        </button>
      </aside>

      {/* --------------------------------------------------- mobile drawer -- */}
      {drawer && (
        <div className="md:hidden">
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setDrawer(false)}
            className="fixed inset-0 z-40 bg-tm-black/50"
          />
          <div
            id={drawerId}
            role="dialog"
            aria-modal="true"
            aria-label="Admin sections"
            className="fixed inset-y-0 left-0 z-50 flex w-64 max-w-[85vw] flex-col bg-tm-black"
          >
            <div className="flex items-center justify-between">
              <Wordmark compact={false} />
              <button
                ref={closeRef}
                type="button"
                onClick={() => setDrawer(false)}
                aria-label="Close menu"
                className="mr-2 grid h-11 w-11 place-items-center rounded-xl text-gray-300 hover:text-white"
              >
                <X aria-hidden size={18} />
              </button>
            </div>
            <NavList compact={false} />
          </div>
        </div>
      )}

      {/* -------------------------------------------------------- content -- */}
      <div className={collapsed ? 'md:pl-[68px]' : 'md:pl-56'}>
        {/* THE ONLY HEADER ON /admin. components/Navbar.tsx returns null under
            this path — two stacked headers cost ~148px before any content and
            said the same things twice. */}
        <header className="sticky top-0 z-20 border-b border-gray-200 bg-white">
          <div className="flex items-center gap-2 px-4 py-2 sm:gap-3 sm:px-6">
            <button
              type="button"
              onClick={() => setDrawer(true)}
              aria-label="Open menu"
              aria-controls={drawerId}
              aria-expanded={drawer}
              className="-ml-1 grid h-11 w-11 shrink-0 place-items-center rounded-xl text-tm-navy md:hidden"
            >
              <Menu aria-hidden size={20} />
            </button>

            {/* Two-to-one, not an even split. The title and the trail share
                this row with the search box, and an even split left a
                four-level admin trail (Home > Admin > Tutors > <member>) with
                ~270px -- enough for the first and last crumbs, so the two in
                the middle truncated to zero and rendered as bare chevrons. The
                search has a fixed useful width; the trail's is whatever the
                page needs. */}
            <div className="min-w-0 flex-[2]">{pageHead}</div>

            <div className="hidden w-64 min-w-0 shrink-0 lg:block">{search}</div>

            <div className="flex shrink-0 items-center gap-1 sm:gap-1.5">
              <span className="hidden rounded-full bg-tm-tint-green px-2 py-1 text-[10px] font-black uppercase tracking-wider text-tm-green-deep sm:inline">
                {roleLabel}
              </span>
              {/* 2xl, not xl. At exactly 1280 this took ~190px out of the row
                  and the breadcrumb trail paid for it: the middle crumbs
                  truncated to bare chevrons. Which admin is signed in is also
                  already on the account menu; the trail is the only thing on
                  this row that says where you are. */}
              <span className="hidden max-w-[180px] truncate text-[11px] text-gray-500 2xl:block">
                {email}
              </span>
              {bell}
              {signOut}
              {/* "Back to site", not "Exit". Exit sat beside Sign out and
                  the two read as the same action — one of them ends your
                  session and one of them does not, and nothing in the label
                  said which. This one names its destination. */}
              <Link
                href="/"
                className="flex min-h-[44px] shrink-0 items-center whitespace-nowrap px-2 text-[11px] font-bold text-gray-500 transition-colors hover:text-tm-navy sm:px-3"
              >
                Back to site
              </Link>
            </div>
          </div>

          {/* The search is a full row below lg, where it cannot share the bar
              with the title and five controls without one of them wrapping. */}
          <div className="px-4 pb-2 sm:px-6 lg:hidden">{search}</div>
        </header>

        <main className="mx-auto max-w-6xl px-4 py-5 sm:px-6 sm:py-6">{children}</main>
      </div>
    </div>
  )
}
