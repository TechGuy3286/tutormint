import Link from 'next/link'

// The two tabs at the top of a member's admin page (owner, 23 Oct 2026):
// Profile (everything about them, as before) and Activity (one timeline of
// what has happened to them). A role that may open only the Activity tab
// (Tuitions staff, from Paid tutors) sees no Profile tab.

export default function MemberTabs({ memberId, current, showProfile }: { memberId: string; current: 'profile' | 'activity'; showProfile: boolean }) {
  const tabs = [
    ...(showProfile ? [{ key: 'profile' as const, label: 'Profile', href: `/admin/users/${memberId}` }] : []),
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
