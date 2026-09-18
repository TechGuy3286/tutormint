import Link from 'next/link'
import { ArrowRight, Baby } from 'lucide-react'

// The parent dashboard's "My children" card (PR24 §3.2). A compact read-only
// list — name and class, one row each — with a Manage link to the editor at
// /parent/dashboard/children. The page hides this card entirely when there are
// no children. Same card style as the rest of the dashboard.

export type ChildRow = { id: string; name: string | null; classLevel: string | null }

export default function ChildrenCard({ items }: { items: ChildRow[] }) {
  return (
    <section className="space-y-3 rounded-2xl border border-gray-200 bg-white p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-black text-tm-navy">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-tm-tint-navy text-tm-navy">
            <Baby aria-hidden size={16} />
          </span>
          My children
        </h2>
        <Link
          href="/parent/dashboard/children"
          className="inline-flex shrink-0 items-center gap-1 text-xs font-bold text-tm-red"
        >
          Manage
          <ArrowRight aria-hidden size={13} />
        </Link>
      </div>

      <ul className="space-y-1.5">
        {items.map((c) => (
          <li key={c.id} className="rounded-xl bg-tm-bg px-3 py-2">
            {/* "Anas — Matric": name and class on one line, em-dash between them,
                the class in full as stored (PR25 §5). */}
            <span className="text-xs font-bold text-tm-navy">
              {c.name || 'Child'}
              {c.classLevel ? <span className="font-semibold text-gray-500"> — {c.classLevel}</span> : ''}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}
