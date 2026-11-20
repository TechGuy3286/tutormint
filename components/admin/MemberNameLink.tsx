import Link from 'next/link'

import DeletedUserName from '@/components/admin/DeletedUserName'
import { memberAdminHref } from '@/lib/memberLinkCore'

// A member's name that opens their admin member page (owner, 11 Nov 2026).
// No account (a deleted member) → the name as plain text. An account erased on
// request (PR-11) → the grey "Deleted user · erased <date>", no link.
export default function MemberNameLink({
  id,
  name,
  className = '',
  erasedAt,
  avatar = false,
}: {
  id: string | null | undefined
  name: string
  className?: string
  erasedAt?: string | null
  /** With the neutral default avatar (erased rows only). */
  avatar?: boolean
}) {
  if (erasedAt) return <DeletedUserName erasedAt={erasedAt} avatar={avatar} className={className.replace(/\btext-tm-navy\b/g, '')} />
  const href = memberAdminHref(id)
  if (!href) return <span className={className}>{name}</span>
  return (
    <Link href={href} data-member-link="" className={`${className} underline-offset-2 hover:underline`}>
      {name}
    </Link>
  )
}
