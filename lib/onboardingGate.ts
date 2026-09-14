import 'server-only'

import { createClient } from '@/lib/supabase/server'

// The ONE predicate that decides whether a tutor is sent into the onboarding
// flow (owner, 14 Sep 2026). Defined here, in one place, and consulted by the
// tutor dashboard gate and the email-confirmation callback — never re-derived
// inline in a route.
//
// A tutor is routed into onboarding when their profile is MATERIALLY EMPTY — no
// subjects yet, or no city — UNLESS they have already been through the flow or
// dismissed it (tutor_profiles.onboarded_at), which is what stops a redirect
// loop: once onboarded_at is set, they are never sent back.

export async function needsOnboarding(userId: string): Promise<boolean> {
  const supabase = await createClient()
  const [{ data: profile }, { data: tp }, { count }] = await Promise.all([
    supabase.from('profiles').select('role, city').eq('id', userId).maybeSingle(),
    supabase.from('tutor_profiles').select('onboarded_at').eq('id', userId).maybeSingle(),
    supabase
      .from('tutor_subjects')
      .select('tutor_id', { count: 'exact', head: true })
      .eq('tutor_id', userId),
  ])

  if (profile?.role !== 'tutor') return false
  // Been through it, or dismissed it — never route again (no loop).
  if (tp?.onboarded_at) return false

  const noCity = !(profile?.city ?? '').trim()
  const noSubjects = (count ?? 0) === 0
  return noCity || noSubjects
}
