import 'server-only'

// lib/whatsMissing.ts
//
// The tutor dashboard's "What's missing" (owner, 13 Oct 2026): the onboarding
// items still to do (lib/onboarding/missingItems — the same rule the steps use)
// and, separately, what makes the profile visible on Google (lib/seo/indexable —
// the same rule the profile page's robots tag and the sitemap use).

import { createAdminClient } from '@/lib/supabase/admin'
import { flowStateByTutor } from '@/lib/onboardingStop'
import { missingSummary, type MissingSummary } from '@/lib/onboarding/missingItems'
import { deriveCnicStatus } from '@/lib/cnicStatus'
import { googleVisibilityLine, tutorIndexRequirements, tutorProfileIndexable, type IndexRequirement } from '@/lib/seo/indexable'

export type WhatsMissing = {
  summary: MissingSummary
  google: { line: string; requirements: IndexRequirement[]; visible: boolean }
}

export async function loadWhatsMissing(userId: string): Promise<WhatsMissing | null> {
  try {
    const admin = createAdminClient()
    if (!admin) return null
    const [state, { data: p }] = await Promise.all([
      flowStateByTutor(admin, [userId]),
      admin.from('profiles').select('verification_state, cnic_verified_at, cnic_number, cnic_image_path, profile_pic_status, selfie_status, is_seed').eq('id', userId).maybeSingle(),
    ])
    const s = state.get(userId)
    if (!s || !p) return null
    const facts = {
      feePaid: s.facts.feePaid,
      cnicApproved: deriveCnicStatus(p as never) === 'approved',
      profilePicApproved: p.profile_pic_status === 'approved',
      selfieApproved: p.selfie_status === 'approved',
      isSeed: !!p.is_seed,
    }
    const requirements = tutorIndexRequirements(facts)
    return {
      summary: missingSummary(s.facts),
      google: { line: googleVisibilityLine(requirements), requirements, visible: tutorProfileIndexable(facts) },
    }
  } catch {
    return null
  }
}
