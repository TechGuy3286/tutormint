// lib/funnel.ts
//
// The data behind the 199 funnel (CLAUDE.md, "Conversion rules").
//
// Every function here answers a question the tutor already wants answered --
// who looked at me, where do I rank, what work is there this week, is anyone
// actually getting hired. None of them returns a price. That separation is the
// rule, not a coincidence: the surfaces show the tutor something they want,
// and the price appears only when they reach for it, through the upgrade sheet
// or a packages page they chose to open.

import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

export type Position = {
  /** 1-based rank among listed tutors for this subject and city. */
  rank: number
  total: number
  subjectLabel: string
  city: string | null
  /** How many of the tutors above them are there because they paid. */
  paidAbove: number
}

/**
 * Where this tutor sits for their main subject in their city.
 *
 * "Main subject" is simply their first taxonomy row: a tutor who teaches three
 * things does not have a favourite the database knows about, and asking them to
 * nominate one would be a settings screen nobody opens.
 *
 * Returns null rather than a fake rank when there is nothing to rank against --
 * a tutor with no subjects, or the only tutor for a subject, learns nothing
 * from "#1 of 1" and it reads as mockery.
 */
export async function tutorPosition(userId: string): Promise<Position | null> {
  const db = createAdminClient() ?? (await createClient())

  const { data: me } = await db
    .from('tutor_directory')
    .select('id, city')
    .eq('id', userId)
    .maybeSingle()
  if (!me) return null
  const city = (me.city as string | null) ?? null

  const { data: mine } = await db
    .from('tutor_subjects')
    .select('master_id')
    .eq('tutor_id', userId)
    .limit(5)

  const masterIds = (mine ?? []).map((m) => m.master_id as number)
  if (masterIds.length === 0) return null

  // The subject with the LARGEST pool wins, not the first one stored.
  //
  // A tutor's first taxonomy row is an arbitrary choice the database made, and
  // it is often something niche they are the only person teaching -- which
  // produces "#1 of 1", a number that tells them nothing and reads as mockery.
  // The subject with real competition is both the honest one to report and the
  // one where being outranked actually costs them work.
  let best: { rows: { id: string; plan_code: string | null }[]; masterId: number } | null = null

  for (const masterId of masterIds) {
    // City first: a parent in Lahore is not choosing between Lahore and Quetta.
    // Falling back to nationwide keeps the widget useful for a tutor who is
    // simply alone in their own city.
    for (const scope of [city, null]) {
      const { data } = await db.rpc('rank_tutors', {
        p_master_id: masterId,
        p_city: scope,
        p_limit: 200,
        p_offset: 0,
      })
      const rows = (data ?? []) as { id: string; plan_code: string | null }[]
      if (rows.length >= 2 && rows.some((r) => r.id === userId)) {
        if (!best || rows.length > best.rows.length) best = { rows, masterId }
        break
      }
    }
  }

  if (!best) return null

  const index = best.rows.findIndex((r) => r.id === userId)
  const paidAbove = best.rows.slice(0, index).filter((r) => !!r.plan_code).length

  const { data: label } = await db
    .from('taxonomy_master')
    .select('subject_slug, level_slug')
    .eq('id', best.masterId)
    .maybeSingle()

  const { data: subject } = label?.subject_slug
    ? await db.from('taxonomy_subjects').select('name').eq('slug', label.subject_slug).maybeSingle()
    : { data: null }
  const { data: level } = label?.level_slug
    ? await db.from('taxonomy_levels').select('name').eq('slug', label.level_slug).maybeSingle()
    : { data: null }

  return {
    rank: index + 1,
    total: best.rows.length,
    subjectLabel: (subject?.name as string) ?? (level?.name as string) ?? 'your subject',
    city,
    paidAbove,
  }
}

/**
 * Hires completed this calendar month, platform-wide.
 *
 * Live social proof for the packages page. Counted from real hires, so it
 * cannot drift from reality the way a hand-maintained number would. Returns 0
 * honestly when there have been none -- the caller hides the line rather than
 * rounding a zero up into a claim.
 */
export async function hiresThisMonth(): Promise<number> {
  const db = createAdminClient() ?? (await createClient())
  const start = new Date()
  start.setUTCDate(1)
  start.setUTCHours(0, 0, 0, 0)

  // Counted from jobs.hired_at, not from applications: `applications` has no
  // updated_at, so the moment of hire is only recorded on the job. Using the
  // application row would have meant counting every hire ever made and calling
  // it this month's.
  const { count } = await db
    .from('jobs')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'hired')
    .not('hired_tutor_id', 'is', null)
    .gte('hired_at', start.toISOString())

  return count ?? 0
}

/** Jobs opened in the last 7 days that match this tutor's subjects. */
export async function jobsThisWeek(
  userId: string,
  city: string | null,
): Promise<{ id: string; job_tx_id: string | null; title: string; city: string | null; area: string | null; created_at: string }[]> {
  const db = createAdminClient() ?? (await createClient())

  const { data: subs } = await db.from('tutor_subjects').select('master_id').eq('tutor_id', userId)
  const ids = (subs ?? []).map((s) => s.master_id as number)
  if (ids.length === 0) return []

  const { data: js } = await db.from('job_subjects').select('job_id').in('master_id', ids)
  const jobIds = [...new Set((js ?? []).map((j) => j.job_id as string))]
  if (jobIds.length === 0) return []

  const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString()

  let q = db
    .from('jobs')
    .select('id, job_tx_id, title, city, area, created_at')
    .in('id', jobIds)
    .eq('status', 'open')
    .gte('created_at', weekAgo)
    .order('created_at', { ascending: false })
    .limit(5)

  if (city) q = q.eq('city', city)

  const { data } = await q
  return (data ?? []) as never
}
