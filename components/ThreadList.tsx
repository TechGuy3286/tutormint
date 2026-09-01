import Link from 'next/link'
import { MessageSquare } from 'lucide-react'
import type { ThreadSummary } from '@/lib/messaging'

// The conversation list, shared by both dashboards.
//
// Previews come back already masked when the pair cannot exchange numbers, so
// a number cannot leak through a preview even though the thread itself hides
// it. Same rule, applied at both ends.

export default function ThreadList({
  threads,
  emptyHint,
  emptyActions = [],
}: {
  threads: ThreadSummary[]
  emptyHint: string
  /** Somewhere to go. An empty state that only explains is a dead end. */
  emptyActions?: { label: string; href: string }[]
}) {
  if (threads.length === 0) {
    return (
      <div className="space-y-3 rounded-2xl border border-gray-200 bg-white p-8 text-center">
        <MessageSquare size={20} className="mx-auto text-gray-300" />
        <div className="space-y-1.5">
          <p className="text-xs font-bold text-tm-navy">No conversations yet</p>
          <p className="mx-auto max-w-sm text-xs leading-relaxed text-gray-500">{emptyHint}</p>
        </div>
        {emptyActions.length > 0 && (
          <div className="mx-auto flex max-w-xs flex-col gap-2">
            {emptyActions.map((a, i) => (
              <Link
                key={a.href}
                href={a.href}
                className={
                  i === 0
                    ? 'flex min-h-[44px] items-center justify-center rounded-xl bg-tm-black px-4 text-xs font-bold text-white transition-colors hover:bg-slate-700'
                    : 'flex min-h-[44px] items-center justify-center rounded-xl border border-gray-200 px-4 text-xs font-bold text-tm-navy transition-colors hover:border-tm-navy'
                }
              >
                {a.label}
              </Link>
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <ul className="space-y-2">
      {threads.map((t) => (
        <li key={t.id}>
          <Link
            href={`/messages/${t.id}`}
            className="block space-y-1 rounded-2xl border border-gray-200 bg-white p-4 transition-shadow hover:shadow-md"
          >
            <div className="flex items-baseline justify-between gap-3">
              <span className="truncate text-xs font-black text-tm-navy">{t.otherName}</span>
              {t.lastMessageAt && (
                <span className="shrink-0 text-[10px] text-gray-400">
                  {new Date(t.lastMessageAt).toLocaleDateString('en-PK', {
                    day: 'numeric',
                    month: 'short',
                  })}
                </span>
              )}
            </div>
            {t.jobTitle && (
              <p className="truncate text-[11px] font-semibold text-tm-green-deep">{t.jobTitle}</p>
            )}
            <p className="truncate text-[11px] text-gray-500">
              {t.preview || 'No messages yet'}
            </p>
          </Link>
        </li>
      ))}
    </ul>
  )
}
