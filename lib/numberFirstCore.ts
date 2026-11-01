// lib/numberFirstCore.ts
//
// "Number first" on staff Post a tuition (owner, 31 Oct 2026) — the PURE half
// (scripts/test-number-first.ts). Step one of the staff form is only the
// parent's phone number. The server checks it before the rest of the form
// opens, and the answer is exactly one of five outcomes, in this order:
//
//   1. Do not use list  → refused, the form stays closed.
//   2. On hold          → refused, the form stays closed.
//   3. On an open or paused tuition → list each; "Open it" / "Continue anyway".
//   4. A parent account → "This parent has an account (<name>)."; the new
//      tuition is linked to it.
//   5. Clear            → the rest of the form opens.
//
// 3 and 4 can both be true: the existing tuitions are listed AND the parent
// account is named, and continuing links the tuition to that account.
// Numbers are only ever shown masked (lib/contactWithdrawCore maskNumber), and
// a blocked attempt is audited without the number.

// Browser-safe: no node:crypto here (the step-one screen imports this file).
import { maskPhoneDisplay } from '@/lib/contactMaskCore'

export function maskNumber(msisdn: string): string {
  return maskPhoneDisplay(msisdn) ?? '•••'
}

export const NUMBER_FIRST_DNU = "This number has asked not to be contacted. Please don't post it."
export const NUMBER_FIRST_HOLD = 'This number has a complaint on file. Please check with the owner first.'

export type ExistingTuition = {
  id: string
  ref: string | null
  title: string
  city: string | null
  status: string
  postedAt: string
  poster: string
  href: string
}

export type ParentAccount = { id: string; name: string }

export type NumberFirstOutcome =
  | { kind: 'do_not_use'; masked: string; message: string }
  | { kind: 'on_hold'; masked: string; message: string }
  | { kind: 'existing'; masked: string; tuitions: ExistingTuition[]; parent: ParentAccount | null }
  | { kind: 'parent_account'; masked: string; parent: ParentAccount }
  | { kind: 'clear'; masked: string }

export function numberFirstOutcome(input: {
  msisdn: string
  doNotUse: boolean
  onHold: boolean
  tuitions: ExistingTuition[]
  parent: ParentAccount | null
}): NumberFirstOutcome {
  const masked = maskNumber(input.msisdn)
  if (input.doNotUse) return { kind: 'do_not_use', masked, message: NUMBER_FIRST_DNU }
  if (input.onHold) return { kind: 'on_hold', masked, message: NUMBER_FIRST_HOLD }
  if (input.tuitions.length > 0) return { kind: 'existing', masked, tuitions: input.tuitions, parent: input.parent }
  if (input.parent) return { kind: 'parent_account', masked, parent: input.parent }
  return { kind: 'clear', masked }
}

/** Does this outcome let the rest of the form open (after "Continue anyway"
 *  for an existing tuition)? */
export function formMayOpen(o: NumberFirstOutcome, continuedAnyway: boolean): boolean {
  if (o.kind === 'do_not_use' || o.kind === 'on_hold') return false
  if (o.kind === 'existing') return continuedAnyway
  return true
}

/** The parent account the new tuition is linked to, if any. */
export function linkedParent(o: NumberFirstOutcome): ParentAccount | null {
  if (o.kind === 'parent_account') return o.parent
  if (o.kind === 'existing') return o.parent
  return null
}

/** The last ten digits — what every stored shape of a Pakistani mobile ends with. */
export function lastTen(msisdn: string): string {
  return msisdn.replace(/\D/g, '').slice(-10)
}

/** Only open and paused tuitions count as "already on a tuition". */
export function countsAsLive(status: string | null | undefined): boolean {
  return status === 'open' || status === 'paused'
}

/** A parent account, not a tutor, staff, team or test account. */
export function isParentAccount(p: { role?: string | null; is_team_account?: boolean | null; is_test_name?: boolean | null; hidden_from_public?: boolean | null; merged_into?: string | null }): boolean {
  return (p.role === 'parent' || p.role === 'academy') && !p.is_team_account && !p.is_test_name && !p.hidden_from_public && !p.merged_into
}
