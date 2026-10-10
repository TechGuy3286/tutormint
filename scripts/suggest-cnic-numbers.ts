/**
 * scripts/suggest-cnic-numbers.ts  (owner, 10 Oct 2026)
 *
 * The backlog run of the CNIC reader. For every member in the approval queue
 * who has a CNIC FRONT on file and NO CNIC number, read the number from the
 * photo and print: name · suggested number (masked to the last 4 digits) ·
 * found / not found.
 *
 * READ-ONLY for members' data: it changes no profile, no status, no file. The
 * one thing stored is each result as the document's SUGGESTED value
 * (user_documents.cnic_read_*), which the review card pre-fills for staff to
 * check and save. It is never saved as the confirmed number.
 *
 * The Claude API key lives only in production, so the read itself runs there:
 * this script picks the documents and calls the CRON_SECRET-protected
 * /api/internal/suggest-cnic-numbers once per document. One read per image —
 * a second run returns the cached results and calls the API for nothing new.
 * The full number never reaches this console.
 *
 *   npx tsx --conditions=react-server --env-file=.env.local scripts/suggest-cnic-numbers.ts          # list only
 *   npx tsx --conditions=react-server --env-file=.env.local scripts/suggest-cnic-numbers.ts --run    # read
 */
// @ts-expect-error pg ships no bundled types
import pg from 'pg'
import { approvalNeeded } from '../lib/approvalQueue'
import { isValidCnic } from '../lib/cnic'
import { pickCnicFront, type CnicDocRow } from '../lib/cnicReaderCore'

const SITE = process.env.SUGGEST_SITE_URL || 'https://www.tutormint.org'

async function main() {
  const run = process.argv.includes('--run')
  const secret = process.env.CRON_SECRET
  if (run && !secret) throw new Error('CRON_SECRET is not set (needed to call the production route).')

  // Default: the approval queue (the owner's instruction). --all widens it to
  // every tutor and parent with a CNIC front and no number; pair it with --run
  // only on the owner's say-so (each read is a billable call).
  const all = process.argv.includes('--all')
  let queue: { id: string; name: string; kind: string }[] = await approvalNeeded()
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  if (all) {
    const { rows } = await c.query(
      `select p.id, coalesce(p.full_name, '(no name)') as name, p.role as kind from profiles p
        where p.role in ('tutor', 'parent') and coalesce(p.is_seed, false) = false and coalesce(p.is_banned, false) = false
          and exists (select 1 from user_documents d where d.user_id = p.id and d.kind = 'cnic')`,
    )
    queue = rows
  }
  const ids = queue.map((r) => r.id)
  const { rows: profiles } = await c.query(`select id, cnic_number from profiles where id = any($1::uuid[])`, [ids])
  const { rows: docs } = await c.query(
    `select id, user_id, kind, label, status, created_at::text as created_at, cnic_read_status
       from user_documents where kind = 'cnic' and user_id = any($1::uuid[])`,
    [ids],
  )
  await c.end()

  const numberOf = new Map<string, string | null>(profiles.map((p: { id: string; cnic_number: string | null }) => [p.id, p.cnic_number]))
  type Doc = CnicDocRow & { user_id: string }
  const todo: { name: string; kind: string; documentId: string }[] = []
  let hasNumber = 0
  let noFront = 0
  for (const row of queue) {
    if (isValidCnic(numberOf.get(row.id))) {
      hasNumber++
      continue
    }
    const front = pickCnicFront((docs as Doc[]).filter((d) => d.user_id === row.id))
    if (!front) {
      noFront++
      continue
    }
    todo.push({ name: row.name, kind: row.kind, documentId: front.id })
  }
  console.log(`${all ? 'all members with a CNIC upload' : 'approval queue'}: ${queue.length} members · already have a number: ${hasNumber} · no CNIC front: ${noFront} · to read: ${todo.length}`)

  if (!run) {
    for (const t of todo) console.log(`  would read: ${t.name} (${t.kind})`)
    console.log('List only. Add --run to read.')
    return
  }

  let found = 0
  let notFound = 0
  let failed = 0
  for (const t of todo) {
    let line = 'failed (not stored; can be run again)'
    try {
      const res = await fetch(`${SITE}/api/internal/suggest-cnic-numbers`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${secret}` },
        body: JSON.stringify({ documentId: t.documentId }),
      })
      const data = (await res.json().catch(() => null)) as { status?: string; masked?: string | null; cached?: boolean } | null
      if (res.ok && data?.status === 'found') {
        found++
        line = `found · ${data.masked}${data.cached ? ' (already read)' : ''}`
      } else if (res.ok && data?.status === 'none') {
        notFound++
        line = `not found${data.cached ? ' (already read)' : ''}`
      } else {
        failed++
        line = `failed: HTTP ${res.status} ${data?.status ?? ''} (not stored; can be run again)`
      }
    } catch (e) {
      failed++
      line = `failed: ${e instanceof Error ? e.message : 'request error'}`
    }
    console.log(`  ${t.name} (${t.kind}) · ${line}`)
  }
  console.log(`read: ${todo.length} · found: ${found} · not found: ${notFound} · failed: ${failed}`)
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
