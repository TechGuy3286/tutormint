import Link from 'next/link'

import { formatDate } from '@/lib/datetime'
import { TUTOR_STAGE_TEXT, type Stage } from '@/lib/applicationStageCore'

// The tutor's own applications on their dashboard (owner, 22 Oct 2026): one
// card per application — the tuition, its city, when they applied and where
// it stands, in the owner's friendly words (lib/applicationStageCore
// TUTOR_STAGE_TEXT). Never the parent's name or number. Hidden when empty.

export type MyApplicationCard = {
  id: string
  title: string
  city: string | null
  appliedAt: string
  stage: Stage
  path: string | null
}

const TONE: Record<Stage, string> = {
  applied: 'bg-tm-bg text-slate-700',
  forwarded: 'bg-tm-tint-navy text-tm-navy',
  contacted: 'bg-tm-tint-navy text-tm-navy',
  demo: 'bg-tm-tint-navy text-tm-navy',
  hired: 'bg-tm-tint-green text-tm-green-deep',
  not_selected: 'bg-tm-bg text-slate-700',
  no_response: 'bg-tm-bg text-slate-700',
}

export default function MyApplicationsSection({ cards, hired }: { cards: MyApplicationCard[]; hired: number }) {
  if (cards.length === 0) return null
  return (
    <section aria-labelledby="my-applications" className="space-y-2 rounded-2xl border border-gray-200 bg-white p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="my-applications" className="text-sm font-black text-tm-navy">
          My applications
        </h2>
        <span className="text-[11px] font-bold text-tm-green-deep">
          {hired} hired
        </span>
      </div>
      <ul className="space-y-2">
        {cards.map((c) => (
          <li key={c.id} className="space-y-1 rounded-xl border border-gray-100 p-3">
            {c.path ? (
              <Link href={c.path} className="block text-xs font-black leading-snug text-tm-navy hover:underline">
                {c.title}
              </Link>
            ) : (
              <p className="text-xs font-black leading-snug text-tm-navy">{c.title}</p>
            )}
            <p className="text-[11px] text-gray-600">
              {c.city ? `${c.city} · ` : ''}Applied {formatDate(c.appliedAt)}
            </p>
            <p className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-bold ${TONE[c.stage]}`}>{TUTOR_STAGE_TEXT[c.stage]}</p>
          </li>
        ))}
      </ul>
      <Link href="/tutor/dashboard/applications" className="inline-flex min-h-[40px] items-center text-[11px] font-bold text-tm-navy hover:underline">
        See all applications
      </Link>
    </section>
  )
}
