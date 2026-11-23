import 'server-only'

// lib/followUpMode.ts — the server half of the "Start follow-ups" mode (owner,
// 23 Nov 2026 — PR-18 Part B; rules in lib/followUpModeCore).
//
//   nextCard(actor, stage, skip) — builds the stage's queue from the stored
//     People rows (admin_list_rows 'people:tutor', the same cards the page
//     shows), orders it, holds the first free tutor for this staff member
//     (claim_follow_up_session — two staff never get the same tutor) and
//     returns what the screen shows: name, city, stage, days since sign-up,
//     the last follow-up, the stage's message and a MASKED number.
//   openWhatsApp(actor, memberId) — the WhatsApp link, built here only when
//     "Open WhatsApp" is pressed; the number reveal is logged
//     (member.contact_reveal, field phone, via follow_up_mode) first.
//   recordOutcome(...) — Sent (a WhatsApp follow-up of the stage, by the
//     existing rules), No answer (an attempt only, never a follow-up), Not
//     interested (with its reason), Skip — then the hold is released.

import { createAdminClient } from '@/lib/supabase/admin'
import { pageAll, pageAllIn } from '@/lib/pageAll'
import { memoize } from '@/lib/memoCache'
import { logAdminAction } from '@/lib/auditLog'
import { formatName } from '@/lib/formatName'
import { maskPhoneDisplay } from '@/lib/contactMaskCore'
import { waSendHref, siteLink } from '@/lib/waLinkCore'
import { senderRefCode } from '@/lib/staffSignups'
import { isSyntheticEmail, normalisePkMobile } from '@/lib/phone'
import { supervisorMayChangeCity } from '@/lib/adminAccessCore'
import type { AdminActor } from '@/lib/adminAuth'
import { loadOnePipeCard, setPipelineNotInterested } from '@/lib/tutorPipeline'
import { recordCallAttempt, recordPipelineFollowUp } from '@/lib/tutorPipelineRecord'
import { markNotInterested, liveMark } from '@/lib/followUpDismissals'
import { DOCS_PATH, STAGE_LABEL, type FollowStage } from '@/lib/tutorPipelineCore'
import type { PipeCard } from '@/lib/tutorPipelineCardCore'
import { claimNextSession, holdsMember, heldByOther, liveOnIt, releaseSession } from '@/lib/memberClaims'
import {
  daysSince,
  isStuckEmailSignup,
  modeEligible,
  modeMessage,
  modeOrder,
  ONBOARDING_PATH,
  type ModeCandidate,
  type ModeOutcome,
} from '@/lib/followUpModeCore'

const LIST = 'people:tutor'
const BUSY = 'This is not working right now. Please try again in a few minutes.'

export type ModeCard = {
  memberId: string
  name: string
  city: string | null
  stage: FollowStage
  stageLabel: string
  signedUp: string
  daysSinceSignup: string
  lastFollowUp: { at: string; kind: string; by: string | null } | null
  followNumber: number
  message: string
  maskedPhone: string
  numberVerified: boolean
  stuck: boolean
  onIt: { staffName: string; mine: boolean } | null
  left: number
}

/** Open tuitions per city (lower-case), cached five minutes. */
const openByCity = memoize(
  async (): Promise<[string, number][]> => {
    const admin = createAdminClient()
    if (!admin) return []
    const rows = await pageAll((from, to) => admin.from('jobs').select('id, city').eq('status', 'open').order('id').range(from, to))
    const m = new Map<string, number>()
    for (const r of rows) {
      const k = String(r.city ?? '').trim().toLowerCase()
      if (k) m.set(k, (m.get(k) ?? 0) + 1)
    }
    return [...m.entries()]
  },
  ['follow-mode-open-by-city-v1'],
  { revalidate: 300 },
)

/** The cities a Manager (supervisor) owns, lower-case; null = not limited. */
async function supervisorCities(actor: AdminActor): Promise<Set<string> | null> {
  if (actor.adminRole !== 'supervisor') return null
  const admin = createAdminClient()
  if (!admin) return new Set()
  const { data } = await admin.from('city_owners').select('city, staff_id')
  return new Set((data ?? []).filter((r) => supervisorMayChangeCity(actor, (r.staff_id as string | null) ?? null)).map((r) => String(r.city ?? '').trim().toLowerCase()))
}

type Facts = { id: string; name: string; city: string | null; createdAt: string; email: string | null; phone: string | null; phoneVerifiedAt: string | null }

async function memberFacts(ids: string[]): Promise<Map<string, Facts>> {
  const admin = createAdminClient()
  const out = new Map<string, Facts>()
  if (!admin || ids.length === 0) return out
  const [profiles, tutors] = await Promise.all([
    pageAllIn(ids, (part, from, to) =>
      admin.from('profiles').select('id, full_name, city, created_at, email, phone_number, phone_verified_at').in('id', part).order('id').range(from, to),
    ),
    pageAllIn(ids, (part, from, to) => admin.from('tutor_profiles').select('id, city').in('id', part).order('id').range(from, to)),
  ])
  const tCity = new Map(tutors.map((t) => [t.id as string, (t.city as string | null) ?? null]))
  for (const p of profiles)
    out.set(p.id as string, {
      id: p.id as string,
      name: formatName((p.full_name as string | null) ?? '') || 'Tutor',
      city: tCity.get(p.id as string) || ((p.city as string | null) ?? null),
      createdAt: String(p.created_at),
      email: (p.email as string | null) ?? null,
      phone: normalisePkMobile((p.phone_number as string | null) ?? null),
      phoneVerifiedAt: (p.phone_verified_at as string | null) ?? null,
    })
  return out
}

function isStuck(f: Facts): boolean {
  return isStuckEmailSignup({ email: f.email, phoneVerifiedAt: f.phoneVerifiedAt, createdAt: f.createdAt, synthetic: isSyntheticEmail(f.email ?? '') })
}

/** A number to message: the verified mobile, or the stuck sign-ups' typed one. */
function numberFor(f: Facts): string | null {
  if (!f.phone) return null
  return f.phoneVerifiedAt || isStuck(f) ? f.phone : null
}

/** The stage's queue, in order (ids only). */
export async function modeQueue(actor: AdminActor, stage: FollowStage, nowMs = Date.now()): Promise<{ ids: string[]; stuck: Set<string> }> {
  const admin = createAdminClient()
  if (!admin) return { ids: [], stuck: new Set() }
  const rows = await pageAll((from, to) =>
    admin
      .from('admin_list_rows')
      .select('member_id, tags, row')
      .eq('list', LIST)
      .eq('tags->>stage', stage)
      .eq('tags->>excluded', 'false')
      .order('member_id')
      .range(from, to),
  )
  const cards = new Map<string, PipeCard>()
  for (const r of rows) {
    const tags = (r.tags ?? {}) as Record<string, unknown>
    if (tags.erase_req === true || tags.deleted === true) continue
    const pipe = ((r.row ?? {}) as { pipe?: PipeCard }).pipe
    if (pipe) cards.set(r.member_id as string, pipe)
  }
  const facts = await memberFacts([...cards.keys()])
  const cities = await supervisorCities(actor)
  const cands: ModeCandidate[] = []
  const stuck = new Set<string>()
  for (const [id, c] of cards) {
    const f = facts.get(id)
    if (!f) continue
    if (cities && !cities.has(String(f.city ?? '').trim().toLowerCase())) continue
    const ok = modeEligible(
      { stage: c.stage, section: c.section, notInterested: c.notInterested, paused: c.paused, noMobile: c.noMobile, retryAt: c.follow?.retryAt ?? null },
      { stage, hasNumber: !!numberFor(f), nowMs },
    )
    if (!ok) continue
    const s = isStuck(f)
    if (s) stuck.add(id)
    cands.push({ id, createdAt: f.createdAt, city: f.city, stuck: s })
  }
  const open = new Map(await openByCity())
  return { ids: modeOrder(cands, open, stage, nowMs).map((c) => c.id), stuck }
}

async function cardFor(actor: AdminActor, memberId: string, stage: FollowStage, left: number, stuckIds: Set<string>): Promise<ModeCard | null> {
  const [card, facts, onIt] = await Promise.all([loadOnePipeCard(memberId), memberFacts([memberId]), liveOnIt([memberId])])
  const f = facts.get(memberId)
  if (!card || !f || !card.message) return null
  const num = numberFor(f)
  const o = onIt.get(memberId)
  return {
    memberId,
    name: f.name,
    city: f.city,
    stage,
    stageLabel: STAGE_LABEL[stage],
    signedUp: f.createdAt,
    daysSinceSignup: daysSince(f.createdAt, Date.now()),
    lastFollowUp: card.lastContact ?? null,
    followNumber: card.follow?.nextNumber ?? 1,
    message: modeMessage(stage, card.message, siteLink(DOCS_PATH), siteLink(ONBOARDING_PATH)),
    maskedPhone: (num && maskPhoneDisplay(num)) || 'No number',
    numberVerified: !!f.phoneVerifiedAt,
    stuck: stuckIds.has(memberId),
    onIt: o ? { staffName: o.staffName, mine: o.staffId === actor.id } : null,
    left,
  }
}

/** The next tutor for this staff member (held for 10 minutes), or null when
 *  the stage has nobody left. `skip` = tutors already passed this session. */
export async function nextCard(actor: AdminActor, stage: FollowStage, skip: string[]): Promise<ModeCard | null> {
  const { ids, stuck } = await modeQueue(actor, stage)
  const skipped = new Set(skip)
  const order = ids.filter((id) => !skipped.has(id))
  // A tutor whose card no longer has a message is passed over (rare: a stale row).
  for (let tries = 0; tries < 5; tries++) {
    const got = await claimNextSession(actor.id, order, stage)
    if (!got) return null
    const card = await cardFor(actor, got, stage, Math.max(0, order.length - 1), stuck)
    if (card) return card
    await releaseSession(actor.id, got, 'skip')
    order.splice(order.indexOf(got), 1)
  }
  return null
}

/** The WhatsApp link for the tutor on screen — built here, the reveal logged first. */
export async function openWhatsApp(actor: AdminActor, memberId: string, stage: FollowStage): Promise<{ ok: true; waHref: string } | { ok: false; status: number; error: string }> {
  const other = await heldByOther(actor.id, memberId)
  if (other) return { ok: false, status: 409, error: `${other} is working on this tutor now.` }
  const [card, facts] = await Promise.all([loadOnePipeCard(memberId), memberFacts([memberId])])
  const f = facts.get(memberId)
  const num = f ? numberFor(f) : null
  if (!card || !f || !num || !card.message) return { ok: false, status: 404, error: 'There is no number to message for this tutor.' }
  if (card.stage !== stage) return { ok: false, status: 409, error: `This tutor moved to “${STAGE_LABEL[card.stage]}”. Skip to the next one.` }
  await logAdminAction({
    actorId: actor.id,
    actorRole: actor.adminRole,
    actorEmail: actor.email,
    action: 'member.contact_reveal',
    targetType: 'profile',
    targetId: memberId,
    detail: { field: 'phone', via: 'follow_up_mode' },
  })
  const text = modeMessage(stage, card.message, siteLink(DOCS_PATH), siteLink(ONBOARDING_PATH))
  return { ok: true, waHref: waSendHref(num, text, await senderRefCode(actor.id)) }
}

/** Record what happened, then release the hold. */
export async function recordOutcome(
  actor: AdminActor,
  a: { memberId: string; stage: FollowStage; outcome: ModeOutcome; reason?: string | null; note?: string | null },
): Promise<{ ok: true; counted: boolean } | { ok: false; status: number; error: string }> {
  const admin = createAdminClient()
  if (!admin) return { ok: false, status: 503, error: BUSY }
  if (a.outcome === 'skip') {
    await releaseSession(actor.id, a.memberId, 'skip')
    return { ok: true, counted: false }
  }
  if (!(await holdsMember(actor.id, a.memberId))) {
    const other = await heldByOther(actor.id, a.memberId)
    if (other) return { ok: false, status: 409, error: `${other} is working on this tutor now.` }
  }
  let counted = false
  if (a.outcome === 'sent') {
    // One per day per stage is the existing counting rule (same-PKT-day contacts fold into one).
    const r = await recordPipelineFollowUp({ memberId: a.memberId, kind: 'whatsapp', actor, expectStage: a.stage, strict: false })
    if (!r.ok) return r
    counted = true
  } else if (a.outcome === 'no_answer') {
    // An attempt only — never a follow-up; due again tomorrow.
    const r = await recordCallAttempt(a.memberId, 'no_answer', actor)
    if (!r.ok) return r
  } else if (a.outcome === 'not_interested') {
    const r = await markNotInterested(a.memberId, a.reason ?? null, a.note ?? null, actor)
    if (!r.ok) return r
    await setPipelineNotInterested(a.memberId, true, await liveMark(a.memberId))
  }
  await releaseSession(actor.id, a.memberId, 'done')
  return { ok: true, counted }
}
