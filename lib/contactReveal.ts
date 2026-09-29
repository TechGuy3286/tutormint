// lib/contactReveal.ts
//
// A tutor revealing a tuition's or a parent's contact, drawn from the ONE shared
// monthly pool (PR91 Part B) that applying also spends. Security first:
//
//   * The contact is NEVER in a page, prop, API response or log until a counted
//     reveal succeeds. This module is the only thing that reads a parent's / job
//     contact and pulls numbers out of the listing text, always through the
//     service role, and only after every check passes.
//   * The spend is atomic in the database (spend_tuition_pool / spend_parent_pool
//     lock the pool counter row), so two taps or a concurrent apply+view can
//     never spend past the cap.
//   * ONCE PER TUITION: viewing a tuition's number then applying (or the reverse)
//     uses 1 in total; a second view is free. ONCE PER PARENT for a parent-card /
//     thread reveal. An existing application or an earlier reveal counts as
//     already paid.
//
// Viewing a tuition reveals ALL of its contact: the number(s)/email(s) written
// into the title/description AND the contact field (a staff-posted tuition's
// job_contacts, or a real parent's verified phone/email).
//
// Pool caps come from the plan (ent.quota): Basic 10, Premium 100, Featured 300
// (shown "Unlimited"). Unverified (no fee): the verify gate. Suspended: nothing.
// Team account as the reveal TARGET on a parent card: never (jobs@ mailbox).

import { createAdminClient } from '@/lib/supabase/admin'
import { getEntitlements, isUnlimitedDisplay, type Entitlements } from '@/lib/entitlements'
import { buildGate, type Gate } from '@/lib/gate'
import { normalisePkMobile } from '@/lib/phone'
import { loadJobContact } from '@/lib/jobContact'
import { needsOnboarding } from '@/lib/onboardingGate'
import { genderApplyBlocked } from '@/lib/genderPref'
import { spendTuitionPool, spendParentPool, poolExhaustedFail, type PoolSpend } from '@/lib/pool'
import { extractTuitionContacts } from '@/lib/maskTuition'

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
  /** PR91 Part B.2 — numbers/emails found IN the tuition's title/description. */
  textPhones: string[]
  textEmails: string[]
}

const emptyContact = (over: Partial<RevealContact>): RevealContact => ({
  phone: null,
  whatsapp: null,
  email: null,
  name: null,
  address: null,
  social: null,
  textPhones: [],
  textEmails: [],
  ...over,
})

export type RevealResult =
  | { ok: true; contact: RevealContact; remaining: number | null; alreadyRevealed: boolean }
  | { ok: false; status: number; error: string; gate?: Gate; completeProfile?: boolean }

export type RevealStatus = {
  /** Whether a "Show phone & email" / "View number" control should appear. */
  eligible: boolean
  plan: 'basic' | 'premium' | 'featured' | null
  /** Pool reveals left this month — a number for a plan that shows a number
   *  (Basic), null for a plan shown as "Unlimited" (Premium/Featured). */
  remaining: number | null
  alreadyRevealed: boolean
  reason?:
    | 'not_tutor'
    | 'suspended'
    | 'verify'
    | 'team'
    | 'not_parent'
    | 'no_contact'
    | 'off'
    | 'complete'
    | 'gender'
  gate?: Gate
}

/** The pool remaining a surface should SHOW: the real number for a numeric-
 *  display plan (Basic), null (no countdown) for an "Unlimited" plan. */
function shownRemaining(ent: Entitlements, used: number | null): number | null {
  if (isUnlimitedDisplay(ent.displayedQuota)) return null
  const left = used === null ? ent.quotaLeft : Math.max(0, ent.quota - used)
  return left
}

/** PR85 Part C: does this tuition's gender preference exclude this tutor? */
async function jobGenderBlocks(
  admin: NonNullable<ReturnType<typeof createAdminClient>>,
  tutorId: string,
  jobId: string,
): Promise<boolean> {
  const { data: job } = await admin.from('jobs').select('gender_preference').eq('id', jobId).maybeSingle()
  const pref = (job?.gender_preference as string | null) ?? null
  if (!pref) return false
  const { data: me } = await admin.from('tutor_profiles').select('gender').eq('id', tutorId).maybeSingle()
  return genderApplyBlocked(pref, (me?.gender as string | null) ?? null)
}

/** A parent's eligibility to be revealed, and their verified contact (read only
 *  here, never returned to a client unless a reveal succeeds). */
async function loadParent(
  admin: NonNullable<ReturnType<typeof createAdminClient>>,
  parentId: string,
  allowTeam = false,
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
  // Never reveal the team account's contact on a PARENT card (the jobs@ mailbox).
  // On a tuition the team posts, the real external parent lives in job_contacts.
  if (p.is_team_account && !allowTeam) return { ok: false, reason: 'team' }
  if (p.is_team_account && allowTeam) return { ok: false, reason: 'no_contact' }

  const phone =
    p.phone_verified_at && p.phone_number ? normalisePkMobile(p.phone_number as string) : null

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
): Promise<
  | { ok: true; ent: Entitlements; plan: 'basic' | 'premium' | 'featured' }
  | { ok: false; status: RevealStatus }
> {
  const ent = await getEntitlements(tutorId)
  if (ent.audience !== 'tutor') {
    return { ok: false, status: { eligible: false, plan: null, remaining: null, alreadyRevealed: false, reason: 'not_tutor' } }
  }
  if (ent.suspended) {
    return { ok: false, status: { eligible: false, plan: null, remaining: null, alreadyRevealed: false, reason: 'suspended' } }
  }
  // PR85 Part D: revealing needs a FINISHED profile too.
  if (await needsOnboarding(tutorId)) {
    return { ok: false, status: { eligible: false, plan: null, remaining: null, alreadyRevealed: false, reason: 'complete' } }
  }
  // No fee paid → the verify gate (the way onto contact at all).
  if (!ent.verified) {
    return {
      ok: false,
      status: { eligible: false, plan: null, remaining: null, alreadyRevealed: false, reason: 'verify', gate: await buildGate('tutor_verify', ent) },
    }
  }
  const plan = ent.plan === 'premium' || ent.plan === 'featured' ? ent.plan : 'basic'
  return { ok: true, ent, plan }
}

// ── PARENT-account reveals (parent card, message thread): once per parent ──

export async function revealStatus(tutorId: string, parentId: string): Promise<RevealStatus> {
  const admin = createAdminClient()
  if (!admin) return { eligible: false, plan: null, remaining: null, alreadyRevealed: false, reason: 'off' }

  const gate = await tutorGate(tutorId)
  if (!gate.ok) return gate.status

  const parent = await loadParent(admin, parentId)
  if (!parent.ok) {
    return { eligible: false, plan: gate.plan, remaining: null, alreadyRevealed: false, reason: parent.reason }
  }

  let already = false
  try {
    const { data } = await admin.from('contact_reveals').select('tutor_id').eq('tutor_id', tutorId).eq('parent_id', parentId).maybeSingle()
    already = !!data
  } catch {
    /* table missing pre-migration → treat as not revealed */
  }

  return { eligible: true, plan: gate.plan, remaining: shownRemaining(gate.ent, null), alreadyRevealed: already }
}

export async function revealParentContact(tutorId: string, parentId: string): Promise<RevealResult> {
  const admin = createAdminClient()
  if (!admin) return { ok: false, status: 503, error: 'Server is not configured.' }

  const gate = await tutorGate(tutorId)
  if (!gate.ok) return gateFail(gate.status)

  const parent = await loadParent(admin, parentId)
  if (!parent.ok) return { ok: false, status: 403, error: parentMessage(parent.reason) }

  const spend = await spendParentPool(tutorId, parentId, gate.ent.quota)
  return finishReveal(spend, parent.contact, gate.ent, tutorId)
}

// ── TUITION reveals (the tuition page, team OR real-parent): once per tuition ──

/** Everything a tuition reveal shows: the contact field (job_contacts for a
 *  team post, else the real parent's verified contact) AND the numbers/emails in
 *  the listing text. Never returned to a client until a reveal is counted. */
async function loadTuitionTarget(
  admin: NonNullable<ReturnType<typeof createAdminClient>>,
  jobId: string,
): Promise<{ ok: false; reason: 'no_contact' } | { ok: true; contact: RevealContact }> {
  const { data: job } = await admin
    .from('jobs')
    .select('id, parent_id, title, description')
    .eq('id', jobId)
    .maybeSingle()
  if (!job) return { ok: false, reason: 'no_contact' }

  // Numbers/emails written into the listing text.
  const found = extractTuitionContacts(job.title as string | null, job.description as string | null)
  const textPhones = Array.from(
    new Set(found.phones.map((p) => normalisePkMobile(p)).filter((p): p is string => !!p)),
  )
  const textEmails = found.emails

  // The contact field: a staff-posted tuition's job_contacts, else the parent's.
  let base: RevealContact | null = null
  const c = await loadJobContact(jobId)
  if (c) {
    const phone = c.contact_phone ? normalisePkMobile(c.contact_phone) : null
    const whatsapp = c.contact_whatsapp ? normalisePkMobile(c.contact_whatsapp) : null
    if (phone || whatsapp || c.contact_email || c.contact_name || c.contact_address || c.contact_social) {
      base = emptyContact({
        phone,
        whatsapp,
        email: c.contact_email ?? null,
        name: c.contact_name ?? null,
        address: c.contact_address ?? null,
        social: c.contact_social ?? null,
      })
    }
  }
  if (!base && job.parent_id) {
    const parent = await loadParent(admin, job.parent_id as string, true)
    if (parent.ok) base = parent.contact
  }

  const contact = base ?? emptyContact({})
  contact.textPhones = textPhones
  contact.textEmails = textEmails

  const hasAny =
    contact.phone || contact.whatsapp || contact.email || contact.name || contact.address ||
    contact.social || textPhones.length > 0 || textEmails.length > 0
  if (!hasAny) return { ok: false, reason: 'no_contact' }
  return { ok: true, contact }
}

/** Has this tutor already paid for this tuition (access row, application, or an
 *  earlier reveal)? Then a reveal is free. */
async function tuitionAlreadyPaid(
  admin: NonNullable<ReturnType<typeof createAdminClient>>,
  tutorId: string,
  jobId: string,
): Promise<boolean> {
  try {
    const [access, app] = await Promise.all([
      admin.from('tuition_access').select('job_id').eq('tutor_id', tutorId).eq('job_id', jobId).maybeSingle(),
      admin.from('applications').select('id').eq('tutor_id', tutorId).eq('job_id', jobId).maybeSingle(),
    ])
    if (access.data || app.data) return true
  } catch {
    /* tuition_access missing pre-migration */
  }
  try {
    const { data } = await admin.from('contact_reveals').select('tutor_id').eq('tutor_id', tutorId).eq('job_contact_id', jobId).maybeSingle()
    return !!data
  } catch {
    return false
  }
}

export async function jobContactRevealStatus(tutorId: string, jobId: string): Promise<RevealStatus> {
  const admin = createAdminClient()
  if (!admin) return { eligible: false, plan: null, remaining: null, alreadyRevealed: false, reason: 'off' }

  const gate = await tutorGate(tutorId)
  if (!gate.ok) return gate.status

  if (await jobGenderBlocks(admin, tutorId, jobId)) {
    return { eligible: false, plan: gate.plan, remaining: null, alreadyRevealed: false, reason: 'gender' }
  }

  const target = await loadTuitionTarget(admin, jobId)
  if (!target.ok) return { eligible: false, plan: gate.plan, remaining: null, alreadyRevealed: false, reason: 'no_contact' }

  const already = await tuitionAlreadyPaid(admin, tutorId, jobId)
  return { eligible: true, plan: gate.plan, remaining: shownRemaining(gate.ent, null), alreadyRevealed: already }
}

export async function revealJobContact(tutorId: string, jobId: string): Promise<RevealResult> {
  const admin = createAdminClient()
  if (!admin) return { ok: false, status: 503, error: 'Server is not configured.' }

  const gate = await tutorGate(tutorId)
  if (!gate.ok) return gateFail(gate.status)

  if (await jobGenderBlocks(admin, tutorId, jobId)) {
    return { ok: false, status: 403, error: 'This tuition asks for a different tutor gender.' }
  }

  const target = await loadTuitionTarget(admin, jobId)
  if (!target.ok) return { ok: false, status: 403, error: 'Contact details are not available.' }

  const spend = await spendTuitionPool(tutorId, jobId, gate.ent.quota)
  return finishReveal(spend, target.contact, gate.ent, tutorId)
}

/**
 * PR92 Part A.3: the FULL tuition contact for a tutor who ALREADY has access
 * (an access row, an application, or an earlier reveal) — no spend, no gate. Used
 * to render the full number on the tuition page instead of the masked teaser.
 * Returns null for anyone who has not already paid for this tuition.
 */
export async function peekTuitionContact(tutorId: string, jobId: string): Promise<RevealContact | null> {
  const admin = createAdminClient()
  if (!admin) return null
  const ent = await getEntitlements(tutorId)
  if (ent.audience !== 'tutor' || !ent.verified || ent.suspended) return null
  if (await jobGenderBlocks(admin, tutorId, jobId)) return null
  if (!(await tuitionAlreadyPaid(admin, tutorId, jobId))) return null
  const target = await loadTuitionTarget(admin, jobId)
  return target.ok ? target.contact : null
}

// ── shared tails ──────────────────────────────────────────────────────────

/** Turn a pool spend into a reveal result. Fails OPEN when the pool function is
 *  not available yet (pre-migration): the reveal proceeds without a count, so a
 *  deploy before the migration never blocks a verified tutor. */
async function finishReveal(
  spend: PoolSpend,
  contact: RevealContact,
  ent: Entitlements,
  tutorId: string,
): Promise<RevealResult> {
  if (spend.ok) {
    return { ok: true, contact, remaining: shownRemaining(ent, spend.used), alreadyRevealed: spend.already }
  }
  if (spend.reason === 'exhausted') {
    const fail = await poolExhaustedFail(ent, tutorId)
    return { ok: false, status: fail.status, error: fail.error, gate: fail.gate }
  }
  // unavailable (pre-migration) → fail open, no count.
  return { ok: true, contact, remaining: shownRemaining(ent, null), alreadyRevealed: false }
}

function gateFail(s: RevealStatus): RevealResult {
  if (s.reason === 'complete') return { ok: false, status: 403, error: 'Complete your profile first to apply.', completeProfile: true }
  if (s.reason === 'verify') return { ok: false, status: 403, error: 'Verify your account first.', gate: s.gate }
  if (s.reason === 'suspended') return { ok: false, status: 403, error: 'Your account is suspended.' }
  return { ok: false, status: 403, error: 'Only verified tutors can see contact details.' }
}

function parentMessage(reason: 'team' | 'no_contact' | 'not_parent'): string {
  return reason === 'team'
    ? 'This tuition is posted by the TutorMint team.'
    : reason === 'no_contact'
      ? 'This member has no verified contact details yet.'
      : 'Contact details are not available.'
}
