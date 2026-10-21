/**
 * scripts/test-follow-ups-flags-live.ts — npm run test:followupflags:live
 *
 * LIVE, read-only (owner, 21 Oct 2026). Part D's account flags hold against
 * the database, judged by the People page's one rule (excludedReason):
 *   • Javeria Fiaz's tutor account is not a test account — it shows and counts;
 *   • Aqsa Mughal's second tutor account (no payment) is hidden as a test
 *     account, and the one with the approved Verification Fee is not.
 * Skips without SUPABASE_DB_URL. Prints no mobile, email or CNIC number.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

import { excludedReason } from '../lib/peopleDirectoryCore'

const JAVERIA_TUTOR = 'c656ab23-8de7-4ab0-8d14-1ee843b28294'
const AQSA_TEST = '532e5da5-6780-45d7-89d6-3fdabde3574c'
const AQSA_REAL = 'd5c10c45-0efd-473b-a5f5-5863c2868485'

const url = process.env.SUPABASE_DB_URL

test('Javeria shows; Aqsa\'s second account is hidden', { skip: !url && 'SUPABASE_DB_URL not set' }, async () => {
  const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
  await c.connect()
  try {
    const rows = (
      await c.query(
        `select id, role::text role, is_seed, is_team_account, is_test_name, hidden_from_public from profiles where id = any($1)`,
        [[JAVERIA_TUTOR, AQSA_TEST, AQSA_REAL]],
      )
    ).rows as Record<string, unknown>[]
    const reason = (id: string) => {
      const p = rows.find((r) => r.id === id)
      assert.ok(p, `account ${id} missing`)
      return excludedReason({
        role: p!.role as string,
        isSeed: p!.is_seed as boolean,
        isTeam: p!.is_team_account as boolean,
        isTestName: p!.is_test_name as boolean,
        hidden: p!.hidden_from_public as boolean,
        // None of the three shares an email or mobile with a staff account
        // (scripts/report-followups-pr-accounts.ts).
        staffLinked: false,
      })
    }
    assert.equal(reason(JAVERIA_TUTOR), null, 'Javeria Fiaz should count as a normal tutor')
    assert.equal(reason(AQSA_TEST), 'test', "Aqsa's second account should be a test account")
    assert.equal(reason(AQSA_REAL), null, "Aqsa's paid account should count")
  } finally {
    await c.end()
  }
})
