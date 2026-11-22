import HeaderSessionSeed from '@/components/session/HeaderSessionSeed'
import { loadHeaderSession } from '@/lib/headerSession'

// Server half of the hand-over (PR-16). ONLY for layouts that are already
// rendered per request (dashboards, onboarding, pay, account, messages) — it
// reads the session cookie, so a public, cached page must never render it
// (scripts/test-pr16.ts scans for that).
export default async function SignedInHeader() {
  const session = await loadHeaderSession().catch(() => null)
  return <HeaderSessionSeed session={session} />
}
