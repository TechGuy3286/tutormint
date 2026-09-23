'use client'

import { useEffect, useId, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  Activity,
  Camera,
  ChevronDown,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  ClipboardList,
  Contact,
  CreditCard,
  FilePlus,
  Flag,
  Gauge,
  GraduationCap,
  KeyRound,
  Mail,
  MapPin,
  Megaphone,
  Menu,
  Newspaper,
  ListChecks,
  Scroll,
  Search,
  ShieldAlert,
  ShieldCheck,
  Upload,
  UserPlus,
  UserX,
  Users,
  Wallet,
  X,
} from 'lucide-react'

import type { NavColor, NavGroup } from '@/lib/adminNav'

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
  activity: Activity,
  gauge: Gauge,
  graduation: GraduationCap,
  users: Users,
  contact: Contact,
  key: KeyRound,
  clipboard: ClipboardList,
  filePlus: FilePlus,
  wallet: Wallet,
  card: CreditCard,
  flag: Flag,
  scroll: Scroll,
  megaphone: Megaphone,
  camera: Camera,
  upload: Upload,
  search: Search,
  mapPin: MapPin,
  newspaper: Newspaper,
  listChecks: ListChecks,
  mail: Mail,
  userPlus: UserPlus,
  userX: UserX,
  shieldAlert: ShieldAlert,
  shieldCheck: ShieldCheck,
}

// Per-group colour (owner PR9 §6.1). On the DARK sidebar the raw brand colours
// (navy, red, green-deep) fail AA as text/icons, and the palette rule forbids
// tm-gold/tm-red as text — so the group's colour is carried by NON-TEXT elements
// only: the coloured bar beside the label, the active item's left border, and
// its translucent tint. Label and icon TEXT stay a readable light colour, which
// is what keeps check:contrast at 100 (§6.6).
const GROUP_BAR: Record<NavColor, string> = {
  navy: 'bg-tm-navy',
  green: 'bg-tm-green-deep',
  red: 'bg-tm-red',
  gold: 'bg-tm-gold',
  mint: 'bg-tm-mint',
}
const ACTIVE_ITEM: Record<NavColor, string> = {
  navy: 'border-tm-navy bg-tm-navy/25',
  green: 'border-tm-green-deep bg-tm-green-deep/25',
  red: 'border-tm-red bg-tm-red/25',
  gold: 'border-tm-gold bg-tm-gold/25',
  mint: 'border-tm-mint bg-tm-mint/25',
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
  banner,
  badges,
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
  /** A full-width strip below the header (e.g. the BRIDGE_OTP banner). */
  banner?: React.ReactNode
  /** Small count badges keyed by item href (owner PR9 §6.5). No badge when 0. */
  badges?: Record<string, number>
  children: React.ReactNode
}) {
  const pathname = usePathname() ?? '/admin'
  const [collapsed, setCollapsed] = useState(initialCollapsed)
  const [drawer, setDrawer] = useState(false)
  const drawerId = useId()
  const closeRef = useRef<HTMLButtonElement | null>(null)

  // Per-group collapse, remembered per admin in localStorage (owner PR9 §6.4).
  // Default is expanded (an absent/true entry = open); flicker is harmless since
  // groups start open and only collapse after hydration.
  const storeKey = `tm:adminNav:${email ?? 'admin'}`
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({})
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storeKey)
      if (raw) setOpenGroups(JSON.parse(raw) as Record<string, boolean>)
    } catch {
      /* localStorage may be unavailable; groups stay open */
    }
  }, [storeKey])
  const groupOpen = (title: string) => openGroups[title] !== false
  const toggleGroup = (title: string) =>
    setOpenGroups((prev) => {
      const next = { ...prev, [title]: prev[title] === false }
      try {
        localStorage.setItem(storeKey, JSON.stringify(next))
      } catch {
        /* ignore */
      }
      return next
    })

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
    <nav aria-label="Admin sections" className="flex-1 overflow-y-auto px-2 pb-6">
      {groups.map((g, gi) => {
        // Per-group collapse only in the expanded sidebar; a compact (icon-only)
        // rail always shows its items (there is no header to collapse from).
        const open = compact || groupOpen(g.title)
        return (
          // A thin divider between groups (§6.2).
          <div key={g.title} className={gi > 0 ? 'mt-3 border-t border-white/10 pt-3' : ''}>
            {compact ? (
              <p className="sr-only">{g.title}</p>
            ) : (
              <button
                type="button"
                onClick={() => toggleGroup(g.title)}
                aria-expanded={open}
                className="mb-1 flex w-full items-center gap-2 rounded-lg px-2 py-1 hover:bg-white/5"
              >
                {/* The small coloured bar carries the group's colour (§6.1). */}
                <span aria-hidden className={`h-3.5 w-1 shrink-0 rounded-full ${GROUP_BAR[g.color]}`} />
                <span className="flex-1 text-left text-[10px] font-black uppercase tracking-widest text-gray-200">
                  {g.title}
                </span>
                {open ? (
                  <ChevronDown aria-hidden size={13} className="text-gray-300" />
                ) : (
                  <ChevronRight aria-hidden size={13} className="text-gray-300" />
                )}
              </button>
            )}

            {open && (
              <ul className="space-y-0.5">
                {g.items.map((item) => {
                  const Icon = ICONS[item.icon] ?? Gauge
                  const active = isActive(item.href)
                  const count = badges?.[item.href] ?? 0
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        aria-current={active ? 'page' : undefined}
                        title={compact ? item.label : undefined}
                        // border-l-4 always present (transparent when inactive) so
                        // the active border never shifts the row. Active = the
                        // group colour border + a light tint of it (§6.3); hover is
                        // a lighter neutral wash, distinct from active.
                        className={`relative flex min-h-[44px] items-center gap-3 rounded-xl border-l-4 px-2.5 text-xs font-bold transition-colors ${
                          active
                            ? `${ACTIVE_ITEM[g.color]} text-white`
                            : 'border-transparent text-gray-300 hover:bg-white/8 hover:text-white'
                        } ${compact ? 'justify-center' : ''}`}
                      >
                        <span aria-hidden className="grid h-6 w-6 shrink-0 place-items-center">
                          <Icon size={16} />
                        </span>
                        <span className={compact ? 'sr-only' : 'flex-1 truncate'}>{item.label}</span>
                        {count > 0 &&
                          (compact ? (
                            <span
                              aria-hidden
                              className="absolute right-1 top-1 h-2 w-2 rounded-full bg-tm-red"
                            />
                          ) : (
                            <span className="ml-auto inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-tm-red px-1.5 text-[10px] font-black text-white">
                              {count > 99 ? '99+' : count}
                            </span>
                          ))}
                      </Link>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        )
      })}
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

        {banner}

        <main className="mx-auto max-w-6xl px-4 py-5 sm:px-6 sm:py-6">{children}</main>
      </div>
    </div>
  )
}
