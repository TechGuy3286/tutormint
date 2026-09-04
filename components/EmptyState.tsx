import Link from 'next/link'
import { ArrowRight } from 'lucide-react'

// One empty state, everywhere a list can be empty: one icon, one sentence, one
// action. Never a blank panel and never a bare "No rows" — a member who opens
// an empty list should be told what it is and given the one thing to do next.

export default function EmptyState({
  icon,
  title,
  action,
}: {
  icon: React.ReactNode
  title: string
  action?: { label: string; href: string }
}) {
  return (
    <div className="rounded-2xl border border-dashed border-gray-200 bg-white p-6 text-center">
      <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-tm-bg text-gray-500">
        {icon}
      </div>
      <p className="mx-auto max-w-xs text-xs leading-relaxed text-slate-700">{title}</p>
      {action && (
        <Link
          href={action.href}
          className="mt-3 inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-tm-black px-4 text-xs font-bold text-white transition-colors hover:bg-tm-navy"
        >
          {action.label}
          <ArrowRight aria-hidden size={13} />
        </Link>
      )}
    </div>
  )
}
