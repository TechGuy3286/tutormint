import Link from 'next/link'

import { requireAdminRole, roleSatisfies, SCREEN_ACCESS } from '@/lib/adminAuth'
import { loadHiringTemplate, loadSubjectLevels, loadUnmetBoard, loadWordTargets, withSchoolMatches } from '@/lib/unmetSearches'

import UnmetSearchesClient from './UnmetSearchesClient'

// Overview → "Unmet searches this week" (owner, 11 Oct 2026): searches that
// found nothing, made actionable. It reads the SAME loader the Overview counts
// with (lib/unmetSearches loadUnmetBoard), so the tile equals the To review tab.
// Owner, admin, operations act; the Partner sees the cards with no buttons and
// the server refuses their writes.

export const dynamic = 'force-dynamic'

export default async function UnmetSearchesPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const actor = await requireAdminRole(...SCREEN_ACCESS.unmetSearches)
  // Adding a subject changes the subject list: the roles that manage Subjects.
  const canAddSubject = roleSatisfies(actor.adminRole, SCREEN_ACCESS.subjectsCore)
  const tab = (await searchParams).tab === 'done' ? 'done' : 'review'
  const [board, targets, template, levels] = await Promise.all([loadUnmetBoard(), loadWordTargets(), loadHiringTemplate(), canAddSubject ? loadSubjectLevels() : Promise.resolve([])])

  // A search that names a school is labelled "School" (owner, 13 Oct 2026).
  const cards = await withSchoolMatches(board.toReview)

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-lg font-black text-tm-navy">Unmet searches this week</h1>
          <p className="text-xs font-bold text-slate-700">
            {board.toReview.length} search{board.toReview.length === 1 ? '' : 'es'} found nothing in the last 7 days
          </p>
          <p className="text-[11px] text-gray-600">
            {board.excluded} search{board.excluded === 1 ? '' : 'es'} by staff, test accounts or test text {board.excluded === 1 ? 'is' : 'are'} left out.
          </p>
        </div>
        <Link href="/admin" className="inline-flex min-h-[44px] items-center rounded-xl border border-gray-200 bg-white px-4 text-xs font-bold text-slate-700 hover:border-tm-navy">
          Back to Overview
        </Link>
      </header>

      <nav aria-label="Tabs" className="flex flex-wrap gap-2">
        {(
          [
            ['review', 'To review', board.toReview.length],
            ['done', 'Done', board.done.length],
          ] as const
        ).map(([k, label, n]) => {
          const on = k === tab
          return (
            <Link
              key={k}
              href={k === 'done' ? '/admin/overview/todo-unmet?tab=done' : '/admin/overview/todo-unmet'}
              aria-current={on ? 'page' : undefined}
              className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-full border px-4 text-xs font-bold ${
                on ? 'border-tm-navy bg-tm-navy text-white' : 'border-gray-200 bg-white text-tm-navy hover:border-tm-navy'
              }`}
            >
              {label} <span className={on ? 'text-white' : 'text-gray-600'}>{n}</span>
            </Link>
          )
        })}
      </nav>

      <UnmetSearchesClient tab={tab} cards={cards} done={board.done} targets={targets} template={template} levels={levels} canAddSubject={canAddSubject} />
    </div>
  )
}
