import Link from 'next/link'

// The tabs at the top of a member's admin page: Profile (everything about
// them), Edit (a tutor's fields, profile address and change history — owner,
// 31 Oct 2026, replacing the separate tutor record page) and Activity (one
// timeline of what has happened to them). A role that may open only the
// Activity tab (Tuitions staff, from Paid tutors) sees no Profile tab; Edit
// shows only for a tutor, to a role that opens the tutors screen.

export default function MemberTabs({
  memberId,
  current,
  showProfile,
  showEdit = false,
}: {
  memberId: string
  current: 'profile' | 'edit' | 'activity'
  showProfile: boolean
  showEdit?: boolean
}) {
  const tabs = [
    ...(showProfile ? [{ key: 'profile' as const, label: 'Profile', href: `/admin/users/${memberId}` }] : []),
    ...(showEdit ? [{ key: 'edit' as const, label: 'Edit', href: `/admin/users/${memberId}/edit` }] : []),
    { key: 'activity' as const, label: 'Activity', href: `/admin/users/${memberId}/activity` },
  ]
  return (
    <nav aria-label="Member page" className="flex gap-1 border-b border-gray-200">
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          aria-current={t.key === current ? 'page' : undefined}
          className={`-mb-px min-h-[44px] border-b-2 px-4 py-2.5 text-xs font-bold ${
            t.key === current ? 'border-tm-red text-tm-navy' : 'border-transparent text-gray-600 hover:text-tm-navy'
          }`}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  )
}
