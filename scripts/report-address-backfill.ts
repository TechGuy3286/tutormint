/**
 * scripts/report-address-backfill.ts — READ-ONLY (PR-07). Counts only, never an
 * address, name, phone or CNIC: members with an approved CNIC whose back image
 * is on record and no home address; how many back images were read; how many
 * address suggestions exist, by status and source.
 *   npx tsx --env-file=.env.local scripts/report-address-backfill.ts
 */
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

async function main() {
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  try {
    await c.query('set transaction read only').catch(() => {})
    const one = async (sql: string) => Number((await c.query(sql)).rows[0].n)
    const candidates = await one(`
      select count(distinct p.id)::int n
        from profiles p
        join user_documents d on d.user_id = p.id and d.kind = 'cnic' and d.label = 'back' and coalesce(d.status, 'active') = 'active'
       where p.role in ('tutor', 'parent', 'academy')
         and p.cnic_verified_at is not null
         and nullif(btrim(coalesce(p.address, '')), '') is null
         and p.erased_at is null`)
    let read = 0
    let byStatus: { status: string; source: string; n: number }[] = []
    try {
      read = await one(`select count(*)::int n from user_documents where address_read_at is not null`)
      byStatus = (await c.query(`select status, source, count(*)::int n from address_suggestions group by 1, 2 order by 1, 2`)).rows
    } catch {
      console.log('(migration 236 not applied yet)')
    }
    console.log(`approved CNIC back on record, no address: ${candidates}`)
    console.log(`CNIC back images read for an address: ${read}`)
    console.log(`address suggestions: ${byStatus.length ? byStatus.map((r) => `${r.status}/${r.source} ${r.n}`).join(' · ') : 'none'}`)
  } finally {
    await c.end()
  }
}

void main()
