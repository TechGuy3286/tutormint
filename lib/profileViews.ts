// lib/profileViews.ts
//
// The profile-view teaser: the tutor dashboard's primary upsell surface.
//
// "A parent searching AS & A Levels Mathematics in Gulberg viewed your
// profile" is useful and specific while telling the tutor nothing about who
// the parent is. Upgrading reveals the name.
//
// Read through the service-role client, and deliberately so. profile_views is
// admin-read-only under RLS: if a tutor could select their own rows with the
// anon key, viewer_id would be one query away and the anonymised teaser would
// be decoration rather than a control. Identity is withheld HERE, in server
// code, after entitlements have been consulted.

import { createAdminClient } from '@/lib/supabase/admin'

export type ViewTeaser = {
  id: string
  when: string
  /** The raw timestamp, for <TimeAgo>. `when` is the pre-formatted fallback. */
  at: string
  /** "AS & A Levels Mathematics", when the view came from a search. */
  subject: string | null
  /** The area, else the city, else null. */
  where: string | null
  /** Ready-to-render sentence. Never contains a name unless identity is granted. */
  text: string
  identified: boolean
  /**
   * The viewer's picture — ONLY when identity has been granted.
   *
   * The brief asked for the photo blurred for a free tutor and unblurred on
   * upgrade. A CSS filter over the real <img> would do that visually and give
   * the whole thing away: the URL sits in the DOM, avatars are public (they
   * render on every job card), and one devtools panel turns the paid feature
   * into a cosmetic one. That is the exact failure this file's header warns
   * about -- identity is withheld in server code, after entitlements, or it is
   * not withheld at all.
   *
   * So a free tutor is sent NO url, and the teaser draws a blurred tinted disc
   * seeded from the VIEW row rather than the viewer, so two views by the same
   * parent cannot even be matched to each other. Upgrading replaces it with
   * the real photograph, which is the promise the brief was making.
   */
  avatarUrl: string | null
}

function ago(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

export async function viewTeasers(
  tutorId: string,
  /** True when the tutor's plan grants viewer identity (premium and up). */
  revealIdentity: boolean,
  limit = 6,
): Promise<{ teasers: ViewTeaser[]; total: number }> {
  const admin = createAdminClient()
  if (!admin) return { teasers: [], total: 0 }

  const { data: rows, count } = await admin
    .from('profile_views')
    .select('id, viewer_id, viewer_role, search_subject, search_area, search_city, created_at', {
      count: 'exact',
    })
    .eq('tutor_id', tutorId)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (!rows || rows.length === 0) return { teasers: [], total: count ?? 0 }

  // Resolve the searched subject id to a readable label.
  const masterIds = Array.from(
    new Set(
      rows
        .map((r) => Number(r.search_subject))
        .filter((n) => Number.isFinite(n) && n > 0),
    ),
  )

  const labelByMaster = new Map<number, string>()
  if (masterIds.length > 0) {
    const { data: master } = await admin
      .from('taxonomy_master')
      .select('id, level_slug, subject_slug')
      .in('id', masterIds)

    const levelSlugs = Array.from(new Set((master ?? []).map((m) => m.level_slug as string)))
    const subjectSlugs = Array.from(
      new Set(
        (master ?? []).map((m) => m.subject_slug as string | null).filter(Boolean) as string[],
      ),
    )

    const [{ data: levels }, { data: subjects }] = await Promise.all([
      admin.from('taxonomy_levels').select('slug, name').in('slug', levelSlugs),
      // Level-leaf rows (Test Preparations, Sports & Games, Holy Quran) have
      // no subject, so this list can legitimately be empty.
      subjectSlugs.length > 0
        ? admin.from('taxonomy_subjects').select('slug, name').in('slug', subjectSlugs)
        : Promise.resolve({ data: [] as { slug: string; name: string }[] }),
    ])

    const levelName = new Map((levels ?? []).map((l) => [l.slug as string, l.name as string]))
    const subjectName = new Map((subjects ?? []).map((s) => [s.slug as string, s.name as string]))

    for (const m of master ?? []) {
      const level = levelName.get(m.level_slug as string) ?? ''
      const subject = m.subject_slug ? subjectName.get(m.subject_slug as string) : null
      labelByMaster.set(m.id as number, subject ? `${level} ${subject}`.trim() : level)
    }
  }

  // Names only when the plan grants it.
  const namesById = new Map<string, string>()
  const avatarById = new Map<string, string | null>()
  if (revealIdentity) {
    const viewerIds = Array.from(
      new Set(rows.map((r) => r.viewer_id as string | null).filter(Boolean) as string[]),
    )
    if (viewerIds.length > 0) {
      const { data: people } = await admin
        .from('profiles')
        .select('id, full_name, avatar_url')
        .in('id', viewerIds)
      for (const p of people ?? []) {
        namesById.set(p.id as string, (p.full_name as string) ?? 'A parent')
        avatarById.set(p.id as string, (p.avatar_url as string) ?? null)
      }
    }
  }

  const teasers: ViewTeaser[] = rows.map((r) => {
    const subject = labelByMaster.get(Number(r.search_subject)) ?? null
    const where = (r.search_area as string) || (r.search_city as string) || null
    const name = r.viewer_id ? namesById.get(r.viewer_id as string) : null

    const who = name ?? (r.viewer_role === 'parent' || r.viewer_role === 'academy' ? 'A parent' : 'Someone')

    const searching = subject ? ` searching ${subject}` : ''
    const place = where ? ` in ${where}` : ''

    return {
      id: r.id as string,
      when: ago(r.created_at as string),
      at: r.created_at as string,
      subject,
      where,
      text: `${who}${searching}${place} viewed your profile`,
      identified: !!name,
      // Only ever populated on the identified branch — see the type.
      avatarUrl: name && r.viewer_id ? (avatarById.get(r.viewer_id as string) ?? null) : null,
    }
  })

  return { teasers, total: count ?? teasers.length }
}

/**
 * The compact card's numbers, in one query alongside the rows.
 *
 * WHAT CHANGED AND WHY. The teaser used to be a list of up to six rows that
 * all said the same shape of thing -- a disc, a sentence, a timestamp -- and
 * on a dashboard whose first band is already a list, it read as more log. The
 * headline is what a tutor actually wants ("25 parents viewed your profile · 3
 * this week"); the detail worth keeping is ONE line of the most recent view,
 * which is the line the spec always described and which the list buried at the
 * top of six near-identical ones.
 *
 * `thisWeek` is a real count over the last seven days, not a slice of the six
 * rows fetched -- a tutor with forty views this week would otherwise be told
 * six.
 */
export type ViewSummary = {
  total: number
  thisWeek: number
  /** The most recent view, for the one-line detail. */
  latest: ViewTeaser | null
  /** 3-5 rows, for the stack of discs. Identity only when the plan grants it. */
  faces: ViewTeaser[]
  /** Every row fetched, for the full list page. */
  teasers: ViewTeaser[]
}

export async function viewSummary(
  tutorId: string,
  revealIdentity: boolean,
  limit = 20,
): Promise<ViewSummary> {
  const { teasers, total } = await viewTeasers(tutorId, revealIdentity, limit)

  let thisWeek = 0
  const admin = createAdminClient()
  if (admin) {
    const since = new Date(Date.now() - 7 * 24 * 3600_000).toISOString()
    const { count } = await admin
      .from('profile_views')
      .select('id', { count: 'exact', head: true })
      .eq('tutor_id', tutorId)
      .gte('created_at', since)
    thisWeek = count ?? 0
  }

  return {
    total,
    thisWeek,
    latest: teasers[0] ?? null,
    // Five is the most that reads as a stack rather than a queue at 40px
    // overlapping by half.
    faces: teasers.slice(0, 5),
    teasers,
  }
}
