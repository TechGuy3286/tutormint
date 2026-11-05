// lib/closestToPayCore.ts
//
// PURE, client-safe. "Closest to paying" (owner, 5 Nov 2026): unpaid tutors
// grouped by how near they are to the Rs 199 Verification Fee, hottest first,
// so Backend Support works the tutors most likely to pay.
//
//   ready          CNIC, profile photo and selfie all approved; fee not paid.
//   main_approved  CNIC and profile photo approved; selfie missing, waiting or rejected.
//   all_uploaded   all three uploaded, at least one still waiting (none rejected).
//   main_uploaded  CNIC and profile photo uploaded (approved or waiting); no selfie yet.
//
// Each tutor is in at most ONE stage — the first that matches, in that order.
// A tutor who paid is in none. Inside a stage: paused accounts last, then
// anyone contacted in the last 3 days, then last active (newest first).
//
// The WhatsApp text for each stage is plain English with no price; it links
// to the payment page or the onboarding step that is next.
//
// Unit-tested by scripts/test-closest-to-pay.ts.

import { siteLink } from '@/lib/waLinkCore'

export const CLOSEST_STAGES = ['ready', 'main_approved', 'all_uploaded', 'main_uploaded'] as const
export type ClosestStage = (typeof CLOSEST_STAGES)[number]
export type ClosestFilter = ClosestStage | 'none'

export const CLOSEST_LABEL: Record<ClosestStage, string> = {
  ready: 'Ready to pay',
  main_approved: 'Main docs approved',
  all_uploaded: 'All uploaded, awaiting approval',
  main_uploaded: 'Main docs uploaded',
}

export function parseClosest(v: string | null | undefined): ClosestFilter {
  return (CLOSEST_STAGES as readonly string[]).includes(v ?? '') ? (v as ClosestStage) : 'none'
}

export const CONTACTED_SINK_DAYS = 3
const DAY = 86_400_000

/** One document as the closest rule reads it. */
export type DocState = 'approved' | 'waiting' | 'rejected' | 'none'

export type ClosestFacts = {
  feePaid: boolean
  cnic: DocState
  photo: DocState
  selfie: DocState
}

const uploaded = (s: DocState) => s === 'approved' || s === 'waiting'

/** The ONE stage this tutor is in, or null. */
export function closestStage(f: ClosestFacts): ClosestStage | null {
  if (f.feePaid) return null
  const { cnic, photo, selfie } = f
  if (cnic === 'approved' && photo === 'approved' && selfie === 'approved') return 'ready'
  if (cnic === 'approved' && photo === 'approved') return 'main_approved'
  if (uploaded(cnic) && uploaded(photo) && uploaded(selfie)) return 'all_uploaded'
  if (uploaded(cnic) && uploaded(photo) && selfie === 'none') return 'main_uploaded'
  return null
}

export function stageRank(s: ClosestStage): number {
  return CLOSEST_STAGES.indexOf(s)
}

const DOC_NAME = { cnic: 'CNIC', photo: 'Profile photo', selfie: 'Selfie' } as const

/** One short line of what is missing: "Pay fee", "Selfie missing",
 *  "CNIC waiting approval", "Selfie rejected". */
export function closestMissing(f: ClosestFacts): string {
  const parts: string[] = []
  for (const k of ['cnic', 'photo', 'selfie'] as const) {
    const s = f[k]
    if (s === 'none') parts.push(`${DOC_NAME[k]} missing`)
    else if (s === 'waiting') parts.push(`${DOC_NAME[k]} waiting approval`)
    else if (s === 'rejected') parts.push(`${DOC_NAME[k]} rejected`)
  }
  if (!f.feePaid) parts.push('Pay fee')
  return parts.join(' · ')
}

/** Contacted within the last 3 days — such a tutor sinks to the bottom of their stage. */
export function recentlyContacted(lastContactAt: string | null | undefined, nowMs: number): boolean {
  const t = Date.parse(lastContactAt ?? '')
  return Number.isFinite(t) && nowMs - t < CONTACTED_SINK_DAYS * DAY
}

/** "Contacted today" / "Contacted 2 days ago" — or null. */
export function contactedAgo(lastContactAt: string | null | undefined, nowMs: number): string | null {
  const t = Date.parse(lastContactAt ?? '')
  if (!Number.isFinite(t)) return null
  const d = Math.max(0, Math.floor((nowMs - t) / DAY))
  return d === 0 ? 'Contacted today' : `Contacted ${d} ${d === 1 ? 'day' : 'days'} ago`
}

export type ClosestSortable = {
  stage: ClosestStage
  paused: boolean
  lastContactAt: string | null
  lastActiveAt: string | null
}

/** Stage, then paused last, then contacted-in-3-days last, then last active newest first. */
export function sortClosest<T extends ClosestSortable>(rows: T[], nowMs: number): T[] {
  const key = (r: T) => Date.parse(r.lastActiveAt ?? '') || 0
  return rows
    .map((r, i) => ({ r, i }))
    .sort(
      (a, b) =>
        stageRank(a.r.stage) - stageRank(b.r.stage) ||
        Number(a.r.paused) - Number(b.r.paused) ||
        Number(recentlyContacted(a.r.lastContactAt, nowMs)) - Number(recentlyContacted(b.r.lastContactAt, nowMs)) ||
        key(b.r) - key(a.r) ||
        a.i - b.i,
    )
    .map((x) => x.r)
}

/** Count per stage (each tutor once). */
export function closestCounts(stages: (ClosestStage | null)[]): Record<ClosestStage, number> {
  const out = Object.fromEntries(CLOSEST_STAGES.map((s) => [s, 0])) as Record<ClosestStage, number>
  for (const s of stages) if (s) out[s]++
  return out
}

// ------------------------------------------------------------ messages

export const CLOSEST_TEMPLATE_PREFIX = 'closest_'
export function closestTemplateKey(s: ClosestStage): string {
  return `${CLOSEST_TEMPLATE_PREFIX}${s}`
}
export function isClosestTemplateKey(k: string | null | undefined): boolean {
  return !!k && CLOSEST_STAGES.some((s) => k === closestTemplateKey(s))
}

export const PAY_PATH = '/pay/choose?plan=verified'
export const SELFIE_PATH = '/tutor/complete-profile?step=selfie'

/** The stage's WhatsApp text. Plain English, friendly, no price; the link on its own last line before the help line. */
export function closestMessage(stage: ClosestStage, f: ClosestFacts, firstName: string, supportWhatsapp: string | null): string {
  const hi = `Assalam o Alaikum ${firstName || 'there'},`
  let body: string
  let link: string
  switch (stage) {
    case 'ready':
      body = `${hi} good news: your CNIC, profile photo and selfie are approved. The last step is the one-time Verification Fee. After that you get the Verified badge and can apply to tuitions.`
      link = siteLink(PAY_PATH)
      break
    case 'main_approved':
      body =
        f.selfie === 'rejected'
          ? `${hi} your CNIC and profile photo are approved. Please take a new selfie, then pay the one-time Verification Fee to get your Verified badge.`
          : f.selfie === 'waiting'
            ? `${hi} your CNIC and profile photo are approved and we are checking your selfie now. You can pay the one-time Verification Fee now, so you are ready as soon as it is approved.`
            : `${hi} your CNIC and profile photo are approved. Please take your selfie next, then pay the one-time Verification Fee to get your Verified badge.`
      link = siteLink(f.selfie === 'waiting' ? PAY_PATH : SELFIE_PATH)
      break
    case 'all_uploaded':
      body = `${hi} thank you for uploading your documents. We are checking them now. You can pay the one-time Verification Fee now, so your profile is ready as soon as they are approved.`
      link = siteLink(PAY_PATH)
      break
    default:
      body = `${hi} your CNIC and profile photo are uploaded. The next step is your selfie. It only takes a minute.`
      link = siteLink(SELFIE_PATH)
  }
  const help = supportWhatsapp ? `\n\nNeed help? WhatsApp ${supportWhatsapp}` : ''
  return `${body}\n\n${link}${help}`
}

/** Follow-ups → Tutors on a "Closest to paying" chip. */
export function closestHref(stage: ClosestStage): string {
  return `/admin/follow-ups?closest=${stage}`
}

/** The Overview row that opens the Ready to pay chip. */
export const READY_TO_PAY_KEY = 'todo-ready-to-pay'
