import Link from 'next/link'
import { requireAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { mayEditSearchWords } from '@/lib/staffAllRows'
import { loadSearchWordsScreen, loadTargets } from '@/lib/searchTerms'
import { requestNowMs, resolvePeriod } from '@/lib/insightsCore'
import { filterTerms, isTermFilter, pagePath, SUGGEST_MIN_SEARCHES, type TermFilter } from '@/lib/searchTermsCore'
import { formatDateTime } from '@/lib/datetime'
import TermActions from './TermActions'

// Admin → Growth → Search words (owner, 24 Nov 2026 — PR-22 Part D). What
// people typed into Browse tutors / Browse tuitions (text and counts only —
// never who), "Means the same as…" (a Search word the one smart search reads
// everywhere), "Real demand" (on the Overview to-do) and suggested landing
// pages. Owner, Project Managers and the 'staff.insights' grant act; Backend
// Support reads.

export const dynamic = 'force-dynamic'

type SP = { period?: string; filter?: string; term?: string }

const PERIOD_CHIPS = [
  { key: 'today', label: 'Today' },
  { key: '7d', label: 'Last 7 days' },
  { key: '30d', label: 'Last 30 days' },
] as const

const chip = (on: boolean) =>
  `inline-flex min-h-[44px] items-center rounded-xl border px-3 text-xs font-bold ${on ? 'border-tm-navy bg-tm-navy text-white' : 'border-gray-200 bg-white text-tm-navy hover:bg-tm-bg'}`

export default async function SearchWordsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const actor = await requireAdminRole(...SCREEN_ACCESS.searchWords)
  const sp = await searchParams
  const nowMs = requestNowMs()
  const periodKey = PERIOD_CHIPS.some((c) => c.key === sp.period) ? (sp.period as string) : '30d'
  const p = resolvePeriod({ period: periodKey }, nowMs)
  const filter: TermFilter = isTermFilter(sp.filter) ? sp.filter : 'zero'
  const [screen, canEdit] = await Promise.all([loadSearchWordsScreen(p.from, p.to, nowMs), mayEditSearchWords(actor)])
  const targets = canEdit ? await loadTargets() : []
  const focus = (sp.term ?? '').trim().toLowerCase()
  const rows = filterTerms(screen.terms, filter).filter((r) => !focus || r.key === focus)
  const href = (o: Partial<SP>) => {
    const q = new URLSearchParams({ period: o.period ?? periodKey, filter: o.filter ?? filter })
    return `/admin/search-words?${q.toString()}`
  }

  return (
    <div className="space-y-4">
      <header className="space-y-2">
        <h2 className="text-lg font-black text-tm-navy">Search words</h2>
        <p className="text-xs text-slate-700">
          The words people typed into Browse tutors and Browse tuitions ({p.label.toLowerCase()}, Pakistan time), counted by the same rule as every search
          count — bots, our own crawls and staff are left out. Only the words and the counts are kept, never who searched. A search that failed (it took too
          long) is not a zero result.
        </p>
        <div className="flex flex-wrap gap-2">
          {PERIOD_CHIPS.map((c) => (
            <Link key={c.key} href={href({ period: c.key })} className={chip(periodKey === c.key)}>
              {c.label}
            </Link>
          ))}
          <span className="w-2" aria-hidden />
          <Link href={href({ filter: 'zero' })} className={chip(filter === 'zero')}>
            Zero results
          </Link>
          <Link href={href({ filter: 'all' })} className={chip(filter === 'all')}>
            All
          </Link>
        </div>
        {!canEdit && <p className="rounded-xl bg-tm-bg p-3 text-xs font-bold text-tm-navy">You can view this screen. Changes are made by the Owner and the Project Managers.</p>}
        {focus && (
          <p className="text-xs">
            Showing one search word. <Link href={href({})} className="font-bold text-tm-navy underline">Show all</Link>
          </p>
        )}
      </header>

      <section className="space-y-2 rounded-2xl border border-gray-200 bg-white p-4">
        <h3 className="text-sm font-black text-tm-navy">
          {filter === 'zero' ? 'Searches that found nothing' : 'Every search word'} · {rows.length}
        </h3>
        {rows.length === 0 ? (
          <p className="text-xs text-slate-700">
            {filter === 'zero' ? 'No typed search came back empty in this period. Try All or Last 30 days.' : 'No typed searches in this period yet. Try Last 30 days.'}
          </p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {rows.map((r) => (
              <li key={r.key} className="space-y-1 py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="min-w-0 break-words text-sm font-black text-tm-navy">“{r.term}”</p>
                  <p className="text-xs text-slate-700">
                    <b className="text-tm-navy">{r.searches}</b> {r.searches === 1 ? 'search' : 'searches'}
                    {r.zero > 0 && <> · <b className="text-tm-red">{r.zero}</b> found nothing</>}
                    {r.failed > 0 && <> · {r.failed} failed</>}
                  </p>
                </div>
                <p className="text-[11px] text-slate-700">
                  {r.surfaces.map((s) => (s === 'tutors' ? 'Browse tutors' : 'Browse tuitions')).join(' + ')} · last searched {formatDateTime(r.last)}
                  {r.understood ? ` · the search reads it as ${r.understood}` : ' · the search does not understand it yet'}
                </p>
                <TermActions
                  term={r.term}
                  canEdit={canEdit}
                  actions={r.actions.map((a) => ({ id: a.id, action: a.action, label: a.target_city ? `${a.target_name} (${a.target_city})` : a.target_name }))}
                  targets={targets}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-2 rounded-2xl border border-gray-200 bg-white p-4">
        <h3 className="text-sm font-black text-tm-navy">Suggested pages</h3>
        <p className="text-[11px] text-slate-700">
          A city and subject searched {SUGGEST_MIN_SEARCHES} or more times in the last 30 days, whose landing page already has enough tutors or tuitions to be
          shown to Google. A suggestion only — link or promote it from <Link href="/admin/seo/landing" className="font-bold text-tm-navy underline">Landing pages</Link>.
        </p>
        {screen.suggestions.length === 0 ? (
          <p className="text-xs text-slate-700">No suggestion yet. A city and subject needs {SUGGEST_MIN_SEARCHES} searches in a month and a page with enough listings.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {screen.suggestions.map((s) => (
              <li key={`${s.page.kind}:${s.page.citySlug}:${s.page.subjectSlug}`} className="flex min-h-[44px] flex-wrap items-center justify-between gap-2 text-xs text-slate-700">
                <span>
                  <b className="text-tm-navy">{s.subject}</b> in {s.city} · {s.searches} searches · {s.page.kind === 'tutors' ? `${s.page.verified ?? 0} verified tutors` : `${s.page.count} open tuitions`}
                </span>
                <a href={pagePath(s.page)} target="_blank" rel="noopener" className="font-bold text-tm-navy underline">
                  {pagePath(s.page)}
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
