import Link from 'next/link'

import StatusChip from '@/components/admin/StatusChip'
import type { MemberRow as Row } from '@/lib/memberFeed'
import { formatDate } from '@/lib/datetime'

// One member row, rendered identically whether the server drew it or the
// browser appended it.

export default function MemberRow({ row: r }: { row: Row }) {
  return (
    <li>
      <Link
        href={`/admin/users/${r.id}`}
        className={`block space-y-1 rounded-2xl border bg-white p-4 transition-colors hover:border-tm-navy ${
          r.suspended ? 'border-tm-red/30' : 'border-gray-200'
        }`}
      >
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="min-w-0 truncate text-sm font-black text-tm-navy">{r.name}</p>
          <span className="flex shrink-0 items-center gap-1.5">
            {/* Suspended is a red state everywhere else in admin; it was gold
                here, which is the tint reserved for "waiting on somebody". */}
            {r.suspended && <StatusChip status="suspended" />}
            {r.verified && !r.suspended && <StatusChip status="verified" />}
            <StatusChip status={r.role} tone="neutral" />
          </span>
        </div>
        <p className="truncate text-[11px] text-gray-500">
          {r.email}
          {r.phone ? ` · ${r.phone}` : ''}
          {r.slug ? ` · /tutor/${r.slug}` : ''}
        </p>
        <p className="text-[11px] text-gray-500">
          {r.plan ?? 'No plan'} · {r.completion}% complete · joined{' '}
          {formatDate(r.createdAt)}
        </p>
      </Link>
    </li>
  )
}
