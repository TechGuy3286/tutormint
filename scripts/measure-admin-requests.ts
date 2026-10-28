/**
 * scripts/measure-admin-requests.ts — READ ONLY (owner, 28 Oct 2026).
 * How many HTTP requests (Supabase REST/RPC) each admin loader makes, and how
 * many of them run one after another. Prints counts per table/route only.
 *   PAGES=Follow-ups npx tsx --import ./scripts/stubs/guest-register.mjs --conditions=react-server --env-file=.env.local scripts/measure-admin-requests.ts
 */
import { loadTutorFollowUps } from '../lib/tutorFollowUps'
import { loadParentFollowUps } from '../lib/parentFollowUps'
import { loadDirectory } from '../lib/peopleDirectory'

const seen = new Map<string, number>()
const orig = globalThis.fetch
let inflight = 0
let maxInflight = 0
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const u = new URL(String(input instanceof Request ? input.url : input))
  const key = u.pathname.replace(/^\/rest\/v1\//, '').replace(/^\/auth\/v1\//, 'auth:')
  seen.set(key, (seen.get(key) ?? 0) + 1)
  inflight++
  maxInflight = Math.max(maxInflight, inflight)
  try {
    return await orig(input, init)
  } finally {
    inflight--
  }
}) as typeof fetch

async function main() {
  const pages: Record<string, () => Promise<unknown>> = {
    'Follow-ups tutors': () => loadTutorFollowUps('recent'),
    'Follow-ups parents': () => loadParentFollowUps(),
    People: () => loadDirectory(),
  }
  for (const [name, fn] of Object.entries(pages)) {
    if (process.env.PAGES && !process.env.PAGES.split(',').includes(name)) continue
    seen.clear()
    maxInflight = 0
    const t0 = performance.now()
    await fn()
    const total = [...seen.values()].reduce((a, b) => a + b, 0)
    console.log(`${name}: ${total} requests in ${Math.round(performance.now() - t0)} ms (max ${maxInflight} at once)`)
    for (const [k, n] of [...seen.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)) console.log(`   ${String(n).padStart(5)}  ${k}`)
  }
  process.exit(0)
}
void main()
