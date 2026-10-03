import 'server-only'

import { complete, isConfigured } from './anthropic'
import { TAGLINE_SYSTEM, buildTaglineUser, parseTaglineReply, taglineForbidden, type TaglineCopy } from './taglineBrief'
import { composeHeadline, composeBio, type OnboardingAnswers } from '@/lib/onboarding/copy'

// The Claude half of the AI tagline & bio (PR106-G4a §3). Falls back to the
// deterministic composeHeadline / composeBio on any problem — a missing key, a
// failed/timed-out call, unparseable JSON, or output that fails the safety
// verifier (a leaked phone/CNIC/address). The member is never blocked.

export type TaglineResult = TaglineCopy & { source: 'claude' | 'composed' }

export async function generateTagline(
  answers: OnboardingAnswers,
  opts: { seed: string; address?: string | null },
): Promise<TaglineResult> {
  const fallback = (): TaglineResult => ({
    tagline: composeHeadline(answers),
    bio: composeBio(answers, opts.seed),
    source: 'composed',
  })

  if (!isConfigured()) return fallback()

  try {
    const res = await complete({ system: TAGLINE_SYSTEM, prompt: buildTaglineUser(answers), timeoutMs: 20000 })
    if (!res.ok) return fallback()
    const parsed = parseTaglineReply(res.text)
    if (!parsed) return fallback()
    if (taglineForbidden(parsed, { address: opts.address })) return fallback()
    return { ...parsed, source: 'claude' }
  } catch {
    return fallback()
  }
}
