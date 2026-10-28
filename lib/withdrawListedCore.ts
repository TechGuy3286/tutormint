// lib/withdrawListedCore.ts
//
// PURE, client-safe. Trust → Withdraw a contact (owner, 28 Oct 2026): when the
// searched number is already on the Do not use list, neither action is offered
// ("Pause all their tuitions", "Remove number permanently") — the number has
// already been withdrawn. The page says when and by whom instead, and keeps the
// Owner's "Remove from Do not use list" (password + reason). Never the number.

export type ListedEntry = { id: string; addedAt: string; addedByName: string | null }

export type WithdrawActionsView =
  | { showActions: true; banner: null }
  | { showActions: false; banner: string; removeId: string }

/** "28 Oct 2026", in Pakistan time. */
export function pkDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Karachi' })
}

export function withdrawActionsView(listed: ListedEntry | null | undefined): WithdrawActionsView {
  if (!listed) return { showActions: true, banner: null }
  return {
    showActions: false,
    banner: `Already withdrawn on ${pkDate(listed.addedAt)} by ${(listed.addedByName ?? '').trim() || 'the Owner'}`,
    removeId: listed.id,
  }
}
