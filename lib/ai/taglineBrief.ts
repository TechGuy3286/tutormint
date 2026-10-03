// lib/ai/taglineBrief.ts
//
// The PURE half of the AI tagline & bio (PR106-G4a §3): the Claude prompt, the
// JSON shape, and the safety verifier. Kept pure (no server-only, no network) so
// the verifier and the fallback are unit-tested. The Claude call + fallback live
// in lib/ai/taglineCopy.ts; the deterministic fallback is composeHeadline /
// composeBio (lib/onboarding/copy).

import type { OnboardingAnswers } from '@/lib/onboarding/copy'

export type TaglineCopy = { tagline: string; bio: string }

export const TAGLINE_SYSTEM = [
  'You write a short public profile for a verified tutor on TutorMint, a Pakistani platform where parents find tutors.',
  "Write in the tutor's own calm, warm voice. Plain English a Pakistani parent reads easily. No corporate filler.",
  'Rules you must not break:',
  '- Use ONLY the facts given. Invent NOTHING — no exam results, pass rates, numbers of students, years, awards or reviews.',
  '- Never promise tuitions, jobs, results or income ("I will get you top marks" is forbidden).',
  '- Never include a phone number, CNIC number, address, email, or an exact fee. (A broad fee range may be mentioned only if it is in the facts.)',
  '- No emoji, no hashtags, no markdown, no greeting, no sign-off.',
  '- Tagline: ONE short line, under 70 characters (e.g. "O Level Physics tutor in Lahore").',
  '- Bio: two or three short sentences about what and how they teach, under 60 words.',
  'Reply as JSON only, exactly: {"tagline": "...", "bio": "..."}',
].join('\n')

export function buildTaglineUser(a: OnboardingAnswers): string {
  const lines = [
    `Gender/role words you may use: a tutor.`,
    a.city ? `City: ${a.city}` : null,
    a.areas.length ? `Areas: ${a.areas.join(', ')}` : null,
    a.levelNames.length ? `Levels: ${a.levelNames.join(', ')}` : null,
    a.subjectNames.length ? `Subjects: ${a.subjectNames.join(', ')}` : null,
    a.jobTypes?.length ? `Work: ${a.jobTypes.join(', ')}` : null,
    a.experienceBand ? `Experience: ${a.experienceBand} years` : null,
  ].filter(Boolean)
  return `Facts:\n${lines.join('\n')}\n\nWrite the tagline and bio from these facts only.`
}

/**
 * Reject AI output that leaks a phone/CNIC (a run of 10+ digits once separators
 * are stripped) or the tutor's own address. Returns the reason, or null when the
 * text is safe. Fee ranges like "5,000" or "100,000" (≤ 6 digits) are allowed.
 */
export function taglineForbidden(copy: TaglineCopy, opts: { address?: string | null }): string | null {
  const text = `${copy.tagline}\n${copy.bio}`
  const digits = text.replace(/[\s,.\-()]/g, '')
  if (/\d{10,}/.test(digits)) return 'contains a long number (phone/CNIC)'
  const addr = (opts.address ?? '').trim()
  if (addr.length >= 8 && text.toLowerCase().includes(addr.toLowerCase())) return 'contains the address'
  if (!copy.tagline.trim() || !copy.bio.trim()) return 'empty'
  if (copy.tagline.length > 120) return 'tagline too long'
  return null
}

/** Parse the model's JSON reply into TaglineCopy, or null when unparseable. */
export function parseTaglineReply(raw: string): TaglineCopy | null {
  try {
    const m = raw.match(/\{[\s\S]*\}/)
    if (!m) return null
    const j = JSON.parse(m[0]) as { tagline?: unknown; bio?: unknown }
    if (typeof j.tagline !== 'string' || typeof j.bio !== 'string') return null
    return { tagline: j.tagline.trim(), bio: j.bio.trim() }
  } catch {
    return null
  }
}
