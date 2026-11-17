/**
 * scripts/report-pr02-live.ts — READ-ONLY check (PR-02, 16 Nov 2026): has the
 * deployed summary job written the new card field `enteredAt`? Prints how many
 * stored People tutor cards carry it. Counts only. Writes nothing.
 *   npx tsx --env-file=.env.local scripts/report-pr02-live.ts
 */
import { createClient } from '@supabase/supabase-js'

async function main() {
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
  let total = 0
  let withField = 0
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin.from('admin_list_rows').select('row').eq('list', 'people:tutor').order('member_id').range(from, from + 999)
    if (error) throw new Error(error.message)
    for (const r of data ?? []) {
      total++
      const pipe = (r.row as { pipe?: Record<string, unknown> } | null)?.pipe
      if (pipe && 'enteredAt' in pipe) withField++
    }
    if (!data || data.length < 1000) break
  }
  console.log(`cards ${total} · with enteredAt ${withField}`)
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : 'failed')
  process.exit(1)
})
