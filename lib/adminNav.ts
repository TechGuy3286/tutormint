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
  | 'overview'
  | 'tutors'
  | 'parents'
  | 'users'
  | 'usersView'
  | 'receiptCheck'
  | 'backendSupportKpi'
  | 'staffActivity' // Team activity → Verifications & messages (no nav entry of its own)
  | 'orphans'
  | 'signups'
  | 'team'
  | 'jobs'
  | 'payments'
  | 'paymentsSwitches'
  | 'paymentGateways'
  | 'smsHealth'
  | 'notificationSettings'
  | 'emailUsage'
  | 'contactWithdraw'
  | 'emailHealth'
  | 'finance'
  | 'revenue'
  | 'paymentAmounts'
  | 'subjectsCore'
  | 'reconciliation'
  | 'duplicates'
  | 'plans'
  | 'reports'
  | 'reviews'
  | 'inbox'
  | 'audit'
  | 'ads'
  | 'social'
  | 'seo'
  | 'unmetSearches'
  | 'blog'
  | 'blogQueue'
  | 'unpaidSignups'
  | 'featuredWhatsapp'
  | 'pausedTuitions'
  | 'applicantForwards'
  | 'paidTutors'
  | 'cityOwners'
  | 'jobsPost'
  | 'tuitionPosting'
  | 'mySignups'

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
    items: [
      // `screen: 'overview'` keeps the figures off the restricted tuitions_staff
      // role (which cannot see Overview); every full role still has it.
      { href: '/admin', label: 'Overview', icon: 'gauge', screen: 'overview' },
      // No `screen`: every staff member can open their own two-factor screen
      // (PR50 §2), including a non-owner who never sees the Team page.
      { href: '/admin/security', label: 'Two-factor', icon: 'shieldCheck' },
    ],
  },
  {
    title: 'People',
    color: 'navy', // #151E6B
    items: [
      // ONE member directory, tabs Tutors | Parents | Staff (owner, 21 Oct 2026).
      // It replaced the Verification group (Tutors, Parents); its badge is the
      // documents waiting for the Owner, tutors and parents together.
      { href: '/admin/users', label: 'People', icon: 'contact', screen: 'usersView' },
      // ONE page for follow-ups (owner, 15 Oct 2026): it replaced Unpaid signups
      // and Abandoned signups (tabs Tutors | Parents & email not confirmed |
      // Orphaned accounts). Tuitions staff see the Tutors tab only.
      { href: '/admin/follow-ups', label: 'Follow-ups', icon: 'phone', screen: 'unpaidSignups' },
      { href: '/admin/users/featured-whatsapp', label: 'Featured WhatsApp', icon: 'messageCircle', screen: 'featuredWhatsapp' },
      { href: '/admin/team', label: 'Team', icon: 'key', screen: 'team' },
    ],
  },
  {
    // One group for everything tuition (owner, 15 Oct 2026), shown to every
    // role that posts tuitions. Each item still carries its own screen key.
    title: 'Tuitions',
    color: 'red', // #C20202
    items: [
      { href: '/admin/jobs', label: 'Tuitions', icon: 'clipboard', screen: 'jobs' },
      { href: '/admin/jobs/new', label: 'Post a tuition', icon: 'filePlus', screen: 'jobsPost' },
      // Its own page (owner, 22 Oct 2026; was Follow-ups → Applications). Its
      // badge: overdue applications on the viewer's own tuitions — all of them
      // for the site Owner. Applications on tuitions over 30 days old never count.
      { href: '/admin/applications', label: 'Applications', icon: 'inbox', screen: 'applicantForwards' },
      // Has every paid tutor been served? (owner, 23 Oct 2026). Its badge: red
      // rows in the viewer's own cities — every red row for the site Owner.
      { href: '/admin/paid-tutors', label: 'Paid tutors', icon: 'userCheck', screen: 'paidTutors' },
      // Auto-paused tuitions with Resume (owner, 8 Oct 2026): the roles that post.
      { href: '/admin/jobs/paused', label: 'Paused tuitions', icon: 'pause', screen: 'pausedTuitions' },
      { href: '/admin/jobs/duplicates', label: 'Duplicates', icon: 'copy', screen: 'duplicates' },
      // Who owns each city's parent-posted tuitions (owner, 22 Oct 2026). Only
      // the site Owner edits; the Partner views.
      { href: '/admin/settings/city-owners', label: 'City owners', icon: 'mapPin', screen: 'cityOwners' },
      // ONE page for staff numbers (owner, 15 Oct 2026): it replaced Staff
      // activity (People) and Tuition posting activity. Paid sign-ups first; the
      // Verifications & messages tab is checked separately (staffActivity).
      { href: '/admin/team-activity', label: 'Team activity', icon: 'activity', screen: 'tuitionPosting' },
      // Each staff member's own sign-ups (owner, 16 Oct 2026).
      { href: '/admin/my-signups', label: 'My sign-ups', icon: 'userPlus', screen: 'mySignups' },
    ],
  },
  {
    title: 'Marketplace',
    color: 'red', // #C20202
    items: [
      { href: '/admin/payments', label: 'Payments', icon: 'wallet', screen: 'payments' },
      // Owner only, plus the view-only Partner (owner, 8 Oct 2026, item 4).
      // Settlement check is a tab of it (owner, 15 Oct 2026).
      { href: '/admin/finance', label: 'Finance', icon: 'scale', screen: 'finance' },
      { href: '/admin/payments/settings', label: 'Settings', icon: 'listChecks', screen: 'paymentsSwitches' },
      { href: '/admin/payments/settings/gateways', label: 'Payment gateways', icon: 'card', screen: 'paymentGateways' },
      { href: '/admin/settings/subjects', label: 'Subjects', icon: 'listChecks', screen: 'subjectsCore' },
      { href: '/admin/settings/sms', label: 'SMS', icon: 'messageCircle', screen: 'smsHealth' },
      { href: '/admin/settings/email', label: 'Email', icon: 'messageCircle', screen: 'emailHealth' },
      { href: '/admin/settings/notifications', label: 'Notification settings', icon: 'listChecks', screen: 'notificationSettings' },
      { href: '/admin/settings/email-usage', label: 'Email usage', icon: 'messageCircle', screen: 'emailUsage' },
      { href: '/admin/plans', label: 'Plans', icon: 'card', screen: 'plans' },
    ],
  },
  {
    title: 'Trust',
    color: 'gold', // #F59E0B
    items: [
      // ONE page, tabs Reports | Flagged messages (owner, 15 Oct 2026).
      { href: '/admin/reports', label: 'Reports & flags', icon: 'flag', screen: 'reports' },
      { href: '/admin/reviews', label: 'Reviews', icon: 'star', screen: 'reviews' },
      { href: '/admin/inbox', label: 'Team inbox', icon: 'mail', screen: 'inbox' },
      { href: '/admin/audit', label: 'Audit', icon: 'scroll', screen: 'audit' },
      // Owner only (owner, 27 Oct 2026): remove a phone number used without consent.
      { href: '/admin/withdraw-contact', label: 'Withdraw a contact', icon: 'phone', screen: 'contactWithdraw' },
    ],
  },
  {
    title: 'Growth',
    color: 'mint', // #9AE899
    items: [
      { href: '/admin/ads', label: 'Advertisements', icon: 'megaphone', screen: 'ads' },
      { href: '/admin/social', label: 'Social posts', icon: 'camera', screen: 'social' },
      { href: '/admin/seo/landing', label: 'Landing pages', icon: 'search', screen: 'seo' },
      { href: '/admin/seo/locations', label: 'Locations', icon: 'mapPin', screen: 'seo' },
      { href: '/admin/seo/indexing', label: 'Google indexing', icon: 'search', screen: 'seo' },
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
  gateways: 'Payment gateways',
  finance: 'Finance',
  settlement: 'Settlement check',
  overview: 'Overview',
  subjects: 'Subjects',
  settings: 'Settings',
  payers: 'Paid today',
  'staff-approved': 'Approved by staff',
  review: 'Review new wording',
  inbox: 'Team inbox',
  ads: 'Advertisements',
  audit: 'Audit',
  blog: 'Blog',
  queue: 'Content queue',
  // Neutral: shared by /admin/blog/new and /admin/jobs/new, so it reads
  // correctly under both ("Blog › New", "Tuitions › New").
  new: 'New',
  jobs: 'Tuitions',
  parents: 'Parents',
  payments: 'Payments',
  reconciliation: 'Reconciliation',
  duplicates: 'Duplicates',
  paused: 'Paused tuitions',
  // Old addresses, now redirects to Team activity (owner, 15 Oct 2026).
  'posting-activity': 'Team activity',
  'team-activity': 'Team activity',
  'my-signups': 'My sign-ups',
  accounts: 'Accounts',
  added: 'Review added areas',
  claims: 'Claims to review',
  plans: 'Plans',
  reports: 'Reports & flags',
  flags: 'Reports & flags',
  reviews: 'Reviews',
  'follow-ups': 'Follow-ups',
  applications: 'Applications',
  'city-owners': 'City owners',
  security: 'Two-factor',
  seo: 'SEO',
  landing: 'Landing pages',
  orphans: 'Follow-ups',
  signups: 'Follow-ups',
  social: 'Social posts',
  'staff-activity': 'Team activity',
  team: 'Team',
  tutors: 'Tutors',
  videos: 'Video reviews',
  usage: 'Quota usage',
  // "Members" → "People" everywhere admin reads it (owner PR32 §6). The URL stays
  // /admin/users — only the label changes.
  users: 'People',
  'unpaid-signups': 'Follow-ups',
  'featured-whatsapp': 'Featured WhatsApp',
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
                : parts[i - 1] === 'team-activity'
                  ? 'Staff member'
                  : part))
      : SECTION_LABELS[part]
    // /admin/overview has no page of its own: the Overview IS /admin.
    const to = i === 0 && part === 'overview' ? '/admin' : href
    crumbs.push(i === parts.length - 1 ? { label } : { label, href: to })
  })

  return { crumbs, title: crumbs[crumbs.length - 1].label }
}
