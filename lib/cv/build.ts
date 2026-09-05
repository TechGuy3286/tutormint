import 'server-only'

import { createClient } from '@/lib/supabase/server'
import { absoluteUrl, SITE_URL } from '@/lib/siteUrl'
import type { CvRaw, CvSubjectGroup } from '@/lib/cv/model'

// Reads a tutor's OWN profile into a CvRaw — the base tables, not the
// tutor_public_page RPC, because that RPC returns nothing for a tutor under
// 100% and every tutor (free and unlisted included) may see their own CV
// preview. The mapper (lib/cv/model.ts) turns this into the CvModel both the
// preview and the PDF render from.
//
// Contact comes from profiles first with the tutor_profiles columns as the
// pre-migration fallback, exactly as the public profile page resolves it. The
// avatar is profiles.avatar_url (the source of truth); it is validated against
// our buckets in the mapper, so an identity document can never reach a CV.

async function resolveSubjectGroups(
  supabase: Awaited<ReturnType<typeof createClient>>,
  masterIds: number[],
): Promise<CvSubjectGroup[]> {
  if (masterIds.length === 0) return []

  const { data: master } = await supabase
    .from('taxonomy_master')
    .select('id, level_slug, subject_slug')
    .in('id', masterIds)
  const rows = (master ?? []) as { id: number; level_slug: string; subject_slug: string | null }[]

  const levelSlugs = [...new Set(rows.map((m) => m.level_slug))]
  const subjectSlugs = [...new Set(rows.map((m) => m.subject_slug).filter(Boolean) as string[])]

  const [{ data: levels }, { data: subjects }] = await Promise.all([
    supabase.from('taxonomy_levels').select('slug, name').in('slug', levelSlugs),
    subjectSlugs.length > 0
      ? supabase.from('taxonomy_subjects').select('slug, name').in('slug', subjectSlugs)
      : Promise.resolve({ data: [] as { slug: string; name: string }[] }),
  ])
  const levelName = new Map((levels ?? []).map((l) => [l.slug as string, l.name as string]))
  const subjectName = new Map((subjects ?? []).map((s) => [s.slug as string, s.name as string]))

  // Grouped by level, in the order the levels first appear. A level-leaf master
  // (Test Prep, Sports, Quran) has no subject — the level itself is the item.
  const byLevel = new Map<string, string[]>()
  for (const m of rows) {
    const level = levelName.get(m.level_slug) ?? m.level_slug
    if (!byLevel.has(level)) byLevel.set(level, [])
    const sub = m.subject_slug ? subjectName.get(m.subject_slug) : null
    if (sub && !byLevel.get(level)!.includes(sub)) byLevel.get(level)!.push(sub)
  }

  return [...byLevel.entries()].map(([level, subs]) => ({ level, subjects: subs.sort() }))
}

export async function buildCvRaw(userId: string): Promise<CvRaw> {
  const supabase = await createClient()

  const [{ data: profile }, { data: tp }, { data: subs }] = await Promise.all([
    supabase
      .from('profiles')
      .select('full_name, avatar_url, city, phone_number, whatsapp, email, profile_completion')
      .eq('id', userId)
      .maybeSingle(),
    supabase
      .from('tutor_profiles')
      .select('slug, headline, bio, area, experience_years, teaching_mode, degrees, phone_number, whatsapp_number')
      .eq('id', userId)
      .maybeSingle(),
    supabase.from('tutor_subjects').select('master_id').eq('tutor_id', userId),
  ])

  const masterIds = [...new Set((subs ?? []).map((s) => s.master_id as number))]
  const subjectGroups = await resolveSubjectGroups(supabase, masterIds)

  const slug = (tp?.slug as string | null) ?? null

  return {
    fullName: (profile?.full_name as string) || 'Tutor',
    avatarUrl: (profile?.avatar_url as string | null) ?? null,
    city: (profile?.city as string | null) ?? null,
    area: (tp?.area as string | null) ?? null,
    headline: (tp?.headline as string | null) ?? null,
    bio: (tp?.bio as string | null) ?? null,
    subjectGroups,
    degrees: ((tp?.degrees as string[] | null) ?? []).filter(Boolean),
    experienceYears: (tp?.experience_years as number | null) ?? null,
    teachingMode: (tp?.teaching_mode as string | null) ?? null,
    languages: [], // No languages column on the profile; omitted from the CV.
    phone: (profile?.phone_number as string | null) || (tp?.phone_number as string | null) || null,
    whatsapp: (profile?.whatsapp as string | null) || (tp?.whatsapp_number as string | null) || null,
    email: (profile?.email as string | null) ?? null,
    slug,
    profileUrl: slug ? absoluteUrl(`/tutor/${slug}`) : SITE_URL,
    completion: (profile?.profile_completion as number | null) ?? 0,
  }
}
