import Link from 'next/link'

import StatusChip from '@/components/admin/StatusChip'
import CopyButton from '@/components/admin/CopyButton'
import type { MemberRow as Row } from '@/lib/memberFeed'
import { formatDate } from '@/lib/datetime'

// One member row, rendered identically whether the server drew it or the
// browser appended it.
//
// The whole card links to the member page via a STRETCHED LINK (absolute
// inset-0), so the copy-mobile button can sit inside the card and still work:
// it is positioned above the link (relative z-10) and stops propagation, so
// tapping it copies without navigating.

export default function MemberRow({ row: r }: { row: Row }) {
  return (
    <li
      className={`relative rounded-2xl border bg-white transition-colors hover:border-tm-navy ${
        r.suspended ? 'border-tm-red/30' : 'border-gray-200'
      }`}
    >
      <Link
        href={`/admin/users/${r.id}`}
        aria-label={`Open ${r.name}`}
        className="absolute inset-0 rounded-2xl"
      />
      <div className="space-y-1 p-4">
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

        {/* Mobile with a copy button, so an admin can grab the number without
            opening the member. */}
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px] text-gray-500">
          <span className="truncate">{r.email}</span>
          {r.phone && (
            <span className="inline-flex items-center gap-1">
              <span>· {r.phone}</span>
              <CopyButton text={r.phone} label="mobile" />
            </span>
          )}
          {r.slug && <span className="truncate">· /tutor/{r.slug}</span>}
        </div>

        <p className="text-[11px] text-gray-500">
          {r.plan ?? 'No plan'} · {r.completion}% complete
          {r.city ? ` · ${r.city}` : ''} · joined {formatDate(r.createdAt)}
        </p>
      </div>
    </li>
  )
}
