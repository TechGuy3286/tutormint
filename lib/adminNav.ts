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
  | 'team'
  | 'jobs'
  | 'payments'
  | 'plans'
  | 'reports'
  | 'audit'
  | 'ads'
  | 'social'
  | 'import'
  | 'seo'
  | 'blog'

export type NavItem = {
  href: string
  label: string
  icon: string
  /** SCREEN_ACCESS key. Absent on Overview, which every admin can open. */
  screen?: AdminScreen
}

export type NavGroup = { title: string; items: NavItem[] }

export const NAV_GROUPS: NavGroup[] = [
  {
    title: 'Overview',
    items: [{ href: '/admin', label: 'Overview', icon: 'gauge' }],
  },
  {
    title: 'Verification',
    items: [
      { href: '/admin/tutors', label: 'Tutors', icon: 'graduation', screen: 'tutors' },
      { href: '/admin/parents', label: 'Parents', icon: 'users', screen: 'parents' },
    ],
  },
  {
    title: 'Members',
    items: [
      { href: '/admin/users', label: 'Members', icon: 'contact', screen: 'users' },
      { href: '/admin/team', label: 'Team', icon: 'key', screen: 'team' },
    ],
  },
  {
    title: 'Marketplace',
    items: [
      { href: '/admin/jobs', label: 'Tuitions', icon: 'clipboard', screen: 'jobs' },
      { href: '/admin/payments', label: 'Payments', icon: 'wallet', screen: 'payments' },
      { href: '/admin/plans', label: 'Plans', icon: 'card', screen: 'plans' },
    ],
  },
  {
    title: 'Trust',
    items: [
      { href: '/admin/reports', label: 'Reports', icon: 'flag', screen: 'reports' },
      { href: '/admin/audit', label: 'Audit', icon: 'scroll', screen: 'audit' },
    ],
  },
  {
    title: 'Growth',
    items: [
      { href: '/admin/ads', label: 'Advertisements', icon: 'megaphone', screen: 'ads' },
      { href: '/admin/social', label: 'Social posts', icon: 'camera', screen: 'social' },
      { href: '/admin/import', label: 'Bulk import', icon: 'upload', screen: 'import' },
      { href: '/admin/seo/landing', label: 'Landing pages', icon: 'search', screen: 'seo' },
      { href: '/admin/blog', label: 'Blog', icon: 'newspaper', screen: 'blog' },
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
  new: 'New post',
  import: 'Bulk import',
  jobs: 'Tuitions',
  parents: 'Parents',
  payments: 'Payments',
  plans: 'Plans',
  reports: 'Reports',
  seo: 'SEO',
  landing: 'Landing pages',
  social: 'Social posts',
  team: 'Team',
  tutors: 'Tutors',
  usage: 'Quota usage',
  users: 'Members',
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
          ? 'Member'
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
