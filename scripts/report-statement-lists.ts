/**
 * scripts/report-statement-lists.ts — PR-04. READ ONLY: the Finance → Import
 * bank statement list counts, worked out exactly as the page does but with no
 * automatic link and nothing stored. Counts only — no names, numbers or
 * references. Also the number of members with an erase requested.
 *   npx tsx --conditions=react-server --env-file=.env.local scripts/report-statement-lists.ts
 */
import { statementListCounts } from '../lib/bankStatement'
import { createAdminClient } from '../lib/supabase/admin'

async function main() {
  const counts = await statementListCounts()
  console.log('statement lists:', JSON.stringify(counts))
  const admin = createAdminClient()
  if (admin) {
    const { count } = await admin.from('account_erasures').select('id', { count: 'exact', head: true }).eq('status', 'scheduled')
    console.log('erase requested (scheduled):', count ?? 0)
  }
}
void main().then(() => process.exit(0))
