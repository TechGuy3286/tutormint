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
import { notify } from '@/lib/notifications'

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

  const position: Position = {
    rank: index + 1,
    total: best.rows.length,
    subjectLabel: (subject?.name as string) ?? (level?.name as string) ?? 'your subject',
    city,
    paidAbove,
  }

  await recordRank(userId, best.masterId, position)

  return position
}

/**
 * Remember where the tutor stood, and tell them when it gets worse.
 *
 * `rank_dropped` has to be a real event, and "real" here means measured
 * against something rather than asserted — so the widget writes one row per
 * tutor every time it runs, and compares against what it wrote last time.
 *
 * FOUR CONDITIONS before anybody is told, and each removes a way of crying
 * wolf:
 *   * the same subject and city, or the comparison is between two different
 *     leaderboards and means nothing;
 *   * a strictly worse rank — equal is not news;
 *   * not the first reading, which has nothing to compare against;
 *   * at most one a day, because a tutor near a boundary can cross it twice in
 *     an afternoon and a notification that fires on noise gets muted.
 *
 * Best-effort throughout: this runs inside a dashboard render, and a dashboard
 * that failed to load because a snapshot could not be written would be a much
 * worse trade than a missed notification.
 */
async function recordRank(userId: string, masterId: number, position: Position): Promise<void> {
  const admin = createAdminClient()
  if (!admin) return

  try {
    const { data: previous } = await admin
      .from('tutor_rank_snapshots')
      .select('master_id, city, rank, updated_at')
      .eq('tutor_id', userId)
      .maybeSingle()

    await admin.from('tutor_rank_snapshots').upsert({
      tutor_id: userId,
      master_id: masterId,
      city: position.city,
      rank: position.rank,
      total: position.total,
      updated_at: new Date().toISOString(),
    })

    if (!previous) return
    if (previous.master_id !== masterId) return
    if ((previous.city ?? null) !== position.city) return
    if (position.rank <= (previous.rank as number)) return

    const dayAgo = new Date(Date.now() - 24 * 3600_000).toISOString()
    const { data: recent } = await admin
      .from('notifications')
      .select('id')
      .eq('user_id', userId)
      .eq('kind', 'rank_dropped')
      .gt('created_at', dayAgo)
      .limit(1)
      .maybeSingle()
    if (recent) return

    await notify({
      userId,
      kind: 'rank_dropped',
      title: `You have dropped to #${position.rank} for ${position.subjectLabel}${
        position.city ? ` in ${position.city}` : ''
      }`,
      body:
        position.paidAbove > 0
          ? `${position.paidAbove} of the ${position.rank - 1} tutors above you are there because they hold a plan.`
          : `You were #${previous.rank} the last time we looked.`,
      href: '/tutor/dashboard#position',
    })
  } catch {
    // See above: never fail a dashboard over a snapshot.
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

export type WeekJob = {
  id: string
  job_tx_id: string | null
  title: string
  city: string | null
  area: string | null
  created_at: string
  /**
   * Why this job is in the strip, in one line: "Matched: Chemistry · same city"
   * or "Matched: Chemistry · online possible". The matching logic is unchanged
   * -- this only names the subject the tutor and the job share and states the
   * location relationship, so a matched card explains itself.
   */
  matchReason: string
}

/** Jobs opened in the last 7 days that match this tutor's subjects. */
export async function jobsThisWeek(userId: string, city: string | null): Promise<WeekJob[]> {
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
    .select('id, job_tx_id, title, city, area, created_at, teaching_mode')
    .in('id', jobIds)
    .eq('status', 'open')
    .gte('created_at', weekAgo)
    .order('created_at', { ascending: false })
    .limit(5)

  if (city) q = q.eq('city', city)

  const { data } = await q
  const rows = (data ?? []) as {
    id: string; job_tx_id: string | null; title: string; city: string | null
    area: string | null; created_at: string; teaching_mode: string | null
  }[]
  if (rows.length === 0) return []

  // Which of THIS tutor's subjects each shown job shares, and the name of one,
  // so the reason line can say what matched. Restricted to the tutor's ids, so
  // it names a shared subject and not just any subject on the job.
  const shownIds = rows.map((r) => r.id)
  const { data: shared } = await db
    .from('job_subjects')
    .select('job_id, master_id')
    .in('job_id', shownIds)
    .in('master_id', ids)

  const sharedMasterByJob = new Map<string, number>()
  for (const s of shared ?? []) {
    if (!sharedMasterByJob.has(s.job_id as string)) {
      sharedMasterByJob.set(s.job_id as string, s.master_id as number)
    }
  }

  // Resolve the shared master ids to subject names (subject, or the level name
  // for level-leaf taxonomy) -- the same resolution the job cards use.
  const masterIds = [...new Set([...sharedMasterByJob.values()])]
  const labelByMaster = new Map<number, string>()
  if (masterIds.length > 0) {
    const { data: master } = await db
      .from('taxonomy_master')
      .select('id, level_slug, subject_slug')
      .in('id', masterIds)
    const levelSlugs = [...new Set((master ?? []).map((m) => m.level_slug as string))]
    const subjectSlugs = [
      ...new Set((master ?? []).map((m) => m.subject_slug as string | null).filter(Boolean) as string[]),
    ]
    const [{ data: levels }, { data: subjects }] = await Promise.all([
      db.from('taxonomy_levels').select('slug, name').in('slug', levelSlugs),
      subjectSlugs.length > 0
        ? db.from('taxonomy_subjects').select('slug, name').in('slug', subjectSlugs)
        : Promise.resolve({ data: [] as { slug: string; name: string }[] }),
    ])
    const levelName = new Map((levels ?? []).map((l) => [l.slug as string, l.name as string]))
    const subjectName = new Map((subjects ?? []).map((s) => [s.slug as string, s.name as string]))
    for (const m of master ?? []) {
      const subject = m.subject_slug ? subjectName.get(m.subject_slug as string) : null
      labelByMaster.set(m.id as number, subject ?? levelName.get(m.level_slug as string) ?? '')
    }
  }

  const norm = (v: string | null | undefined) => (v ?? '').trim().toLowerCase()

  return rows.map((r) => {
    const masterId = sharedMasterByJob.get(r.id)
    const subject = masterId !== undefined ? labelByMaster.get(masterId) : null
    const sameCity = !!city && norm(r.city) !== '' && norm(r.city) === norm(city)
    const onlinePossible = r.teaching_mode === 'online' || r.teaching_mode === 'both'
    const where = sameCity ? 'same city' : onlinePossible ? 'online possible' : null
    const matchReason = subject
      ? `Matched: ${subject}${where ? ` · ${where}` : ''}`
      : where
        ? `Matched · ${where}`
        : 'Matched to your subjects'
    return {
      id: r.id,
      job_tx_id: r.job_tx_id,
      title: r.title,
      city: r.city,
      area: r.area,
      created_at: r.created_at,
      matchReason,
    }
  })
}
