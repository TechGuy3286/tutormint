// lib/peopleListQuery.ts
//
// The ONE description of the list a People tab shows (owner, 16 Nov 2026):
// which stored list, which fixed tags, which chips, the sign-up day window, the
// search and the order. People (app/admin/users/PeopleTabs.tsx) draws it and
// Export CSV (app/api/admin/users/export) exports it — the same query, so the
// file holds exactly the rows the chips and search are showing.
//
// Pure (no database): the caller runs it through listPage / admin_list_page.

import type { FilterRow } from '@/components/admin/OverviewCardGrid'
import { PLAN_FILTER } from '@/lib/upgradePlanCore'
import { peopleList, windowRange } from '@/lib/adminSummaryCore'
import { PARENT_CHIPS, peopleFixed } from '@/lib/peopleDirectoryCore'
import {
  FU_BUCKET_LABEL,
  FU_BUCKETS,
  FU_DONE,
  FU_TRIED,
  FU_TRIED_LABEL,
  isFollowStage,
  PIPE_STAGES,
  REUPLOADED,
  STAGE_LABEL,
  tutorStageFromAddress,
} from '@/lib/tutorPipelineCore'
import { REUPLOADED_LABEL } from '@/lib/tutorPipelineCardCore'
import { isSignupWindow, type SignupWindow } from '@/lib/staffOutreachCore'
import { pickChips } from '@/lib/cardGridPagingCore'

type Sp = Record<string, string | string[] | undefined>
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)

export type PeopleListQuery = {
  list: string
  isTutors: boolean
  rows: FilterRow[]
  sel: Record<string, string>
  stageSel: string
  followRow: boolean
  showNi: boolean
  signed: SignupWindow | null
  view: 'real' | 'all' | 'deleted'
  fixed: Record<string, unknown>
  since: string | null
  until: string | null
  q: string
  order: 'pos' | 'sort_asc'
  /** The chip rows as admin_list_page takes them. */
  rowQuery: { param: string; value: string }[]
}

/** The list a Tutors or Parents tab shows for this address. */
export function peopleListQuery(
  tab: 'tutors' | 'parents',
  sp: Sp,
  opts: { showAll: boolean; showDeleted: boolean; nowMs?: number },
): PeopleListQuery {
  const isTutors = tab === 'tutors'
  const { showAll, showDeleted } = opts
  // Opened with no filter in the address, staff land on Approved, fee pending ·
  // Not followed up (owner, 9 Nov 2026); any filter in the address wins.
  const stageSel = isTutors ? tutorStageFromAddress(sp) : 'all'
  const followRow = isTutors && !showDeleted && isFollowStage(stageSel)
  const rows: FilterRow[] = isTutors
    ? [
        {
          param: 'stage',
          // An array tag: the stage, plus 'reuploaded' after a re-upload (owner, 15 Nov 2026).
          sqlParam: 'stages',
          label: 'Stage',
          keepFirst: true,
          options: [
            { key: 'all', label: 'All' },
            ...PIPE_STAGES.map((s) => ({ key: s, label: STAGE_LABEL[s] })),
            { key: REUPLOADED, label: REUPLOADED_LABEL },
          ],
        },
        // People → Paid (owner, 10 Nov 2026): All paid · Verified · Premium · Featured.
        ...(stageSel === 'paid' && !showDeleted
          ? [{ param: 'plan', label: 'Plan', options: PLAN_FILTER.map((p) => ({ key: p.key, label: p.label })) }]
          : []),
        ...(followRow
          ? [
              {
                // Due now · 1st · 2nd · 3rd+ (owner, 15 Nov 2026); an old
                // ?fu=done still lists everyone followed up (a hidden chip).
                param: 'fu',
                sqlParam: 'fus',
                label: 'Follow-up',
                options: [
                  ...FU_BUCKETS.map((b) => ({ key: b, label: FU_BUCKET_LABEL[b] })),
                  // Approved, fee pending: "Tried to pay (N)" (owner, 15 Nov 2026).
                  ...(stageSel === 'approved' ? [{ key: FU_TRIED, label: FU_TRIED_LABEL }] : []),
                  { key: FU_DONE, label: 'Followed up (all)', hidden: true },
                ],
              },
            ]
          : []),
      ]
    : [
        {
          param: 'posted',
          label: 'Tuitions',
          options: [
            { key: 'all', label: 'All' },
            { key: 'posted', label: 'Posted a tuition' },
            { key: 'notposted', label: 'Not posted yet' },
          ],
        },
        {
          param: 'pv',
          label: 'Verification',
          options: [{ key: 'all', label: 'All' }, ...PARENT_CHIPS.map((c) => ({ key: c.key, label: c.label, hideWhenZero: c.key === 'rejected' }))],
        },
      ]

  // Not interested (tutors): off every list, under its own grey chip with Undo.
  const showNi = isTutors && one(sp.ni) === '1' && !showDeleted
  // "Signed up today, not paid" from the Overview: a sign-up day, unpaid only.
  const signedRaw = one(sp.signed)
  const signed: SignupWindow | null = isTutors && isSignupWindow(signedRaw) ? signedRaw : null
  const range = signed ? windowRange(signed, opts.nowMs ?? Date.now()) : null
  const view = showDeleted ? 'deleted' : showAll ? 'all' : 'real'
  const fixed: Record<string, unknown> = {
    ...peopleFixed(view),
    // (The sign-up day view lists every unpaid tutor of that day, Not interested included — the card's count.)
    ...(isTutors && view === 'real' && !signed ? { ni: showNi } : {}),
    ...(signed ? { paid: 'unpaid' } : {}),
  }
  const q = one(sp.q) ?? ''
  const sel = pickChips(rows, isTutors ? { ...sp, stage: stageSel } : sp)
  // A numbered follow-up chip lists soonest due first; Waiting oldest upload first.
  // Approved, fee pending keeps the stored order in every chip: newest approval
  // first, contacted in the last 3 days at the bottom (owner, 15 Nov 2026).
  const order: 'pos' | 'sort_asc' =
    isTutors && ((followRow && sel.fu !== 'not' && sel.stage !== 'approved') || sel.stage === 'waiting') ? 'sort_asc' : 'pos'
  return {
    list: peopleList(isTutors ? 'tutor' : 'parent'),
    isTutors,
    rows,
    sel,
    stageSel,
    followRow,
    showNi,
    signed,
    view,
    fixed,
    since: range?.since ?? null,
    until: range?.until ?? null,
    q,
    order,
    rowQuery: rows.map((r) => ({ param: r.sqlParam ?? r.param, value: sel[r.param] ?? r.options[0].key })),
  }
}

/** The address keys a People list depends on — carried onto Export CSV. */
export const PEOPLE_LIST_KEYS = ['tab', 'all', 'deleted', 'ni', 'signed', 'stage', 'plan', 'fu', 'posted', 'pv', 'q'] as const

/** The Export CSV link for the list on screen: the same address keys, nothing else. */
export function peopleExportHref(tab: 'tutors' | 'parents' | 'staff', sp: Sp): string {
  const params = new URLSearchParams()
  params.set('tab', tab)
  if (tab !== 'staff') {
    for (const k of PEOPLE_LIST_KEYS) {
      if (k === 'tab') continue
      const v = one(sp[k])
      if (v != null && v !== '') params.set(k, v)
    }
  }
  return `/api/admin/users/export?${params.toString()}`
}
