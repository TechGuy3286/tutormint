// The ONE rule for who may be served a stored document through the preview
// route (PR106-C §1.2), kept pure so it is unit-tested and cannot drift.
//
// HARD RULE: a selfie or CNIC image is NEVER served to a third party. Only the
// OWNER (their own document, e.g. in Settings) or an ADMIN (staff review) may
// see one. A degree certificate is the one kind widened to any signed-in user,
// so a parent can see a tutor's qualifications. Anything else is private by
// default (owner/admin only) — a kind added later is never public by accident.
//
// This is enforced at the document route, independent of what any profile row
// or degree entry points at: even if something linked a public surface to a
// cnic/selfie id, a non-owner non-admin viewer is refused here.

export type DocumentKind = 'cnic' | 'degree' | 'selfie' | string

export function documentServable(
  kind: DocumentKind,
  ctx: { isOwner: boolean; isAdmin: boolean },
): boolean {
  if (ctx.isAdmin) return true // staff review every kind
  if (kind === 'degree') return true // qualifications are shown to any signed-in viewer
  // cnic / selfie / any other private kind: the owner's own document only.
  return ctx.isOwner
}
