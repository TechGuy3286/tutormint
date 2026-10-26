import 'server-only'

import { chunk } from '@/lib/pageAll'
import { createAdminClient } from '@/lib/supabase/admin'
import { formatName } from '@/lib/formatName'
import { PROFILE_COLS, socialEligible, toFacts, type ProfileRow } from './eligibilityCore'
import { imageVersionKey, type ImageDrawFacts, type ImageProfileFacts } from './imageVersionCore'

type Admin = NonNullable<ReturnType<typeof createAdminClient>>

// The profile half of the image version key (lib/social/imageVersionCore), read
// from the live rows — ONE reader, used by every page that builds an image URL
// (the Social posts picker, the profile page's og:image, the status-image
// buttons) and by every image route that checks the key, so the two sides
// always compute it from the same facts.
//
// Subjects are the tutor's tutor_subjects master ids (what every chip is drawn
// from). Verification is the Social posts rule (fee paid, CNIC, photo and selfie
// approved, not paused, banned, test or seed).

export async function loadImageProfileFacts(admin: Admin, ids: string[]): Promise<Map<string, ImageProfileFacts>> {
  const out = new Map<string, ImageProfileFacts>()
  const unique = [...new Set(ids.filter(Boolean))]
  for (const part of chunk(unique, 100)) {
    const [{ data: ps }, { data: tps }, { data: subs }] = await Promise.all([
      admin.from('profiles').select(`${PROFILE_COLS}, full_name, city`).in('id', part),
      admin
        .from('tutor_profiles')
        .select('id, full_name, headline, city, avatar_url, verified_fee_paid_at, gender, show_avatar')
        .in('id', part),
      admin.from('tutor_subjects').select('tutor_id, master_id').in('tutor_id', part),
    ])
    const tpById = new Map((tps ?? []).map((t) => [t.id as string, t as Record<string, unknown>]))
    const subjectsBy = new Map<string, number[]>()
    for (const s of subs ?? []) {
      const k = s.tutor_id as string
      subjectsBy.set(k, [...(subjectsBy.get(k) ?? []), s.master_id as number])
    }
    for (const p of (ps ?? []) as ProfileRow[]) {
      const tp = tpById.get(p.id)
      if (!tp) continue
      const facts = toFacts(p, tp)
      out.set(p.id, {
        name: formatName(((tp.full_name as string) || (p.full_name as string) || '') as string) || 'Tutor',
        photo: (tp.avatar_url as string | null) ?? null,
        photoHidden: facts.photoHidden,
        subjects: subjectsBy.get(p.id) ?? [],
        city: ((p.city as string | null) || (tp.city as string | null)) ?? null,
        headline: (tp.headline as string | null) ?? null,
        verified: socialEligible(facts),
      })
    }
  }
  return out
}

export async function liveImageKey(admin: Admin, tutorId: string, draw: ImageDrawFacts): Promise<string | null> {
  const facts = (await loadImageProfileFacts(admin, [tutorId])).get(tutorId)
  return facts ? imageVersionKey(facts, draw) : null
}
