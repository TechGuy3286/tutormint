// lib/notify/tuitionEmailCore.ts — PURE (owner, 27 Oct 2026).
//
// No wasted tuition emails. On 26–27 Oct 2026 every one of the 130 "tuition
// paused" emails went to the team account (jobs@tutormint.org) behind the
// staff-posted tuitions. A tuition email — paused, expired, resumed, matching —
// is never sent to:
//   • the team account (staff-posted tuitions have no parent account);
//   • a staff account (role admin);
//   • a test, seed or hidden account;
//   • a placeholder @users.tutormint.org address (no mailbox).
// Applied in lib/notify prepareEmail, the one place every email passes, so a
// sender written later cannot forget it. Unit-tested in scripts/test-fee-match.ts.

/** The tuition emails: every template whose id starts tuition_. */
export function isTuitionEmail(templateId: string): boolean {
  return templateId.startsWith('tuition_')
}

export type RecipientFlags = {
  email: string | null
  role: string | null
  is_team_account?: boolean | null
  is_test_name?: boolean | null
  hidden_from_public?: boolean | null
  is_seed?: boolean | null
}

const PLACEHOLDER = /@users\.tutormint\.org$/i

/** Why this tuition email must not go to this account, or null when it may. */
export function tuitionEmailBlock(templateId: string, p: RecipientFlags): string | null {
  if (!isTuitionEmail(templateId)) return null
  if (p.is_team_account) return 'team account (staff-posted tuition, no parent account)'
  if (p.role === 'admin') return 'staff account'
  if (p.is_test_name || p.hidden_from_public || p.is_seed) return 'test account'
  if (p.email && PLACEHOLDER.test(p.email)) return 'placeholder address, no mailbox'
  return null
}
