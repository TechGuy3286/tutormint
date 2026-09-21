// lib/adminNav.ts
//
// The admin sidebar's contents, and the labels every admin surface reads from.
//
// ONE LIST. The sidebar, the page title in the header and the breadcrumb trail
// all come from here, so a screen cannot be called "Tuitions" in the nav and
// "Jobs" in the crumb -- which is how a member of staff ends up unsure whether
// they are on the screen they clicked.
//
// PLAIN DATA, NO SERVER IMPORTS. This file is bundled for the browser (the
// sidebar is a client component), so `icon` is a STRING key the sidebar maps to
// a lucide component, exactly as lib/userMenu.ts does. It must never import
// lib/adminAuth.ts either: that reaches for next/navigation and the
// cookie-backed Supabase client. The caller filters by role and passes the
// result in.
//
// `screen` is the SCREEN_ACCESS key, not a role list, for the same reason:
// resolving it here would mean importing the module that cannot be bundled.

export type AdminScreen =
  | 'tutors'
  | 'parents'
  | 'users'
  | 'staffActivity'
  | 'orphans'
  | 'signups'
  | 'team'
  | 'jobs'
  | 'payments'
  | 'plans'
  | 'reports'
  | 'inbox'
  | 'audit'
  | 'ads'
  | 'social'
  | 'import'
  | 'seo'
  | 'blog'
  | 'blogQueue'

export type NavItem = {
  href: string
  label: string
  icon: string
  /** SCREEN_ACCESS key. Absent on Overview, which every admin can open. */
  screen?: AdminScreen
}

/** The group's identity colour (owner PR9 §6.1). A brand token name — the shell
 *  maps it to the coloured bar, the active left border and the active tint. */
export type NavColor = 'navy' | 'green' | 'red' | 'gold' | 'mint'

export type NavGroup = { title: string; color: NavColor; items: NavItem[] }

export const NAV_GROUPS: NavGroup[] = [
  {
    title: 'Overview',
    color: 'navy', // #151E6B
    items: [{ href: '/admin', label: 'Overview', icon: 'gauge' }],
  },
  {
    title: 'Verification',
    color: 'green', // #2E7D4F
    items: [
      { href: '/admin/tutors', label: 'Tutors', icon: 'graduation', screen: 'tutors' },
      { href: '/admin/parents', label: 'Parents', icon: 'users', screen: 'parents' },
    ],
  },
  {
    title: 'People',
    color: 'navy', // #151E6B
    items: [
      { href: '/admin/users', label: 'People', icon: 'contact', screen: 'users' },
      // Orphaned accounts folded into Abandoned signups as a second section
      // (owner, 14 Sep 2026) — /admin/orphans now redirects there.
      { href: '/admin/signups', label: 'Abandoned signups', icon: 'userPlus', screen: 'signups' },
      { href: '/admin/staff-activity', label: 'Staff activity', icon: 'activity', screen: 'staffActivity' },
      { href: '/admin/team', label: 'Team', icon: 'key', screen: 'team' },
    ],
  },
  {
    title: 'Marketplace',
    color: 'red', // #C20202
    items: [
      { href: '/admin/jobs', label: 'Tuitions', icon: 'clipboard', screen: 'jobs' },
      { href: '/admin/jobs/new', label: 'Post a tuition', icon: 'filePlus', screen: 'jobs' },
      { href: '/admin/payments', label: 'Payments', icon: 'wallet', screen: 'payments' },
      { href: '/admin/plans', label: 'Plans', icon: 'card', screen: 'plans' },
    ],
  },
  {
    title: 'Trust',
    color: 'gold', // #F59E0B
    items: [
      { href: '/admin/reports', label: 'Reports', icon: 'flag', screen: 'reports' },
      { href: '/admin/flags', label: 'Flagged messages', icon: 'shieldAlert', screen: 'reports' },
      { href: '/admin/inbox', label: 'Team inbox', icon: 'mail', screen: 'inbox' },
      { href: '/admin/audit', label: 'Audit', icon: 'scroll', screen: 'audit' },
    ],
  },
  {
    title: 'Growth',
    color: 'mint', // #9AE899
    items: [
      { href: '/admin/ads', label: 'Advertisements', icon: 'megaphone', screen: 'ads' },
      { href: '/admin/social', label: 'Social posts', icon: 'camera', screen: 'social' },
      { href: '/admin/import', label: 'Bulk import', icon: 'upload', screen: 'import' },
      { href: '/admin/seo/landing', label: 'Landing pages', icon: 'search', screen: 'seo' },
      { href: '/admin/seo/locations', label: 'Locations', icon: 'mapPin', screen: 'seo' },
      { href: '/admin/blog', label: 'Blog', icon: 'newspaper', screen: 'blog' },
      { href: '/admin/blog/queue', label: 'Content queue', icon: 'listChecks', screen: 'blogQueue' },
    ],
  },
]

/**
 * Section labels for the breadcrumb trail and the page title.
 *
 * These match the nav wording above wherever a screen appears there; the extra
 * entries are for sub-paths that have no nav entry of their own.
 */
export const SECTION_LABELS: Record<string, string> = {
  ads: 'Advertisements',
  audit: 'Audit',
  blog: 'Blog',
  queue: 'Content queue',
  // Neutral: shared by /admin/blog/new and /admin/jobs/new, so it reads
  // correctly under both ("Blog › New", "Tuitions › New").
  new: 'New',
  import: 'Bulk import',
  jobs: 'Tuitions',
  parents: 'Parents',
  payments: 'Payments',
  plans: 'Plans',
  reports: 'Reports',
  seo: 'SEO',
  landing: 'Landing pages',
  orphans: 'Orphaned accounts',
  signups: 'Abandoned signups',
  social: 'Social posts',
  'staff-activity': 'Staff activity',
  team: 'Team',
  tutors: 'Tutors',
  usage: 'Quota usage',
  // "Members" → "People" everywhere admin reads it (owner PR32 §6). The URL stays
  // /admin/users — only the label changes.
  users: 'People',
}

export type Crumb = { label: string; href?: string }

/**
 * The trail and the page title for one admin path.
 *
 * `dynamicLabel` is the name of the thing an id segment points at -- a job's
 * job_tx_id, a member's name -- looked up on the SERVER by the caller and
 * passed in. Without it the last crumb is a raw uuid, which is noise on the
 * screen and useless in a trail. There is deliberately no client fetch here:
 * the label is data the page already has.
 */
export function adminTrail(
  pathname: string,
  dynamicLabel?: string | null,
): { crumbs: Crumb[]; title: string } {
  const parts = pathname.split('/').filter(Boolean).slice(1) // drop 'admin'

  if (parts.length === 0) return { crumbs: [{ label: 'Admin' }], title: 'Overview' }

  const crumbs: Crumb[] = [{ label: 'Admin', href: '/admin' }]
  let href = '/admin'

  parts.forEach((part, i) => {
    href += `/${part}`
    const isId = !SECTION_LABELS[part]
    const label = isId
      ? (dynamicLabel ??
        // Fallbacks for when the lookup found nothing: the row may have been
        // deleted between the link and the click. A word beats a uuid.
        (parts[i - 1] === 'users'
          ? 'Person'
          : parts[i - 1] === 'jobs'
            ? 'Tuition'
            : parts[i - 1] === 'tutors'
              ? 'Tutor'
              : parts[i - 1] === 'blog'
                ? 'Post'
                : part))
      : SECTION_LABELS[part]
    crumbs.push(i === parts.length - 1 ? { label } : { label, href })
  })

  return { crumbs, title: crumbs[crumbs.length - 1].label }
}
