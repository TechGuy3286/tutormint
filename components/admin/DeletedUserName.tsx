import Avatar from '@/components/Avatar'
import { DELETED_USER, deletedUserLine } from '@/lib/deletedUserCore'

// The grey "Deleted user · erased <date>" label with the neutral default avatar
// (owner, 20 Nov 2026 — PR-11). No link, no photo, no personal detail.

export default function DeletedUserName({
  erasedAt,
  avatar = true,
  className = '',
  size = 'h-8 w-8 text-[10px]',
  px = 32,
}: {
  erasedAt: string | null | undefined
  avatar?: boolean
  className?: string
  size?: string
  px?: number
}) {
  return (
    <span className={`inline-flex min-w-0 items-center gap-2 text-gray-600 ${className}`} data-deleted-user="">
      {avatar && <Avatar name={DELETED_USER} src={null} gender={null} decorative className={size} px={px} />}
      <span className="truncate font-semibold">{deletedUserLine(erasedAt)}</span>
    </span>
  )
}
