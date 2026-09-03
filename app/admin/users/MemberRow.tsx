import Link from 'next/link'

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
          r.suspended ? 'border-tm-gold/30' : 'border-gray-200'
        }`}
      >
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="min-w-0 truncate text-sm font-black text-tm-navy">{r.name}</p>
          <span className="flex shrink-0 items-center gap-1.5">
            {r.suspended && (
              <span className="rounded-full bg-tm-tint-gold px-2 py-0.5 text-[10px] font-black uppercase text-tm-gold-ink">
                suspended
              </span>
            )}
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase text-slate-700">
              {r.role}
            </span>
          </span>
        </div>
        <p className="truncate text-[11px] text-gray-500">
          {r.email}
          {r.phone ? ` · ${r.phone}` : ''}
          {r.slug ? ` · /tutor/${r.slug}` : ''}
        </p>
        <p className="text-[11px] text-gray-500">
          {r.plan ?? 'No plan'} · {r.completion}% complete ·{' '}
          {r.verified ? 'verified' : 'not verified'} · joined{' '}
          {formatDate(r.createdAt)}
        </p>
      </Link>
    </li>
  )
}
