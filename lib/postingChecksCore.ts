// lib/postingChecksCore.ts — PURE rules for the contact checks on every staff
// tuition post (owner, 23 Nov 2026 — PR-18 Part A.3). Browser-safe (the form
// shows the same answers before Post is enabled); the server re-runs them in
// createTeamJob / updateTeamJob (lib/postingChecks.ts) — the form is a hint,
// the server is the rule. Unit tests: scripts/test-pr18.ts.
//
//   a. Withdrawn contact (the "Withdraw a contact" / Do not use list), any
//      format of the number → BLOCKED.
//   b. The number of an erased member (PR-11 HMAC fingerprint) → BLOCKED the
//      same way.
//      (A number "on hold" after a complaint stays blocked as before.)
//      Only the Owner can post a blocked number, with a reason that is logged.
//   c. The same number with an overlapping grade or subject, open or paused,
//      posted in the last 30 days → a WARNING: "This looks like a tuition
//      already posted: <link>"; Post needs the tick "This is a different
//      tuition".
// Numbers are never returned to the browser; a repeat is named by its TM
// number, title and link.

export const CONTACT_BLOCKED_MESSAGE = "This parent asked not to be contacted. It can't be posted."
export const ON_HOLD_MESSAGE = 'This number has a complaint on file. Please check with the owner first.'
export const REPEAT_LINE = 'This looks like a tuition already posted:'
export const DIFFERENT_TICK = 'This is a different tuition'
export const OVERRIDE_REASON_MIN = 5
export const OVERRIDE_REASON_PROBLEM = 'Give a reason for posting this number (at least 5 characters). It is logged.'
export const OWNER_ONLY_OVERRIDE = 'Only the Owner can post this number.'
export const REPEAT_WINDOW_DAYS = 30

export type BlockKind = 'withdrawn' | 'erased' | 'on_hold'
export type ContactBlock = { kind: BlockKind; message: string }

export type RepeatHit = { id: string; ref: string | null; title: string; status: string; postedAt: string; href: string }

export type ContactCheckResult = {
  block: ContactBlock | null
  repeats: RepeatHit[]
  /** The Owner may post a blocked number with a logged reason. */
  ownerMayOverride: boolean
}

/** The one block for a set of facts: withdrawn wins, then erased, then a hold. */
export function blockFor(f: { withdrawn: boolean; erased: boolean; onHold: boolean }): ContactBlock | null {
  if (f.withdrawn) return { kind: 'withdrawn', message: CONTACT_BLOCKED_MESSAGE }
  if (f.erased) return { kind: 'erased', message: CONTACT_BLOCKED_MESSAGE }
  if (f.onHold) return { kind: 'on_hold', message: ON_HOLD_MESSAGE }
  return null
}

const lc = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim()

/** Grades overlap, or subjects overlap (either is enough — "overlapping
 *  grade/subject"). A side with neither never overlaps. */
export function overlaps(a: { levels: string[]; masterIds: number[] }, b: { levels: string[]; masterIds: number[] }): boolean {
  const la = new Set(a.levels.map(lc).filter(Boolean))
  if (b.levels.some((l) => la.has(lc(l)))) return true
  const ma = new Set(a.masterIds)
  return b.masterIds.some((m) => ma.has(m))
}

export type RepeatCandidate = RepeatHit & { levels: string[]; masterIds: number[] }

/** The open/paused tuitions with the same number that this post repeats,
 *  newest first. The caller has already matched the number. */
export function repeatsFor(
  me: { levels: string[]; masterIds: number[] },
  rows: RepeatCandidate[],
  nowMs: number,
  excludeId: string | null = null,
): RepeatHit[] {
  const from = nowMs - REPEAT_WINDOW_DAYS * 86_400_000
  return rows
    .filter((r) => r.id !== excludeId && (r.status === 'open' || r.status === 'paused'))
    .filter((r) => {
      const t = Date.parse(r.postedAt)
      return Number.isFinite(t) && t >= from
    })
    .filter((r) => overlaps(me, r))
    .sort((x, y) => y.postedAt.localeCompare(x.postedAt))
    .map(({ id, ref, title, status, postedAt, href }) => ({ id, ref, title, status, postedAt, href }))
}

export type PostDecision =
  | { ok: true; override: BlockKind | null }
  | { ok: false; status: number; code: 'contact_blocked' | 'owner_only' | 'override_reason' | 'repeat'; error: string }

/**
 * Whether a post may go ahead after the checks. A block needs the Owner and a
 * reason; a repeat needs the tick. The server calls this with the real role.
 */
export function postDecision(a: {
  result: Pick<ContactCheckResult, 'block' | 'repeats'>
  isOwner: boolean
  overrideReason: string | null | undefined
  confirmedDifferent: boolean
}): PostDecision {
  let override: BlockKind | null = null
  if (a.result.block) {
    const reason = (a.overrideReason ?? '').trim()
    if (!reason) return { ok: false, status: 400, code: 'contact_blocked', error: a.result.block.message }
    if (!a.isOwner) return { ok: false, status: 403, code: 'owner_only', error: OWNER_ONLY_OVERRIDE }
    if (reason.length < OVERRIDE_REASON_MIN) return { ok: false, status: 400, code: 'override_reason', error: OVERRIDE_REASON_PROBLEM }
    override = a.result.block.kind
  }
  if (a.result.repeats.length > 0 && !a.confirmedDifferent) {
    return { ok: false, status: 409, code: 'repeat', error: `${REPEAT_LINE} ${a.result.repeats[0].ref ?? a.result.repeats[0].title}. Tick "${DIFFERENT_TICK}" to post it.` }
  }
  return { ok: true, override }
}

/** May the Post button be pressed, given the latest check in the form? */
export function postEnabled(a: { result: ContactCheckResult | null; checking: boolean; overrideReason: string; confirmedDifferent: boolean }): boolean {
  if (a.checking || !a.result) return false
  if (a.result.block && !(a.result.ownerMayOverride && a.overrideReason.trim().length >= OVERRIDE_REASON_MIN)) return false
  if (a.result.repeats.length > 0 && !a.confirmedDifferent) return false
  return true
}
