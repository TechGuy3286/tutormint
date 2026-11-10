import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import { brandMonogramDataUri } from '@/lib/covers/assets'
import { cvQrDataUri } from '@/lib/cv/assets'
import { loadPostTutor } from '@/lib/social/postTutor'
import { loadImageProfileFacts } from '@/lib/social/imageVersion'
import { imageCacheControl, imageVersionKey, STATUS_DRAW, withImageCache } from '@/lib/social/imageVersionCore'
import { renderSocialBanner } from '@/app/api/admin/social/image/render'
import { planBadgeNames, statusPlanFor, type StatusPlan } from '@/lib/social/statusPlanCore'

type Admin = NonNullable<ReturnType<typeof createAdminClient>>

// The "I'm a Verified Tutor" WhatsApp status image (owner, 26 Oct 2026) —
// lib/social/statusImageCore. Drawn live from the profile on every request; the
// browser keeps it only while the URL's version key is the live one.

export type StatusImageResult = { ok: true; response: Response } | { ok: false; status: number; error: string }

/** The live version key for one tutor's status image, or null (not a tutor). */
export async function statusImageKey(admin: Admin, tutorId: string): Promise<string | null> {
  const facts = (await loadImageProfileFacts(admin, [tutorId])).get(tutorId)
  return facts ? imageVersionKey(facts, STATUS_DRAW) : null
}

/** Whether this tutor may have a status image (the verified rule), and its URL key. */
export async function statusImageFacts(
  admin: Admin,
  tutorId: string,
): Promise<{ allowed: boolean; key: string | null; firstName: string; plan: StatusPlan }> {
  const facts = (await loadImageProfileFacts(admin, [tutorId])).get(tutorId)
  if (!facts) return { allowed: false, key: null, firstName: '', plan: 'verified' }
  return { allowed: facts.verified, key: imageVersionKey(facts, STATUS_DRAW), firstName: facts.name.split(' ')[0] ?? '', plan: facts.plan ?? 'verified' }
}

export async function renderStatusImage(admin: Admin, tutorId: string, urlKey: string | null): Promise<StatusImageResult> {
  const { data: tp } = await admin.from('tutor_profiles').select('slug').eq('id', tutorId).maybeSingle()
  if (!tp?.slug) return { ok: false, status: 404, error: 'Tutor not found.' }
  const post = await loadPostTutor(admin, tp.slug as string)
  if (!post || post.isFixture) return { ok: false, status: 404, error: 'Tutor not found.' }
  // Only tutors with the Verified badge (the Social posts verified rule).
  if (!post.eligible) return { ok: false, status: 403, error: 'Only verified tutors have a status image.' }

  const [qrDataUri, logoDataUri, live, { data: subs }] = await Promise.all([
    cvQrDataUri(post.profileUrl),
    brandMonogramDataUri(),
    statusImageKey(admin, tutorId),
    admin.from('subscriptions').select('plan_code, status, expires_at').eq('user_id', tutorId).eq('status', 'active'),
  ])
  // The highest ACTIVE plan: Featured, then Premium, then Verified (an ended
  // upgrade falls back to Verified on the next download).
  const plan = statusPlanFor((subs ?? []) as { plan_code: string | null; status: string | null; expires_at: string | null }[], Date.now())
  const res = renderSocialBanner({
    tutor: post.tutor,
    badges: planBadgeNames(plan),
    subjects: post.subjects,
    subjectParts: post.subjectParts,
    format: STATUS_DRAW.format as 'story',
    template: 'verified',
    qrDataUri,
    profileUrl: post.profileUrl,
    headline: '',
    logoDataUri,
    verified: true,
    statusPlan: plan,
  })
  return { ok: true, response: await withImageCache(res, imageCacheControl(urlKey, live ?? '', 'private')) }
}
