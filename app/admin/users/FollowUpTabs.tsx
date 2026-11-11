import Link from 'next/link'

import LoadMoreLink from '@/components/admin/LoadMoreLink'
import { loadOrphanedAccounts } from '@/lib/adminOrphans'
import { listPage, readSummary } from '@/lib/adminSummary'
import { PARENT_FU_LIST } from '@/lib/adminSummaryCore'
import { PARENT_CHIP_LABEL, type ParentChip } from '@/lib/parentFollowUpCore'
import type { ParentFollowRow as ParentRow } from '@/lib/parentFollowUps'
import { peopleHref } from '@/lib/peopleDirectoryCore'
import { FU_TAB_LABEL } from '@/lib/tutorFollowUpTabsCore'

import OrphansSection from './OrphansSection'
import ParentFollowUpsBoard, { type ParentCard } from './ParentFollowUpsBoard'

// The two Follow-ups tabs that moved into People as they were (owner, 8 Nov
// 2026): "Parents & email not confirmed" and "Orphaned accounts". Same lists,
// same actions; only the address changed (/admin/users?tab=parent_followups,
// ?tab=orphans).

const groupPill = (on: boolean) =>
  `inline-flex min-h-[40px] items-center gap-1.5 rounded-full border px-4 text-xs font-bold ${
    on ? 'border-tm-navy bg-tm-navy text-white' : 'border-gray-200 bg-white text-tm-navy hover:border-tm-navy'
  }`

const href = (extra: Record<string, string | undefined>) => peopleHref('parent_followups', extra)

export async function ParentFollowUpsTab({
  showNotInterested,
  fuTab,
  chip,
  shown,
  shownNoReply,
}: {
  showNotInterested: boolean
  fuTab: 'todo' | 'sent'
  chip: ParentChip
  shown: number
  shownNoReply: number
}) {
  const pq = { fixed: { ni: showNotInterested }, rows: [{ param: 'pchip', value: chip }], split: 'tabsec' }
  const [res, nr, fu] = await Promise.all([
    listPage<ParentRow>(PARENT_FU_LIST, { ...pq, splitValues: [fuTab], order: fuTab === 'todo' ? 'overdue_sort' : 'pos', limit: shown }),
    fuTab === 'sent' ? listPage<ParentRow>(PARENT_FU_LIST, { ...pq, splitValues: ['no_reply'], order: 'pos', limit: shownNoReply }) : Promise.resolve(null),
    readSummary(['fu']),
  ])
  const notInterestedCount = ((fu.get('fu')?.payload ?? {}) as { parentNotInterested?: number }).parentNotInterested ?? 0
  const pchip = res.rowCounts.pchip ?? {}
  const toCard = (r: ParentRow): ParentCard => ({
    id: r.id,
    name: r.name,
    city: r.city,
    joinedAt: r.joinedAt,
    reason: r.reason,
    tuition: r.tuition ? { title: r.tuition.title, path: r.tuition.path } : null,
    state: r.state,
    hasNumber: r.hasNumber,
    hasEmail: r.hasEmail,
    notInterested: r.notInterested,
    niMark: r.niMark ?? null,
  })
  const todoCount = res.split.todo ?? 0
  const sentCount = res.split.sent ?? 0
  const noReplyCount = res.split.no_reply ?? 0
  const base = { scope: showNotInterested ? 'not_interested' : undefined, chip: chip === 'all' ? undefined : chip }

  return (
    <div className="space-y-3">
      <nav aria-label="Which parents" className="flex flex-wrap gap-2">
        <Link href={href({ chip: base.chip })} aria-current={!showNotInterested ? 'page' : undefined} className={groupPill(!showNotInterested)}>
          Not finished
        </Link>
        <Link
          href={href({ scope: 'not_interested', chip: base.chip })}
          aria-current={showNotInterested ? 'page' : undefined}
          className={groupPill(showNotInterested)}
        >
          Not interested <span className={showNotInterested ? 'text-white' : 'text-gray-500'}>{notInterestedCount}</span>
        </Link>
      </nav>
      <nav aria-label="To do or followed up" className="flex flex-wrap gap-1 border-b border-gray-200" data-parent-tabs="">
        {(['todo', 'sent'] as const).map((t) => (
          <Link
            key={t}
            href={href({ ...base, fu: t === 'sent' ? 'sent' : undefined })}
            aria-current={fuTab === t ? 'page' : undefined}
            className={`-mb-px min-h-[44px] border-b-2 px-3 py-2.5 text-xs font-bold ${fuTab === t ? 'border-tm-red text-tm-navy' : 'border-transparent text-gray-600 hover:text-tm-navy'}`}
          >
            {FU_TAB_LABEL[t]} <span className="text-gray-500">{t === 'todo' ? todoCount : sentCount + noReplyCount}</span>
          </Link>
        ))}
      </nav>
      <nav aria-label="Filter parents" className="flex flex-wrap gap-2">
        {(Object.keys(PARENT_CHIP_LABEL) as ParentChip[]).map((c) => (
          <Link
            key={c}
            href={href({ ...base, chip: c === 'all' ? undefined : c, fu: fuTab === 'sent' ? 'sent' : undefined })}
            aria-current={chip === c ? 'page' : undefined}
            className={groupPill(chip === c)}
          >
            {PARENT_CHIP_LABEL[c]} <span className={chip === c ? 'text-white' : 'text-gray-500'}>{pchip[c] ?? 0}</span>
          </Link>
        ))}
      </nav>
      <ParentFollowUpsBoard cards={res.rows.map((x) => toCard(x.row))} noReply={fuTab === 'sent' ? (nr?.rows ?? []).map((x) => toCard(x.row)) : []} />
      {res.total > 0 && <LoadMoreLink shown={Math.min(shown, res.total)} total={res.total} noun="parents" />}
      {fuTab === 'sent' && noReplyCount > shownNoReply && <LoadMoreLink shown={shownNoReply} total={noReplyCount} noun="parents with no reply" param="nr" />}
    </div>
  )
}

export async function OrphansTab() {
  const orphans = await loadOrphanedAccounts()
  return <OrphansSection rows={orphans.rows} ok={orphans.ok} />
}
