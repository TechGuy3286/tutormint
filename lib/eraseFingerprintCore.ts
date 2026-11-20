// lib/eraseFingerprintCore.ts
//
// Re-sign-up block for erased members (owner, 20 Nov 2026 — PR-11) — the PURE
// half. When an erase runs, each mobile number (normalised to 92XXXXXXXXXX) and
// the CNIC number (13 digits) of the member is turned into a KEYED one-way
// fingerprint: HMAC-SHA256 with a server-only secret (ERASE_FINGERPRINT_SECRET).
// A plain hash is not enough — there are only about a billion Pakistani mobile
// numbers, so an unkeyed SHA-256 of one can be reversed by trying them all.
// Only the fingerprint, its kind, the erase date and the erased account id are
// stored; never the number. The I/O is lib/eraseFingerprint.ts.

import { createHmac } from 'node:crypto'

import { normalisePkMobile } from '@/lib/phone'

/** The env var holding the HMAC key. Vercel only; never printed or logged. */
export const FINGERPRINT_ENV = 'ERASE_FINGERPRINT_SECRET'

/** A key shorter than this is treated as missing (a typo is not a key). */
export const MIN_SECRET_LENGTH = 16

export type FingerprintKind = 'mobile' | 'cnic'
export type BlockStep = 'signup' | 'verify' | 'cnic'

/** The value that is fingerprinted, or null when the input is not one. */
export function normaliseForFingerprint(kind: FingerprintKind, raw: string | null | undefined): string | null {
  if (!raw) return null
  if (kind === 'mobile') return normalisePkMobile(raw)
  const digits = String(raw).replace(/\D/g, '')
  return /^\d{13}$/.test(digits) ? digits : null
}

/** A usable key, or null. */
export function usableSecret(raw: string | null | undefined): string | null {
  const s = (raw ?? '').trim()
  return s.length >= MIN_SECRET_LENGTH ? s : null
}

/**
 * HMAC-SHA256(secret, "<kind>:<normalised value>") as 64 lowercase hex
 * characters. The kind is part of the message so a mobile and a CNIC that
 * happened to share digits can never collide. Null when the input does not
 * normalise or there is no key.
 */
export function fingerprint(kind: FingerprintKind, raw: string | null | undefined, secret: string | null | undefined): string | null {
  const key = usableSecret(secret)
  const value = normaliseForFingerprint(kind, raw)
  if (!key || !value) return null
  return createHmac('sha256', key).update(`${kind}:${value}`).digest('hex')
}

/** Every distinct fingerprint of an account's numbers (all its mobiles + CNIC). */
export function accountFingerprints(
  numbers: { mobiles: (string | null | undefined)[]; cnic: string | null | undefined },
  secret: string | null | undefined,
): { kind: FingerprintKind; fingerprint: string }[] {
  const out = new Map<string, { kind: FingerprintKind; fingerprint: string }>()
  for (const m of numbers.mobiles) {
    const f = fingerprint('mobile', m, secret)
    if (f) out.set(`mobile:${f}`, { kind: 'mobile', fingerprint: f })
  }
  const c = fingerprint('cnic', numbers.cnic, secret)
  if (c) out.set(`cnic:${c}`, { kind: 'cnic', fingerprint: c })
  return [...out.values()]
}

/** The last two digits of what was entered — all the Owner's list ever shows. */
export function lastTwo(kind: FingerprintKind, raw: string | null | undefined): string {
  const v = normaliseForFingerprint(kind, raw) ?? String(raw ?? '').replace(/\D/g, '')
  return v.length >= 2 ? v.slice(-2) : '00'
}

/** "•••• •••42" — the masked form on the Owner's list. */
export function maskedLastTwo(last2: string): string {
  return `••••••${/^\d{2}$/.test(last2) ? last2 : '••'}`
}

/** What the person trying to sign up sees (plain English; support number from app_settings). */
export function blockedMessage(supportWhatsapp: string): string {
  return `This number belongs to a closed TutorMint account. Please contact support on WhatsApp ${supportWhatsapp}.`
}

export const KIND_LABEL: Record<FingerprintKind, string> = { mobile: 'Mobile', cnic: 'CNIC' }
export const STEP_LABEL: Record<BlockStep, string> = { signup: 'Sign-up', verify: 'Mobile verification', cnic: 'CNIC number' }

/** What the erase records when it could not fingerprint (no key). */
export function skippedNote(): string {
  return `not stored — ${FINGERPRINT_ENV} is not set`
}

/** The Owner's to-do: unreviewed attempts whose fingerprint is still blocked. */
export function todoCount(rows: { reviewedAt: string | null; allowed: boolean }[]): number {
  return rows.filter((r) => !r.reviewedAt && !r.allowed).length
}

// ------------------------------------------------- the block, as a store ---
// The decision is written once against this small interface: the database
// store (lib/eraseFingerprint.ts) and the tests' in-memory one both run it.

export type FingerprintRow = {
  id: string
  kind: FingerprintKind
  fingerprint: string
  memberId: string
  erasedAt: string
  allowedAt: string | null
}

export type BlockStore = {
  /** The newest row for this fingerprint that is still blocked (allowedAt null). */
  findBlocked(kind: FingerprintKind, fp: string): Promise<{ id: string; erasedAt: string } | null>
  /** Attempts for this fingerprint row since `sinceIso`. */
  recentAttempts(fingerprintId: string, sinceIso: string): Promise<number>
  addAttempt(a: { kind: FingerprintKind; step: BlockStep; last2: string; fingerprintId: string }): Promise<void>
  bellOwner(n: { title: string; body: string; href: string }): Promise<void>
  supportWhatsapp(): Promise<string>
}

export type BlockCheck = { blocked: false } | { blocked: true; message: string }

export const BLOCKED_SIGNUPS_HREF = '/admin/blocked-signups'
/** One bell per number per hour, however many times it is tried. */
export const BELL_EVERY_MS = 60 * 60 * 1000

/**
 * The check every sign-up step runs BEFORE any code is sent or anything is
 * saved. Fails open (no key / no match → not blocked). On a match: one attempt
 * row (last two digits only), the Owner's bell (once an hour per number), and
 * the message for the person.
 */
export async function runBlockCheck(
  store: BlockStore,
  args: { kind: FingerprintKind; raw: string | null | undefined; step: BlockStep; secret: string | null | undefined; nowMs: number },
): Promise<BlockCheck> {
  const fp = fingerprint(args.kind, args.raw, args.secret)
  if (!fp) return { blocked: false }
  const hit = await store.findBlocked(args.kind, fp)
  if (!hit) return { blocked: false }
  const recent = await store.recentAttempts(hit.id, new Date(args.nowMs - BELL_EVERY_MS).toISOString())
  await store.addAttempt({ kind: args.kind, step: args.step, last2: lastTwo(args.kind, args.raw), fingerprintId: hit.id })
  if (recent === 0) {
    await store.bellOwner({
      title: `Blocked re-sign-up: ${KIND_LABEL[args.kind]} of a closed account`,
      body: `${STEP_LABEL[args.step]} was refused. Open the list to allow it if this is a mistake.`,
      href: BLOCKED_SIGNUPS_HREF,
    })
  }
  return { blocked: true, message: blockedMessage(await store.supportWhatsapp()) }
}

/** Allow: every row of the same number (on any erased account) stops blocking. */
export function applyAllow(rows: FingerprintRow[], ids: string[], atIso: string): FingerprintRow[] {
  return rows.map((r) => (ids.includes(r.id) && !r.allowedAt ? { ...r, allowedAt: atIso } : r))
}

/** Undo an Allow: blocked again. */
export function applyUndoAllow(rows: FingerprintRow[], ids: string[]): FingerprintRow[] {
  return rows.map((r) => (ids.includes(r.id) ? { ...r, allowedAt: null } : r))
}

/** The rows that carry the same number as `id` (Allow and Undo act on all of them). */
export function siblingIds(rows: FingerprintRow[], id: string): string[] {
  const one = rows.find((r) => r.id === id)
  return one ? rows.filter((r) => r.kind === one.kind && r.fingerprint === one.fingerprint).map((r) => r.id) : []
}
