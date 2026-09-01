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
}: {
  threads: ThreadSummary[]
  emptyHint: string
}) {
  if (threads.length === 0) {
    return (
      <div className="space-y-2 rounded-2xl border border-gray-200 bg-white p-8 text-center">
        <MessageSquare size={20} className="mx-auto text-gray-300" />
        <p className="text-xs font-bold text-[#0F172A]">No conversations yet</p>
        <p className="mx-auto max-w-sm text-xs leading-relaxed text-gray-500">{emptyHint}</p>
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
              <span className="truncate text-xs font-black text-[#0F172A]">{t.otherName}</span>
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
              <p className="truncate text-[11px] font-semibold text-[#059669]">{t.jobTitle}</p>
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
