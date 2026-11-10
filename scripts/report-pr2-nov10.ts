/**
 * scripts/report-pr2-nov10.ts — READ ONLY. The numbers of PR 2 (10 Nov 2026)
 * from the stored admin summary: the Applications badge, the People → Paid
 * Plan counts, "Upgrades ending in 7 days" and whether the Overview Paid card
 * equals the paid sign-ups view. Counts only — no names, phones or emails.
 *   npx tsx --env-file=.env.local scripts/report-pr2-nov10.ts
 */
import { createClient } from '@supabase/supabase-js'
import { paidCardCounts, type PaidSignup } from '../lib/paidSignupsCore'

async function main() {
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL as string, process.env.SUPABASE_SERVICE_ROLE_KEY as string, { auth: { persistSession: false } })
  const { data: sum } = await db.from('admin_summary').select('key, payload, computed_at').in('key', ['badges', 'overview:7', 'paidsignups', 'state'])
  const get = (k: string) => sum?.find((r) => r.key === k)
  const state = get('state')?.payload as { builtAt?: string; failed?: string[] } | undefined
  console.log('summary built at:', state?.builtAt ?? '—', '· failed parts:', state?.failed?.length ?? 0)
  const badges = get('badges')?.payload as { appsNew?: { total: number } } | undefined
  console.log('Applications badge (Owner view, unseen in the last 7 days):', badges?.appsNew?.total ?? '—')

  const tags: string[] = []
  for (let from = 0; ; from += 1000) {
    const { data } = await db.from('admin_list_rows').select('tags').eq('list', 'people:tutor').contains('tags', { stage: 'paid', excluded: false, ni: false }).range(from, from + 999)
    for (const r of data ?? []) tags.push(String((r.tags as Record<string, unknown>).plan ?? 'missing'))
    if (!data || data.length < 1000) break
  }
  const count = (v: string) => tags.filter((t) => t === v).length
  console.log(`Plan filter — All paid ${tags.length} · Verified ${count('verified')} · Premium ${count('premium')} · Featured ${count('featured')}${count('missing') ? ` · not tagged yet ${count('missing')}` : ''}`)

  const ov = get('overview:7')?.payload as Record<string, { count: number; card?: { today: string; yesterday: string; last7: string; bottom?: { label: string; value: string } } | null }> | undefined
  console.log('Upgrades ending in 7 days:', ov?.['todo-upgrades-ending']?.count ?? 'not written yet')
  const card = ov?.['paid-today']?.card
  const rows = ((get('paidsignups')?.payload as { rows?: PaidSignup[] } | undefined)?.rows ?? []) as PaidSignup[]
  const builtMs = Date.parse(get('overview:7')?.computed_at ?? '') || Date.now()
  const view = paidCardCounts(rows, builtMs)
  console.log('Paid card :', card ? `today ${card.today} · yesterday ${card.yesterday} · last 7 days ${card.last7} · ${card.bottom?.label} ${card.bottom?.value}` : '—')
  console.log('Paid view :', `today ${view.today} · yesterday ${view.yesterday} · last 7 days ${view.last7} · This month ${view.month}`)
  const same = !!card && card.today === String(view.today) && card.yesterday === String(view.yesterday) && card.last7 === String(view.last7) && card.bottom?.value === String(view.month)
  console.log('match:', same ? 'yes' : 'no')
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
