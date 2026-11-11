import Link from 'next/link'

import { memberAdminHref } from '@/lib/memberLinkCore'

// A member's name that opens their admin member page (owner, 11 Nov 2026).
// No account (a deleted member) → the name as plain text.
export default function MemberNameLink({ id, name, className = '' }: { id: string | null | undefined; name: string; className?: string }) {
  const href = memberAdminHref(id)
  if (!href) return <span className={className}>{name}</span>
  return (
    <Link href={href} data-member-link="" className={`${className} underline-offset-2 hover:underline`}>
      {name}
    </Link>
  )
}
