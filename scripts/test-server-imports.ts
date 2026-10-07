import assert from 'node:assert/strict'
import { test } from 'node:test'

import { findViolations } from './check-server-imports'

// Hotfix, 7 Oct 2026 — server code must never reach a browser-only ('use
// client') function module. Before the fix this found three routes:
// /api/profile/save, /api/tutor/onboarding, /api/tutor/tagline → lib/taxonomy
// → lib/supabase/clientLazy, which threw "Attempted to call getBrowserClient()
// from the server" on every subject save that changed subjects.

test('no server entry imports a browser-only module', () => {
  const bad = findViolations()
  assert.deepEqual(bad.map((b) => b.chain.join(' → ')), [])
})
