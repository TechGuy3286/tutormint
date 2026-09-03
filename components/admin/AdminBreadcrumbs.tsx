'use client'

import { usePathname } from 'next/navigation'

import Breadcrumbs, { type Crumb } from '@/components/Breadcrumbs'

// Admin's breadcrumbs, derived once in the layout rather than added page by
// page.
//
// Every other area of the site passes its own trail, because the last crumb is
// usually a real thing with a name -- a tutor, a job, a conversation. Admin is
// the exception: its sections are a fixed list with fixed labels, seven of its
// screens are one-line delegations to a client component with no markup of
// their own to hang a crumb on, and a screen added next month would silently
// ship without one. Deriving the trail from the path covers all of them and
// cannot be forgotten.
//
// The labels match the nav in app/admin/layout.tsx. Where they disagree the
// nav is right -- that is the wording an admin has already read.
const LABELS: Record<string, string> = {
  ads: 'Advertisements',
  audit: 'Audit',
  import: 'Bulk import',
  jobs: 'Tuitions',
  parents: 'Parent verification',
  payments: 'Payments',
  plans: 'Plans',
  reports: 'Reports',
  social: 'Social posts',
  team: 'Team',
  tutors: 'Tutor moderation',
  usage: 'Quota usage',
  users: 'Members',
}

export default function AdminBreadcrumbs() {
  const pathname = usePathname() ?? '/admin'
  const parts = pathname.split('/').filter(Boolean).slice(1) // drop 'admin'

  if (parts.length === 0) return <Breadcrumbs items={[{ label: 'Admin' }]} />

  const items: Crumb[] = [{ label: 'Admin', href: '/admin' }]
  let href = '/admin'

  parts.forEach((part, i) => {
    href += `/${part}`
    // An id segment: /admin/users/<uuid>. There is no name to show from the
    // path alone, and "Member" is honest where the raw uuid is noise.
    const label = LABELS[part] ?? (parts[i - 1] === 'users' ? 'Member' : part)
    items.push(i === parts.length - 1 ? { label } : { label, href })
  })

  return <Breadcrumbs items={items} />
}
