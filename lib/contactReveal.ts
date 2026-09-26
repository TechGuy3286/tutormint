// lib/contactReveal.ts
//
// A tutor revealing a parent's phone & email (PR56). Security first:
//
//   * The contact is NEVER in a page, prop, API response or log until a counted
//     reveal succeeds. This module is the only thing that reads a parent's
//     phone/email, always through the service role, and only after every check
//     passes.
//   * The count is atomic in the database (reveal_parent_contact locks the
//     counter row), so two taps or two tabs can never spend more than the cap or
//     reveal a 6th parent.
//   * A parent revealed once stays revealed for that tutor for good — re-opening
//     never uses another reveal and never re-counts.
//
// Basic: 5 NEW parents a month. Premium/Featured: unlimited (still logged).
// Unverified (no fee): the verify gate. Suspended on either side: nothing.
// Team account: never (it would expose the shared jobs@ mailbox).

import { createAdminClient } from '@/lib/supabase/admin'
import { getEntitlements, currentPeriod } from '@/lib/entitlements'
import { buildGate, type Gate } from '@/lib/gate'
import { normalisePkMobile } from '@/lib/phone'
import { loadJobContact } from '@/lib/jobContact'

export const CONTACT_REVEAL_CAP = 5
// Premium is counted at 120 a month (owner PR63 §A) — one shared allowance across
// parent accounts and staff-posted job contacts, exactly like Basic's 5. Featured
// stays unlimited; the RPC still logs its reveal, called with a cap that never
// refuses.
export const PREMIUM_CONTACT_CAP = 120
const UNLIMITED_CAP = 2_000_000_000

const CAP_FOR: Record<'basic' | 'premium' | 'featured', number> = {
  basic: CONTACT_REVEAL_CAP,
  premium: PREMIUM_CONTACT_CAP,
  featured: UNLIMITED_CAP,
}

/** The refusal when a tutor has spent this period's reveals. Basic → offer
 *  Premium (raises the cap to 120); Premium → offer Featured (unlimited). */
async function overCapResult(
  plan: 'basic' | 'premium' | 'featured',
  tutorId: string,
): Promise<RevealResult> {
  const ent = await getEntitlements(tutorId)
  if (plan === 'premium') {
    return {
      ok: false,
      status: 403,
      error: "You have used this month's 120 contact reveals.",
      gate: await buildGate('tutor_contact_cap', ent),
    }
  }
  return {
    ok: false,
    status: 403,
    error: "You have used this month's 5 contact reveals.",
    gate: await buildGate('tutor_contact', ent),
  }
}

export type RevealContact = {
  /** Mobile, canonical MSISDN (e.g. 923001234567), or null. Parent: verified
   *  mobile. Job contact: the number staff entered for the external parent. */
  phone: string | null
  /** A separate WhatsApp MSISDN (job contact only); parent reveals use `phone`. */
  whatsapp: string | null
  /** Email, or null. Parent: verified email only. Job contact: as entered. */
  email: string | null
  /** Job contact only — the external parent's name/address/social if entered. */
  name: string | null
  address: string | null
  social: string | null
}

const emptyContact = (over: Partial<RevealContact>): RevealContact => ({
  phone: null,
  whatsapp: null,
  email: null,
  name: null,
  address: null,
  social: null,
  ...over,
})

export type RevealResult =
  | { ok: true; contact: RevealContact; remaining: number | null; alreadyRevealed: boolean }
  | { ok: false; status: number; error: string; gate?: Gate }

export type RevealStatus = {
  /** Whether a "Show phone & email" button should appear at all. */
  eligible: boolean
  plan: 'basic' | 'premium' | 'featured' | null
  /** Basic only: reveals left this month; null for Premium/Featured. */
  remaining: number | null
  alreadyRevealed: boolean
  /** Why not eligible, when eligible is false. */
  reason?: 'not_tutor' | 'suspended' | 'verify' | 'team' | 'not_parent' | 'no_contact' | 'off'
  /** A verify gate to show when reason === 'verify'. */
  gate?: Gate
}

/** A parent's eligibility to be revealed, and their verified contact (read only
 *  here, never returned to a client unless a reveal succeeds). */
async function loadParent(
  admin: NonNullable<ReturnType<typeof createAdminClient>>,
  parentId: string,
): Promise<
  | { ok: false; reason: 'team' | 'not_parent' | 'no_contact' }
  | { ok: true; contact: RevealContact }
> {
  const { data: p } = await admin
    .from('profiles')
    .select('role, is_suspended, is_team_account, phone_number, phone_verified_at, email')
    .eq('id', parentId)
    .maybeSingle()

  if (!p || (p.role !== 'parent' && p.role !== 'academy') || p.is_suspended) {
    return { ok: false, reason: 'not_parent' }
  }
  // Never reveal the team-operated account's contact (the shared jobs@ mailbox).
  if (p.is_team_account) return { ok: false, reason: 'team' }

  // Verified mobile only.
  const phone =
    p.phone_verified_at && p.phone_number ? normalisePkMobile(p.phone_number as string) : null

  // Verified email only: confirmed on the auth account and not a synthetic
  // mobile-signup address.
  let email: string | null = null
  const rawEmail = (p.email as string | null) ?? null
  if (rawEmail && !rawEmail.endsWith('@users.tutormint.org')) {
    const { data: authUser } = await admin.auth.admin.getUserById(parentId)
    if (authUser?.user?.email_confirmed_at) email = rawEmail
  }

  if (!phone && !email) return { ok: false, reason: 'no_contact' }
  return { ok: true, contact: emptyContact({ phone, email }) }
}

/** Shared entitlement gate for both status and reveal. */
async function tutorGate(
  tutorId: string,
): Promise<{ ok: true; plan: 'basic' | 'premium' | 'featured' } | { ok: false; status: RevealStatus }> {
  const ent = await getEntitlements(tutorId)
  if (ent.audience !== 'tutor') {
    return { ok: false, status: { eligible: false, plan: null, remaining: null, alreadyRevealed: false, reason: 'not_tutor' } }
  }
  if (ent.suspended) {
    return { ok: false, status: { eligible: false, plan: null, remaining: null, alreadyRevealed: false, reason: 'suspended' } }
  }
  // No fee paid → the verify gate (the platform's way onto contact at all).
  if (!ent.verified) {
    return {
      ok: false,
      status: {
        eligible: false,
        plan: null,
        remaining: null,
        alreadyRevealed: false,
        reason: 'verify',
        gate: await buildGate('tutor_verify', ent),
      },
    }
  }
  const plan = ent.plan === 'premium' || ent.plan === 'featured' ? ent.plan : 'basic'
  return { ok: true, plan }
}

/** Status for the button (no contact). Basic reveals are OFF (button hidden) if
 *  the counter column/table is missing — fail closed; Premium/Featured stay on. */
export async function revealStatus(tutorId: string, parentId: string): Promise<RevealStatus> {
  const admin = createAdminClient()
  if (!admin) return { eligible: false, plan: null, remaining: null, alreadyRevealed: false, reason: 'off' }

  const gate = await tutorGate(tutorId)
  if (!gate.ok) return gate.status

  const parent = await loadParent(admin, parentId)
  if (!parent.ok) {
    return { eligible: false, plan: gate.plan, remaining: null, alreadyRevealed: false, reason: parent.reason }
  }

  // Already revealed? (permanent). If the table is missing this read errors —
  // Premium/Featured are still eligible (unlimited, no table needed); Basic is
  // turned off (fail closed).
  let already = false
  let tableOk = true
  try {
    const { data, error } = await admin
      .from('contact_reveals')
      .select('tutor_id')
      .eq('tutor_id', tutorId)
      .eq('parent_id', parentId)
      .maybeSingle()
    if (error) tableOk = false
    else already = !!data
  } catch {
    tableOk = false
  }

  if (gate.plan === 'featured') {
    return { eligible: true, plan: 'featured', remaining: null, alreadyRevealed: already }
  }
  if (gate.plan === 'premium') {
    // Premium is counted (120). A counter that cannot be read leaves the button
    // ON with an unknown remaining — a paying tutor is never turned off.
    const used = tableOk ? await usedThisPeriod(admin, tutorId) : null
    return {
      eligible: true,
      plan: 'premium',
      remaining: used === null ? null : Math.max(0, PREMIUM_CONTACT_CAP - used),
      alreadyRevealed: already,
    }
  }

  // Basic: needs the counter. Fail closed if it is not there yet.
  if (!tableOk) return { eligible: false, plan: 'basic', remaining: null, alreadyRevealed: false, reason: 'off' }
  const used = await usedThisPeriod(admin, tutorId)
  if (used === null) return { eligible: false, plan: 'basic', remaining: null, alreadyRevealed: false, reason: 'off' }
  return {
    eligible: true,
    plan: 'basic',
    remaining: Math.max(0, CONTACT_REVEAL_CAP - used),
    alreadyRevealed: already,
  }
}

async function usedThisPeriod(
  admin: NonNullable<ReturnType<typeof createAdminClient>>,
  tutorId: string,
): Promise<number | null> {
  try {
    const { data, error } = await admin
      .from('usage_counters')
      .select('contact_reveals')
      .eq('user_id', tutorId)
      .eq('period', currentPeriod())
      .maybeSingle()
    if (error) return null
    return (data?.contact_reveals as number | null) ?? 0
  } catch {
    return null
  }
}

/** The reveal itself. Returns the contact only after every check and a counted
 *  (or already-revealed) atomic write succeeds. */
export async function revealParentContact(tutorId: string, parentId: string): Promise<RevealResult> {
  const admin = createAdminClient()
  if (!admin) return { ok: false, status: 503, error: 'Server is not configured.' }

  const gate = await tutorGate(tutorId)
  if (!gate.ok) {
    const s = gate.status
    if (s.reason === 'verify') return { ok: false, status: 403, error: 'Verify your account first.', gate: s.gate }
    if (s.reason === 'suspended') return { ok: false, status: 403, error: 'Your account is suspended.' }
    return { ok: false, status: 403, error: 'Only verified tutors can see contact details.' }
  }

  const parent = await loadParent(admin, parentId)
  if (!parent.ok) {
    const msg =
      parent.reason === 'team'
        ? 'This tuition is posted by the TutorMint team.'
        : parent.reason === 'no_contact'
          ? 'This member has no verified contact details yet.'
          : 'Contact details are not available.'
    return { ok: false, status: 403, error: msg }
  }

  const cap = CAP_FOR[gate.plan]
  // A paying tutor (Premium/Featured) is never blocked on a counter error; only
  // Basic fails closed.
  const failOpen = gate.plan !== 'basic'

  // Atomic reveal-or-count. If the function/table is missing (pre-migration):
  // Premium/Featured still reveal (fail open, still logged when it can be);
  // Basic fails closed.
  let allowed = false
  let already = false
  let used = 0
  try {
    const { data, error } = await admin.rpc('reveal_parent_contact', {
      p_tutor: tutorId,
      p_parent: parentId,
      p_cap: cap,
      p_period: currentPeriod(),
    })
    if (error) throw error
    const row = Array.isArray(data) ? data[0] : data
    allowed = !!row?.allowed
    already = !!row?.already_revealed
    used = (row?.used as number | null) ?? 0
  } catch {
    if (failOpen) {
      allowed = true
      already = false
      used = 0
    } else {
      return { ok: false, status: 503, error: 'Contact reveal is not available right now.' }
    }
  }

  if (!allowed) return overCapResult(gate.plan, tutorId)

  return {
    ok: true,
    contact: parent.contact,
    remaining: gate.plan === 'featured' ? null : Math.max(0, cap - used),
    alreadyRevealed: already,
  }
}

// ── job-contact reveals (PR57): staff-posted tuitions ──────────────────────
//
// A staff-posted tuition carries the real EXTERNAL parent's contact in
// job_contacts (never the team account, never a staff member). This brings it
// under the exact same reveal rules: the same 5-count, the same atomic RPC, the
// same verify/suspend/upgrade behaviour — keyed to the job contact so each real
// parent counts once.

async function loadJobContactTarget(
  jobId: string,
): Promise<{ ok: false; reason: 'no_contact' } | { ok: true; contact: RevealContact }> {
  const c = await loadJobContact(jobId)
  if (!c) return { ok: false, reason: 'no_contact' }
  const phone = c.contact_phone ? normalisePkMobile(c.contact_phone) : null
  const whatsapp = c.contact_whatsapp ? normalisePkMobile(c.contact_whatsapp) : null
  const email = c.contact_email ?? null
  if (!phone && !whatsapp && !email && !c.contact_name && !c.contact_address && !c.contact_social) {
    return { ok: false, reason: 'no_contact' }
  }
  return {
    ok: true,
    contact: emptyContact({
      phone,
      whatsapp,
      email,
      name: c.contact_name ?? null,
      address: c.contact_address ?? null,
      social: c.contact_social ?? null,
    }),
  }
}

export async function jobContactRevealStatus(tutorId: string, jobId: string): Promise<RevealStatus> {
  const admin = createAdminClient()
  if (!admin) return { eligible: false, plan: null, remaining: null, alreadyRevealed: false, reason: 'off' }

  const gate = await tutorGate(tutorId)
  if (!gate.ok) return gate.status

  const target = await loadJobContactTarget(jobId)
  if (!target.ok) return { eligible: false, plan: gate.plan, remaining: null, alreadyRevealed: false, reason: 'no_contact' }

  // Already revealed? Keyed on job_contact_id — the column may be missing before
  // the migration, so Premium/Featured stay eligible and Basic is off.
  let already = false
  let tableOk = true
  try {
    const { data, error } = await admin
      .from('contact_reveals')
      .select('tutor_id')
      .eq('tutor_id', tutorId)
      .eq('job_contact_id', jobId)
      .maybeSingle()
    if (error) tableOk = false
    else already = !!data
  } catch {
    tableOk = false
  }

  if (gate.plan === 'featured') {
    return { eligible: true, plan: 'featured', remaining: null, alreadyRevealed: already }
  }
  if (gate.plan === 'premium') {
    const used = tableOk ? await usedThisPeriod(admin, tutorId) : null
    return {
      eligible: true,
      plan: 'premium',
      remaining: used === null ? null : Math.max(0, PREMIUM_CONTACT_CAP - used),
      alreadyRevealed: already,
    }
  }
  if (!tableOk) return { eligible: false, plan: 'basic', remaining: null, alreadyRevealed: false, reason: 'off' }
  const used = await usedThisPeriod(admin, tutorId)
  if (used === null) return { eligible: false, plan: 'basic', remaining: null, alreadyRevealed: false, reason: 'off' }
  return {
    eligible: true,
    plan: 'basic',
    remaining: Math.max(0, CONTACT_REVEAL_CAP - used),
    alreadyRevealed: already,
  }
}

export async function revealJobContact(tutorId: string, jobId: string): Promise<RevealResult> {
  const admin = createAdminClient()
  if (!admin) return { ok: false, status: 503, error: 'Server is not configured.' }

  const gate = await tutorGate(tutorId)
  if (!gate.ok) {
    const s = gate.status
    if (s.reason === 'verify') return { ok: false, status: 403, error: 'Verify your account first.', gate: s.gate }
    if (s.reason === 'suspended') return { ok: false, status: 403, error: 'Your account is suspended.' }
    return { ok: false, status: 403, error: 'Only verified tutors can see contact details.' }
  }

  const target = await loadJobContactTarget(jobId)
  if (!target.ok) return { ok: false, status: 403, error: 'Contact details are not available.' }

  const cap = CAP_FOR[gate.plan]
  const failOpen = gate.plan !== 'basic'

  let allowed = false
  let already = false
  let used = 0
  try {
    const { data, error } = await admin.rpc('reveal_job_contact', {
      p_tutor: tutorId,
      p_job_contact: jobId,
      p_cap: cap,
      p_period: currentPeriod(),
    })
    if (error) throw error
    const row = Array.isArray(data) ? data[0] : data
    allowed = !!row?.allowed
    already = !!row?.already_revealed
    used = (row?.used as number | null) ?? 0
  } catch {
    if (failOpen) {
      allowed = true
      already = false
      used = 0
    } else {
      return { ok: false, status: 503, error: 'Contact reveal is not available right now.' }
    }
  }

  if (!allowed) return overCapResult(gate.plan, tutorId)

  return {
    ok: true,
    contact: target.contact,
    remaining: gate.plan === 'featured' ? null : Math.max(0, cap - used),
    alreadyRevealed: already,
  }
}
