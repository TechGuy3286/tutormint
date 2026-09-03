// lib/publicParent.ts
//
// What a tutor may see about a parent before applying.
//
// THE ALLOWLIST IS THE POINT. This returns a fixed, named set of fields and
// nothing else. `profiles` holds a phone number, a WhatsApp number, an email,
// a home address and a CNIC number on the same row, and the safe way to keep
// those off a public page is to never select them -- not to select the row and
// remember which properties not to render. A future column is excluded by
// default rather than included by accident.
//
// Children are absent for a stronger reason than product design: they are
// minors who signed up for nothing, and a public page naming a child and their
// grade is a page about a child.
//
// Read through the service role because `profiles` is self-read only -- a
// tutor's own client cannot see a parent's name at all. Exactly the same
// pattern as lib/jobFeed's parentFacts(), for the same reason.

import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import type { BadgeName } from '@/lib/planBadges'

export type PublicParentJob = {
  id: string
  jobTxId: string | null
  /** The tuition's own page. Set once at posting and never changes. */
  publicSlug: string | null
  title: string
  classLevel: string | null
  city: string | null
  area: string | null
  teachingMode: string | null
  budgetPkr: number | null
  budgetMin: number | null
  budgetMax: number | null
  createdAt: string
}

export type PublicParent = {
  id: string
  name: string
  avatarUrl: string | null
  city: string | null
  memberSince: string
  verified: boolean
  canHire: boolean
  badges: BadgeName[]
  jobs: PublicParentJob[]
}

export async function publicParent(id: string): Promise<PublicParent | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null

  const admin = createAdminClient()
  if (!admin) return null

  const { data: profile } = await admin
    .from('profiles')
    // The allowlist. Nothing that could identify or contact them.
    .select('id, full_name, avatar_url, city, role, is_suspended, created_at, cnic_verified_at, address_verified_at')
    .eq('id', id)
    .maybeSingle()

  // A tutor's id, a suspended member, and an id that does not exist all return
  // null, so the 404 tells nobody which of the three it was.
  if (!profile) return null
  if (profile.role !== 'parent' && profile.role !== 'academy') return null
  if (profile.is_suspended) return null

  const [{ data: subs }, { data: plans }] = await Promise.all([
    admin
      .from('subscriptions')
      .select('plan_code')
      .eq('user_id', id)
      .eq('status', 'active')
      .gt('expires_at', new Date().toISOString()),
    admin.from('plans').select('code, audience, can_hire'),
  ])

  const planByCode = new Map((plans ?? []).map((p) => [p.code as string, p]))
  const canHire = (subs ?? []).some((s) => {
    const plan = planByCode.get(s.plan_code as string)
    return plan?.audience === 'parent' && plan?.can_hire === true
  })

  const verified = !!profile.cnic_verified_at && !!profile.address_verified_at

  const badges: BadgeName[] = []
  if (verified) badges.push('Verified')
  if (canHire) badges.push('Featured')

  // Open jobs only, through the CALLER's client rather than the service role:
  // the jobs table's own read policy decides what is public, and going around
  // it here would be a second, quietly different answer to "which jobs may a
  // stranger see".
  const supabase = await createClient()
  const { data: jobs } = await supabase
    .from('jobs')
    .select(
      'id, job_tx_id, public_slug, title, class_level, city, area, teaching_mode, budget_pkr, budget_min_pkr, budget_max_pkr, created_at',
    )
    .eq('parent_id', id)
    .eq('status', 'open')
    .order('created_at', { ascending: false })
    .limit(20)

  return {
    id: profile.id as string,
    name: (profile.full_name as string) || 'TutorMint member',
    avatarUrl: (profile.avatar_url as string) ?? null,
    city: (profile.city as string) ?? null,
    memberSince: profile.created_at as string,
    verified,
    canHire,
    badges,
    jobs: (jobs ?? []).map((j) => ({
      id: j.id as string,
      jobTxId: (j.job_tx_id as string) ?? null,
      publicSlug: (j.public_slug as string) ?? null,
      title: (j.title as string) ?? 'Tuition',
      classLevel: (j.class_level as string) ?? null,
      city: (j.city as string) ?? null,
      area: (j.area as string) ?? null,
      teachingMode: (j.teaching_mode as string) ?? null,
      budgetPkr: (j.budget_pkr as number) ?? null,
      budgetMin: (j.budget_min_pkr as number) ?? null,
      budgetMax: (j.budget_max_pkr as number) ?? null,
      createdAt: j.created_at as string,
    })),
  }
}
