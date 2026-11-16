/**
 * scripts/report-people-counts-check.ts — READ-ONLY (owner, 16 Nov 2026 — PR-02).
 *
 * The People → Tutors self-check on production. For every chip it runs the
 * SAME query the People page runs (lib/peopleListQuery → admin_list_page) and
 * checks:
 *   - the stages add up to All;
 *   - the follow-up chips add up to their stage;
 *   - Tried to pay ⊆ Not followed up (due now);
 *   - each chip's count equals the number of cards its list returns;
 *   - the badge's follow-up part and the Overview to-do rows equal their chips,
 *     and the badge equals its stated sum (documents waiting + fee pending · due).
 * Prints counts and mismatches only — no names, phones or emails. Writes nothing.
 *   npx tsx --env-file=.env.local scripts/report-people-counts-check.ts
 * Exits 1 on any mismatch.
 */
import { createClient } from '@supabase/supabase-js'

import { peopleListQuery } from '../lib/peopleListQuery'
import { FOLLOW_STAGES, FU_BUCKETS, FU_TRIED, PIPE_STAGES, REUPLOADED } from '../lib/tutorPipelineCore'
import { compare, countsFromRows, feePendingFromRows, rejectedUninformedFromRows, structuralMismatches, type CheckRow, type Mismatch } from '../lib/peopleCountsCheckCore'
import type { PipeCard } from '../lib/tutorPipelineCardCore'

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })

type Page = { all: number; searched: number; total: number; rowCounts: Record<string, Record<string, number>>; rows: { id: string }[] }

async function page(sp: Record<string, string>, offset: number, limit: number): Promise<Page> {
  const lq = peopleListQuery('tutors', { tab: 'tutors', ...sp }, { showAll: false, showDeleted: false })
  const { data, error } = await admin.rpc('admin_list_page', {
    p_list: lq.list,
    p_fixed: lq.fixed,
    p_since: lq.since,
    p_until: lq.until,
    p_needle: '',
    p_digits: '',
    p_rows: lq.rowQuery,
    p_split: null,
    p_split_values: null,
    p_order: lq.order,
    p_offset: offset,
    p_limit: limit,
  })
  if (error) throw new Error(error.message)
  return data as Page
}

/** The chip's count and how many cards its list really returns (paged, 500 a call). */
async function chip(sp: Record<string, string>): Promise<{ total: number; cards: number; first: Page }> {
  const first = await page(sp, 0, 500)
  let cards = first.rows.length
  const ids = new Set(first.rows.map((r) => r.id))
  for (let off = 500; off < first.total; off += 500) {
    const p = await page(sp, off, 500)
    for (const r of p.rows) ids.add(r.id)
    cards += p.rows.length
  }
  if (ids.size !== cards) throw new Error(`duplicate cards in a chip list (${JSON.stringify(sp)})`)
  return { total: first.total, cards, first }
}

async function main() {
  const { data: state } = await admin.from('admin_summary').select('payload').eq('key', 'state').maybeSingle()
  console.log('summary built at:', (state?.payload as { builtAt?: string } | null)?.builtAt ?? '—')

  const rows: CheckRow[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin.from('admin_list_rows').select('tags, row').eq('list', 'people:tutor').order('member_id').range(from, from + 999)
    if (error) throw new Error(error.message)
    rows.push(...(data ?? []).map((r) => ({ tags: r.tags as Record<string, unknown>, card: ((r.row as { pipe?: PipeCard } | null)?.pipe ?? null) as PipeCard | null })))
    if (!data || data.length < 1000) break
  }
  const mism: Mismatch[] = [...structuralMismatches(rows)]
  const expect = countsFromRows(rows)

  // Stage row: the page's counts and lists.
  const all = await chip({ stage: 'all' })
  const stageCounts = all.first.rowCounts.stages ?? {}
  console.log(`\nAll: ${all.total} (cards ${all.cards})`)
  mism.push(...compare([['All: count = cards', all.total, all.cards], ['All: count = stored rows', expect.all, all.total]]))
  let sum = 0
  for (const s of [...PIPE_STAGES, REUPLOADED]) {
    const c = await chip({ stage: s })
    const shown = stageCounts[s] ?? 0
    // A followed-up stage opens on its Not followed up chip; its count is checked
    // against the cards of its follow-up chip lists below.
    const followed = (FOLLOW_STAGES as readonly string[]).includes(s)
    console.log(`  ${s.padEnd(10)} chip ${shown}${followed ? '' : ` · list ${c.total} · cards ${c.cards}`}`)
    if (!followed) mism.push(...compare([[`${s}: chip = list`, shown, c.total], [`${s}: list = cards`, c.total, c.cards]]))
    if (s !== REUPLOADED) sum += shown
  }
  mism.push(...compare([['stages add up to All (chips)', all.total, sum]]))

  // Follow-up rows.
  const fuOf: Record<string, number> = {}
  for (const st of FOLLOW_STAGES) {
    const base = await chip({ stage: st, fu: 'not' })
    const fuCounts = base.first.rowCounts.fus ?? {}
    const stageTotal = stageCounts[st] ?? 0
    let fuSum = 0
    let fuCards = 0
    const line: string[] = []
    for (const b of [...FU_BUCKETS, ...(st === 'approved' ? [FU_TRIED] : [])]) {
      const c = await chip({ stage: st, fu: b })
      const shown = fuCounts[b] ?? 0
      line.push(`${b} ${shown}`)
      mism.push(...compare([[`${st}/${b}: chip = list`, shown, c.total], [`${st}/${b}: list = cards`, c.total, c.cards]]))
      if (b !== FU_TRIED) {
        fuSum += shown
        fuCards += c.cards
      }
      fuOf[`${st}/${b}`] = shown
    }
    console.log(`  ${st.padEnd(10)} ${line.join(' · ')}  (stage ${stageTotal})`)
    mism.push(...compare([[`${st}: follow-up chips add up to the stage`, stageTotal, fuSum], [`${st}: stage chip = cards of its follow-up lists`, stageTotal, fuCards]]))
  }
  mism.push(...compare([['Tried to pay ⊆ Not followed up', 1, (fuOf[`approved/${FU_TRIED}`] ?? 0) <= (fuOf['approved/not'] ?? 0) ? 1 : 0]]))

  // Not interested / Deleted / staff & test — counted separately.
  const ni = rows.filter((r) => r.tags.excluded === false && r.tags.ni === true).length
  const del = rows.filter((r) => r.tags.deleted === true).length
  const hidden = rows.filter((r) => r.tags.excluded !== false && r.tags.deleted !== true).length
  console.log(`\nNot interested: ${ni} · Deleted: ${del} · staff & test: ${hidden}`)

  // Badge and Overview.
  const { data: sums } = await admin.from('admin_summary').select('key, payload').in('key', ['badges', 'overview:7'])
  const badges = (sums?.find((r) => r.key === 'badges')?.payload ?? {}) as { peopleWaiting?: number; pipelineDue?: number }
  const ov = (sums?.find((r) => r.key === 'overview:7')?.payload ?? {}) as Record<string, { count?: number } | undefined>
  const feePending = feePendingFromRows(rows)
  const rejUninf = rejectedUninformedFromRows(rows)
  console.log(`\nBadge: documents waiting ${badges.peopleWaiting} + fee pending · due ${badges.pipelineDue} = ${(badges.peopleWaiting ?? 0) + (badges.pipelineDue ?? 0)}`)
  console.log(`Overview: fee pending ${ov['todo-fee-pending']?.count ?? 0} · rejected not informed ${ov['todo-rejected-uninformed']?.count ?? 0} · documents to approve ${ov['todo-docs']?.count ?? 0}`)
  mism.push(
    ...compare([
      ['badge fee-pending part = Approved · Not followed up chip', fuOf['approved/not'] ?? 0, badges.pipelineDue],
      ['badge fee-pending part = cards due', feePending, badges.pipelineDue],
      ['Overview fee pending = the chip', fuOf['approved/not'] ?? 0, ov['todo-fee-pending']?.count ?? 0],
      ['Overview rejected not informed = cards', rejUninf, ov['todo-rejected-uninformed']?.count ?? 0],
    ]),
  )

  console.log(mism.length ? `\n${mism.length} MISMATCH(ES):` : '\nAll checks pass.')
  for (const m of mism) console.log(`  ✗ ${m.check}: expected ${m.expected}, got ${m.got}`)
  if (mism.length) process.exitCode = 1
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : 'failed')
  process.exit(1)
})
