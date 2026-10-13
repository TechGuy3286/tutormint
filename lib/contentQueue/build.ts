// lib/contentQueue/build.ts
//
// The nightly rebuild of the content queue (CLAUDE.md 9.4). Server-only — it
// holds the service key. Each signal is a small function returning candidate
// topics with evidence; rebuildContentQueue() gathers them, de-duplicates
// against posts already written, and upserts under the status rules that make a
// human decision (snooze / dismiss / draft) stick across rebuilds.
//
// THE STATUS RULES, in one place so they cannot drift:
//   new           -> inserted as 'suggested'
//   suggested     -> evidence and priority refreshed
//   snoozed       -> refreshed; back to 'suggested' once snooze_until passes
//   dismissed     -> LEFT dismissed, unless the evidence changed materially
//                    (a different coarse hash), which resurfaces it
//   drafted       -> LEFT (a post was made from it); only last_seen touched
//   gone          -> a 'suggested'/'snoozed' row that is no longer in the queue
//                    is DISMISSED with a reason ("already covered: <post>" or
//                    "auto: not in the current mix") — never deleted. An
//                    automatic dismissal comes back by itself when the topic
//                    is chosen again.
//
// THE QUEUE RULES (owner, 13 Oct 2026) live in ./topics (pure, tested): one
// topic per subject group + city, clean title names, nothing an existing post
// already covers, real search demand first, tutor career at most 40%, spread
// across cities, refilled to 30.

import { pageAll } from '@/lib/pageAll'
import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import { liveCombinationsAll, subjectMetaByMaster, citySegment } from '@/lib/landing'
import { LANDING_THRESHOLD } from '@/lib/landing'
import {
  calendarCandidates,
  evidenceHash,
  gapAgeFactor,
  priorityOf,
  type Candidate,
} from './core'
import { careerCandidates } from './careerTopics'
import { dedupeTitles, gscCandidate } from './mix'
import {
  chooseQueue,
  cityGuideCandidate,
  coveredByPost,
  groupTopics,
  topicCandidate,
  urduCandidates,
  QUEUE_SIZE,
  type ExistingPost,
  type TopicSignal,
} from './topics'
import { fetchSearchConsoleRows, searchConsoleConfigured, GSC_SITE_URL } from './gsc'

type Admin = NonNullable<ReturnType<typeof createAdminClient>>

// How many site searches in 30 days make a subject worth a post / a recruit.
const RECRUIT_SEARCH_MIN = 8
// A landing page with this many listed tutors and no post is a coverage gap.
// This many open reports of one reason in the window is a trust-topic signal.
const REPORT_MIN = 3

// -------------------------------------------------------- search gaps -------

/** Staff "title name" overrides for levels and subjects (migration 168). Empty
 *  before the migration, or on any read error. */
async function titleNames(admin: Admin): Promise<{ level: Map<string, string>; subject: Map<string, string> }> {
  const level = new Map<string, string>()
  const subject = new Map<string, string>()
  try {
    const [l, s] = await Promise.all([
      admin.from('taxonomy_levels').select('name, title_name').not('title_name', 'is', null),
      admin.from('taxonomy_subjects').select('name, title_name').not('title_name', 'is', null),
    ])
    for (const r of l.data ?? []) if ((r.title_name as string | null)?.trim()) level.set((r.name as string).toLowerCase(), (r.title_name as string).trim())
    for (const r of s.data ?? []) if ((r.title_name as string | null)?.trim()) subject.set((r.name as string).toLowerCase(), (r.title_name as string).trim())
  } catch {
    /* no overrides */
  }
  return { level, subject }
}

/**
 * What people search for on the site vs what we list, as TOPIC SIGNALS — one
 * per taxonomy level × subject × city — which ./topics folds into one topic per
 * subject GROUP and city. Three sources:
 *   • the collapsed search_performed events over 30 days (no free-text query is
 *     ever stored) and the anonymous search log;
 *   • unmet searches (found nothing) that named a subject and a city;
 *   • every city × subject with listed tutors — no demand of its own, so it
 *     only ever breaks a tie.
 * Also emits the recruitment cards (searches are there, tutors are not).
 */
async function topicSignals(admin: Admin): Promise<{ signals: TopicSignal[]; recruitment: Candidate[] }> {
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString()

  const [members, anon, unmet, names] = await Promise.all([
    pageAll((from, to) =>
      admin.from('user_activity_log').select('id, meta').eq('event', 'search_performed').gte('created_at', since).order('id').range(from, to),
    ),
    pageAll((from, to) =>
      admin.from('anon_search_events').select('id, surface, master_id, city').eq('surface', 'tutors').gte('created_at', since).order('id').range(from, to),
    ),
    pageAll((from, to) =>
      admin.from('search_unmet').select('id, city, subject, level, role, is_test').gte('created_at', since).order('id').range(from, to),
    ).catch(() => []),
    titleNames(admin),
  ])

  const counts = new Map<string, { masterId: number; city: string; n: number }>()
  const tally = (masterId: number, cityRaw: unknown) => {
    const city = typeof cityRaw === 'string' ? cityRaw.trim() : ''
    if (!masterId || !city) return
    const key = `${masterId}::${city.toLowerCase()}`
    const cur = counts.get(key) ?? { masterId, city, n: 0 }
    cur.n += 1
    counts.set(key, cur)
  }
  for (const row of members ?? []) {
    const meta = (row.meta ?? {}) as Record<string, unknown>
    if (meta.surface !== 'tutors') continue
    tally(Number(meta.master_id), meta.city)
  }
  for (const row of anon ?? []) {
    tally(Number((row as { master_id: unknown }).master_id), (row as { city: unknown }).city)
  }

  const [byMaster, combos] = await Promise.all([subjectMetaByMaster(), liveCombinationsAll()])
  const tutorCountFor = new Map<string, number>()
  for (const c of combos) {
    if (c.kind === 'tutors') tutorCountFor.set(`${c.masterId}::${c.citySlug}`, c.count)
  }

  const signals: TopicSignal[] = []
  const recruitment: Candidate[] = []
  const signal = (level: string, subject: string, city: string, searches: number, tutors: number) =>
    signals.push({
      level,
      subject,
      city,
      searches,
      tutors,
      levelTitle: names.level.get(level.toLowerCase()) ?? null,
      subjectTitle: names.subject.get(subject.toLowerCase()) ?? null,
    })

  const searched = new Set<string>()
  for (const { masterId, city, n } of counts.values()) {
    const meta = byMaster.get(masterId)
    if (!meta || !meta.subject) continue
    const citySlug = citySegment(city)
    const tutors = tutorCountFor.get(`${masterId}::${citySlug}`) ?? 0
    searched.add(`${masterId}::${citySlug}`)
    signal(meta.level, meta.subject, city, n, tutors)

    if (n >= RECRUIT_SEARCH_MIN && tutors < LANDING_THRESHOLD) {
      recruitment.push({
        fingerprint: `recruit:${masterId}:${citySlug}`,
        card: 'recruitment',
        source: 'recruitment',
        title: `${city}: ${n} searches for ${meta.name}, ${tutors} tutor${tutors === 1 ? '' : 's'}`,
        cluster: null,
        audience: 'both',
        language: 'en',
        components: { demand: n, rankProximity: 1, seasonality: 1, gapAge: 1 },
        evidence: [
          `${n} searches for ${meta.name} in ${city}, only ${tutors} listed tutor${tutors === 1 ? '' : 's'}.`,
          `Recruit tutors for this subject and city — a landing page needs ${LANDING_THRESHOLD}.`,
        ],
        evidenceKey: { searches: n, tutors },
        notes: '',
      })
    }
  }

  // Unmet searches that named a subject and a city (staff and test searches left out).
  for (const u of (unmet ?? []) as { city: string | null; subject: string | null; level: string | null; role: string | null; is_test: boolean | null }[]) {
    if (!u.city || !u.subject || u.is_test || u.role === 'admin') continue
    signal(u.level ?? '', u.subject, u.city, 1, 0)
  }

  // Listed tutors with no search behind them: tie-breakers only.
  for (const c of combos) {
    if (c.kind !== 'tutors' || c.count < LANDING_THRESHOLD) continue
    if (searched.has(`${c.masterId}::${c.citySlug}`)) continue
    const meta = byMaster.get(c.masterId)
    if (!meta || !meta.subject) continue
    signal(meta.level, meta.subject, c.city, 0, c.count)
  }

  return { signals, recruitment }
}

/** One City guides topic per city that has open tuitions. */
async function cityGuideCandidates(admin: Admin): Promise<Candidate[]> {
  const [jobs, tutors] = await Promise.all([
    pageAll((from, to) => admin.from('jobs').select('id, city').eq('status', 'open').order('id').range(from, to)),
    pageAll((from, to) => admin.from('tutor_directory').select('id, city').order('id').range(from, to)).catch(() => []),
  ])
  const open = new Map<string, { city: string; n: number }>()
  for (const j of jobs as { city: string | null }[]) {
    const city = (j.city ?? '').trim()
    if (!city) continue
    const cur = open.get(city.toLowerCase()) ?? { city, n: 0 }
    cur.n++
    open.set(city.toLowerCase(), cur)
  }
  const listed = new Map<string, number>()
  for (const t of tutors as { city: string | null }[]) {
    const k = (t.city ?? '').trim().toLowerCase()
    if (k) listed.set(k, (listed.get(k) ?? 0) + 1)
  }
  return [...open.entries()].filter(([, v]) => v.n >= LANDING_THRESHOLD).map(([k, v]) => cityGuideCandidate(v.city, v.n, listed.get(k) ?? 0))
}


const REASON_TOPIC: Record<string, { label: string; title: string; notes: string }> = {
  off_platform_payment: {
    label: 'paying outside TutorMint',
    title: 'Why you should never pay a tutor outside TutorMint',
    notes:
      'Some users are being asked to pay outside the platform. Explain why paying off-platform is risky, that TutorMint takes no commission so there is no reason to, and how to report a request to pay outside.',
  },
  fake_profile: {
    label: 'fake or impersonated profiles',
    title: 'How TutorMint verifies tutors — and how to spot a fake',
    notes:
      'Explain how tutor verification works on TutorMint (the Verification Fee plus CNIC, profile photo and selfie; degree and video optional) and the signs of a fake profile, so parents know what a verified tutor means.',
  },
  harassment: {
    label: 'harassment or abuse',
    title: 'Staying safe: blocking, reporting and what happens next',
    notes:
      'Explain how blocking and reporting work on TutorMint, what the team does with a report, and how contact details stay private until a parent chooses to share them.',
  },
  spam: {
    label: 'spam or advertising',
    title: 'Keeping messages useful: how TutorMint handles spam',
    notes:
      'Explain how TutorMint keeps messaging free of spam and advertising, and how to report a message that is not a genuine enquiry.',
  },
}

/** Open report reasons clustered — a trust topic parents are running into. */
async function reportCandidates(admin: Admin): Promise<Candidate[]> {
  const since = new Date(Date.now() - 60 * 86_400_000).toISOString()
  const data = await pageAll((from, to) => admin.from('reports').select('id, reason').gte('created_at', since).order('id').range(from, to))

  const counts = new Map<string, number>()
  for (const r of data ?? []) {
    const reason = r.reason as string
    if (!REASON_TOPIC[reason]) continue
    counts.set(reason, (counts.get(reason) ?? 0) + 1)
  }

  const out: Candidate[] = []
  for (const [reason, n] of counts) {
    if (n < REPORT_MIN) continue
    const t = REASON_TOPIC[reason]
    out.push({
      fingerprint: `reports:${reason}`,
      card: 'content',
      source: 'reports',
      title: t.title,
      cluster: 'safety-trust',
      audience: 'both',
      language: 'en',
      components: { demand: n * 3, rankProximity: 1, seasonality: 1, gapAge: 1 },
      evidence: [`${n} reports about ${t.label} in the last 60 days.`],
      evidenceKey: { reports: n },
      notes: t.notes,
    })
  }
  return out
}

// ------------------------------------------------------ Search Console --------

/**
 * GSC positions 8–20 are a strong signal — a page one nudge from page one. It
 * runs with the SAME service account the Indexing API uses (owner, 6 Oct 2026),
 * under the read-only Search Console scope (lib/contentQueue/gsc). It never
 * fabricates data: no credentials or a failed read -> no GSC candidates, the
 * queue keeps its other sources, and the failure is logged once.
 */
export function searchConsoleStatus(): { connected: boolean; steps: string[] } {
  const connected = searchConsoleConfigured()
  return {
    connected,
    steps: [
      `Search Console property: ${GSC_SITE_URL} (owner-verified).`,
      'The Google service account used for the Indexing API (GOOGLE_INDEXING_CLIENT_EMAIL / GOOGLE_INDEXING_PRIVATE_KEY in Vercel) must be an owner or full user of that property.',
      'Enable the "Google Search Console API" for the same Google Cloud project.',
      'The nightly rebuild (and "Rebuild now") then reads the last 28 days of queries; positions 8–20 feed the queue.',
    ],
  }
}

let loggedGscFailure = false

/** Search Console page-two queries as candidates; empty (and logged ONCE) when
 *  Search Console is not configured or the read fails. */
async function gscCandidates(cities: string[]): Promise<Candidate[]> {
  if (!searchConsoleConfigured()) return []
  try {
    const rows = await fetchSearchConsoleRows(28)
    return rows.map((r) => gscCandidate(r, cities)).filter((c): c is Candidate => !!c)
  } catch (e) {
    if (!loggedGscFailure) {
      loggedGscFailure = true
      console.warn('[contentQueue] Search Console unavailable — queue built from the other sources:', e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200))
    }
    return []
  }
}

/** The live city and subject NAME lists the dedupe skeleton strips. */
async function nameLists(admin: Admin): Promise<{ cities: string[]; subjects: string[] }> {
  const [c, s] = await Promise.all([
    admin.from('location_cities').select('name').limit(500),
    pageAll((from, to) => admin.from('taxonomy_subjects').select('slug, name').order('slug').range(from, to)).then((data) => ({ data })),
  ])
  return {
    cities: (c.data ?? []).map((r) => r.name as string).filter(Boolean),
    subjects: (s.data ?? []).map((r) => r.name as string).filter(Boolean),
  }
}

// ------------------------------------------------------- the rebuild --------

export type RebuildResult = {
  candidates: number
  inserted: number
  updated: number
  resurfaced: number
  /** Kept for callers that read it: rows are no longer deleted, so always 0. */
  pruned: number
  /** Open suggestions dismissed because an existing post already covers them. */
  covered: number
  /** Open suggestions set aside because they are not in the current mix. */
  setAside: number
  /** Content suggestions visible after this run. */
  visible: number
  errors: string[]
}

/** A dismissal the queue made by itself — it comes back when the topic is chosen again. */
const AUTO_DISMISS = 'auto: not in the current mix'
const COVERED_PREFIX = 'already covered'
const isAutoDismissal = (reason: unknown) => typeof reason === 'string' && (reason.startsWith('auto:') || reason.startsWith(COVERED_PREFIX))

export async function rebuildContentQueue(now = new Date()): Promise<RebuildResult> {
  const errors: string[] = []
  const admin = createAdminClient()
  const none = { candidates: 0, inserted: 0, updated: 0, resurfaced: 0, pruned: 0, covered: 0, setAside: 0, visible: 0 }
  if (!admin) return { ...none, errors: ['no service-role client'] }

  // --- gather ---------------------------------------------------------------
  const content: Candidate[] = []
  const recruitment: Candidate[] = []
  try {
    const t = await topicSignals(admin)
    content.push(...groupTopics(t.signals).map(topicCandidate))
    recruitment.push(...t.recruitment)
  } catch (e) {
    errors.push(`topics: ${String(e)}`)
  }
  for (const [name, fn] of [
    ['reports', () => reportCandidates(admin)],
    ['city guides', () => cityGuideCandidates(admin)],
  ] as const) {
    try {
      content.push(...(await fn()))
    } catch (e) {
      errors.push(`${name}: ${String(e)}`)
    }
  }
  content.push(...calendarCandidates(now))
  const names = await nameLists(admin)
  // Search Console page-two queries (empty when it is not configured or fails).
  content.push(...(await gscCandidates(names.cities)))
  // Evergreen tutor-career topics — at most 40% of the visible queue.
  content.push(...careerCandidates())
  content.push(...urduCandidates())

  const existingRows = await pageAll((from, to) => admin.from('content_suggestions').select('*').order('id').range(from, to))
  const byFp = new Map((existingRows ?? []).map((r) => [r.fingerprint as string, r]))

  // --- nothing an existing post already covers --------------------------------
  // Every post that exists — published, scheduled or draft.
  const postRows = (await pageAll((from, to) => admin.from('posts').select('id, title, status, cluster, city, subject').order('id').range(from, to))) as {
    title: string
    status: string
    cluster: string | null
    city: string | null
    subject: string | null
  }[]
  const posts: ExistingPost[] = postRows.map((p) => ({ title: p.title, status: p.status, cluster: p.cluster, city: p.city, subject: p.subject }))
  const coveredBy = new Map<string, string>()
  const uncovered: Candidate[] = []
  const seenFp = new Set<string>()
  for (const c of content) {
    if (seenFp.has(c.fingerprint)) continue
    seenFp.add(c.fingerprint)
    const post = coveredByPost(c, posts)
    if (post) coveredBy.set(c.fingerprint, post.title)
    else uncovered.push(c)
  }

  // Titles that differ from another only by city, grade or subject (Search
  // Console, calendar, reports, career). Grouped topics are one per subject
  // group + city by construction and rotate their wording, so they skip this.
  const isTopic = (c: Candidate) => c.fingerprint.startsWith('topic:') || c.fingerprint.startsWith('cityguide:')
  const loose = uncovered.filter((c) => !isTopic(c)).sort((a, b) => priorityOf(b.components) - priorityOf(a.components))
  const looseKept = dedupeTitles(
    loose,
    (existingRows ?? []).filter((r) => !isAutoDismissal(r.dismiss_reason)).map((r) => ({ title: r.title as string, fingerprint: r.fingerprint as string })),
    names.cities,
    names.subjects,
  )
  const eligible = [...uncovered.filter(isTopic), ...looseKept]

  // A human decision stands: a drafted topic, a topic still snoozed, and a
  // topic staff dismissed (unless its evidence changed materially) are not
  // offered again, so they do not take a place in the visible queue.
  const open = eligible.filter((c) => {
    const ex = byFp.get(c.fingerprint)
    if (!ex) return true
    const status = ex.status as string
    if (status === 'drafted') return false
    if (status === 'snoozed') return !!ex.snooze_until && new Date(ex.snooze_until as string) <= now
    if (status === 'dismissed') return isAutoDismissal(ex.dismiss_reason) || evidenceHash(c.evidenceKey) !== (ex.evidence_hash as string)
    return true
  })

  // --- the visible queue -------------------------------------------------------
  const live = posts.filter((p) => p.status !== 'unpublished')
  const emptyClusters = ['city-guides', 'urdu'].filter((cl) => !live.some((p) => p.cluster === cl))
  const visible = chooseQueue(open, { size: QUEUE_SIZE, emptyClusters })
  const candidates: Candidate[] = [...visible, ...recruitment]

  const seen = new Set<string>()
  let inserted = 0
  let updated = 0
  let resurfaced = 0

  for (const c of candidates) {
    if (seen.has(c.fingerprint)) continue // a fingerprint can only appear once
    seen.add(c.fingerprint)

    const ex = byFp.get(c.fingerprint)
    const firstSeen = ex ? new Date(ex.first_seen_at as string) : now
    const components = { ...c.components, gapAge: gapAgeFactor(firstSeen, now) }
    const priority = priorityOf(components)
    const hash = evidenceHash(c.evidenceKey)
    const nowIso = now.toISOString()

    const fields = {
      card: c.card,
      source: c.source,
      title: c.title,
      cluster: c.cluster,
      audience: c.audience,
      language: c.language,
      priority,
      priority_components: components,
      evidence: c.evidence,
      evidence_key: c.evidenceKey,
      notes: c.notes,
      last_seen_at: nowIso,
      updated_at: nowIso,
    }

    if (!ex) {
      const { error } = await admin.from('content_suggestions').insert({
        fingerprint: c.fingerprint,
        ...fields,
        evidence_hash: hash,
        status: 'suggested',
        first_seen_at: nowIso,
      })
      if (error) errors.push(`insert ${c.fingerprint}: ${error.message}`)
      else inserted++
      continue
    }

    const status = ex.status as string
    if (status === 'drafted') {
      await admin.from('content_suggestions').update({ last_seen_at: nowIso }).eq('id', ex.id)
      continue
    }
    if (status === 'dismissed') {
      // Dismissed stays dismissed, unless the evidence changed materially — or
      // the queue itself set it aside, in which case being chosen brings it back.
      if (hash !== (ex.evidence_hash as string) || isAutoDismissal(ex.dismiss_reason)) {
        const { error } = await admin
          .from('content_suggestions')
          .update({ ...fields, evidence_hash: hash, status: 'suggested', dismiss_reason: null })
          .eq('id', ex.id)
        if (error) errors.push(`resurface ${c.fingerprint}: ${error.message}`)
        else resurfaced++
      } else {
        await admin.from('content_suggestions').update({ last_seen_at: nowIso }).eq('id', ex.id)
      }
      continue
    }

    // suggested, or a snooze that has woken.
    const wake = status === 'snoozed' && ex.snooze_until && new Date(ex.snooze_until as string) <= now
    const { error } = await admin
      .from('content_suggestions')
      .update({ ...fields, evidence_hash: hash, status: wake ? 'suggested' : status })
      .eq('id', ex.id)
    if (error) errors.push(`update ${c.fingerprint}: ${error.message}`)
    else updated++
  }

  // --- everything else that was open leaves the queue — dismissed, never deleted
  let covered = 0
  let setAside = 0
  const nowIso = now.toISOString()
  for (const r of existingRows ?? []) {
    const fp = r.fingerprint as string
    if (!['suggested', 'snoozed'].includes(r.status as string) || seen.has(fp)) continue
    // A topic staff snoozed and that is still a candidate keeps its snooze.
    if (r.status === 'snoozed' && eligible.some((c) => c.fingerprint === fp)) continue
    // An open row whose own title an existing post covers (rows made before
    // these rules have fingerprints the new candidates do not share).
    const post = coveredBy.get(fp) ?? (r.card === 'content' ? coveredByPost({ title: r.title as string, cluster: (r.cluster as string | null) ?? null }, posts)?.title : undefined)
    const reason = post ? `${COVERED_PREFIX}: ${post}`.slice(0, 300) : AUTO_DISMISS
    const { error } = await admin.from('content_suggestions').update({ status: 'dismissed', dismiss_reason: reason, updated_at: nowIso }).eq('id', r.id)
    if (error) errors.push(`dismiss ${fp}: ${error.message}`)
    else if (post) covered++
    else setAside++
  }

  return { candidates: candidates.length, inserted, updated, resurfaced, pruned: 0, covered, setAside, visible: visible.length, errors }
}
