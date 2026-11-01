/**
 * scripts/run-admin-summary.ts — runs one admin summary rebuild (owner, 1 Nov
 * 2026; lib/adminSummary). Writes only admin_summary and admin_list_rows — the
 * figures the cron writes every few minutes. Prints the time and any failed part.
 *
 *   npx tsx --conditions=react-server --env-file=.env.local scripts/run-admin-summary.ts [--force]
 */
import { rebuildAdminSummary } from '../lib/adminSummary'

rebuildAdminSummary({ force: process.argv.includes('--force') })
  .then((r) => {
    console.log(JSON.stringify(r))
    process.exit(r.failed.length ? 1 : 0)
  })
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e)
    process.exit(1)
  })
