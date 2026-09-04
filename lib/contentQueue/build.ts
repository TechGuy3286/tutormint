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
//   gone          -> a 'suggested'/'snoozed' row whose evidence has vanished is
//                    deleted, so the queue reflects current reality

import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import { liveCombinationsAll, liveLandingPages, subjectMetaByMaster, citySegment } from '@/lib/landing'
import { LANDING_THRESHOLD } from '@/lib/landing'
import {
  calendarCandidates,
  evidenceHash,
  gapAgeFactor,
  landingPath,
  priorityOf,
  type Candidate,
} from './core'

type Admin = NonNullable<ReturnType<typeof createAdminClient>>

// How many site searches in 30 days make a subject worth a post / a recruit.
const SEARCH_CONTENT_MIN = 5
const RECRUIT_SEARCH_MIN = 8
// A landing page with this many listed tutors and no post is a coverage gap.
const COVERAGE_MIN_TUTORS = 10
// This many open reports of one reason in the window is a trust-topic signal.
const REPORT_MIN = 3

// -------------------------------------------------------- search gaps -------

/**
 * What people search for on the site vs what we list. Reads the collapsed
 * search_performed events (no free-text query is ever stored) over 30 days,
 * grouped by subject x city, and pairs each with the tutors listed for it now.
 * Emits a content topic, and — when the searches are there but the tutors are
 * not — a recruitment card for the import manager.
 */
async function searchGapCandidates(admin: Admin, covered: Set<string>): Promise<Candidate[]> {
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString()
  const { data } = await admin
    .from('user_activity_log')
    .select('meta')
    .eq('event', 'search_performed')
    .gte('created_at', since)
    .limit(5000)

  // Count searches per (master_id, city), tutors surface only.
  const counts = new Map<string, { masterId: number; city: string; n: number }>()
  for (const row of data ?? []) {
    const meta = (row.meta ?? {}) as Record<string, unknown>
    if (meta.surface !== 'tutors') continue
    const masterId = Number(meta.master_id)
    const city = typeof meta.city === 'string' ? meta.city.trim() : ''
    if (!masterId || !city) continue
    const key = `${masterId}::${city.toLowerCase()}`
    const cur = counts.get(key) ?? { masterId, city, n: 0 }
    cur.n += 1
    counts.set(key, cur)
  }

  const [byMaster, combos] = await Promise.all([subjectMetaByMaster(), liveCombinationsAll()])
  const tutorCountFor = new Map<string, number>()
  for (const c of combos) {
    if (c.kind === 'tutors') tutorCountFor.set(`${c.masterId}::${c.citySlug}`, c.count)
  }

  const out: Candidate[] = []
  for (const { masterId, city, n } of counts.values()) {
    if (n < SEARCH_CONTENT_MIN) continue
    const meta = byMaster.get(masterId)
    if (!meta) continue
    const citySlug = citySegment(city)
    const tutors = tutorCountFor.get(`${masterId}::${citySlug}`) ?? 0
    const path = landingPath('tutors', citySlug, meta.slug)

    // Content topic — unless a published post already links to this directory.
    if (!covered.has(path)) {
      const proximity = tutors >= LANDING_THRESHOLD ? 1.5 : tutors > 0 ? 1.2 : 1
      out.push({
        fingerprint: `search:tutors:${masterId}:${citySlug}`,
        card: 'content',
        source: 'search_gap',
        title: `${meta.name} tutors in ${city}: fees and how to choose`,
        cluster: 'cost-hiring',
        audience: 'parents',
        language: 'en',
        components: { demand: n, rankProximity: proximity, seasonality: 1, gapAge: 1 },
        evidence: [
          `${n} searches for ${meta.name} in ${city} in the last 30 days.`,
          `${tutors} listed tutor${tutors === 1 ? '' : 's'} match this right now.`,
        ],
        evidenceKey: { searches: n, tutors },
        notes: `Parents in ${city} are searching for ${meta.name} tutors — about ${n} searches in the last 30 days, with ${tutors} tutors currently listed. Write a practical guide: typical monthly fees, how to choose a good tutor, in-person vs online. Do not present internal search counts as published statistics.`,
      })
    }

    // Recruitment gap — many searches, too few tutors to rank. Routed to import.
    if (n >= RECRUIT_SEARCH_MIN && tutors < LANDING_THRESHOLD) {
      out.push({
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
  return out
}

// ------------------------------------------------------- coverage gaps ------

/**
 * A live landing page with plenty of listed tutors and no post linking to it —
 * a page we can already rank, waiting for the article that would send it links.
 */
async function coverageGapCandidates(admin: Admin, covered: Set<string>): Promise<Candidate[]> {
  const pages = await liveLandingPages()
  const out: Candidate[] = []
  for (const p of pages) {
    if (p.kind !== 'tutors' || p.count < COVERAGE_MIN_TUTORS) continue
    const path = landingPath('tutors', p.citySlug, p.subjectSlug)
    if (covered.has(path)) continue
    out.push({
      fingerprint: `coverage:${path}`,
      card: 'content',
      source: 'coverage_gap',
      title: `${p.subjectName} tutors in ${p.city}: a complete guide`,
      cluster: 'subject-guides',
      audience: 'parents',
      language: 'en',
      components: { demand: p.count, rankProximity: 2, seasonality: 1, gapAge: 1 },
      evidence: [
        `${p.count} listed ${p.subjectName} tutors in ${p.city}.`,
        'No blog post links to this directory page yet.',
      ],
      evidenceKey: { tutors: p.count },
      notes: `There are ${p.count} listed ${p.subjectName} tutors in ${p.city}, but no blog post links to that directory page. Write a guide for parents and link to it. Cover typical fees, how to choose, and exam boards where relevant.`,
    })
  }
  return out
}

// --------------------------------------------------- what people ask --------

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
      'Explain how tutor verification works on TutorMint (identity, degree, video review) and the signs of a fake profile, so parents know what a verified tutor means.',
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
  const { data } = await admin
    .from('reports')
    .select('reason')
    .gte('created_at', since)
    .limit(2000)

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

// ------------------------------------------------- Search Console (dormant) --

/**
 * GSC positions 8–20 would be a strong signal — a page one nudge from page one.
 * The module and its settings screen exist; it is DORMANT until credentials
 * exist. It never fabricates data: no key -> no candidates and a "Not connected"
 * status with the steps, never a made-up query list.
 */
export function searchConsoleStatus(): { connected: boolean; steps: string[] } {
  const connected = !!process.env.GSC_SERVICE_ACCOUNT_JSON && !!process.env.GSC_SITE_URL
  return {
    connected,
    steps: [
      'Create a Google Search Console property for tutormint.org and verify it.',
      'Create a Google Cloud service account, enable the Search Console API, and grant the service account read access to the property.',
      'Set GSC_SERVICE_ACCOUNT_JSON (the service-account key) and GSC_SITE_URL in the server environment.',
      'This screen turns on and positions 8–20 begin feeding the queue.',
    ],
  }
}

// ------------------------------------------------------- the rebuild --------

export type RebuildResult = {
  candidates: number
  inserted: number
  updated: number
  resurfaced: number
  pruned: number
  errors: string[]
}

/** The set of landing paths a published post already links to. */
async function coveredPaths(admin: Admin): Promise<Set<string>> {
  const { data } = await admin
    .from('posts')
    .select('related_landing_pages')
    .eq('status', 'published')
    .limit(2000)
  const set = new Set<string>()
  for (const row of data ?? []) {
    for (const p of (row.related_landing_pages as string[] | null) ?? []) {
      set.add(p.replace(/^\//, ''))
    }
  }
  return set
}

export async function rebuildContentQueue(now = new Date()): Promise<RebuildResult> {
  const errors: string[] = []
  const admin = createAdminClient()
  if (!admin) return { candidates: 0, inserted: 0, updated: 0, resurfaced: 0, pruned: 0, errors: ['no service-role client'] }

  const covered = await coveredPaths(admin)

  const candidates: Candidate[] = []
  for (const [name, fn] of [
    ['search', () => searchGapCandidates(admin, covered)],
    ['coverage', () => coverageGapCandidates(admin, covered)],
    ['reports', () => reportCandidates(admin)],
  ] as const) {
    try {
      candidates.push(...(await fn()))
    } catch (e) {
      errors.push(`${name}: ${String(e)}`)
    }
  }
  candidates.push(...calendarCandidates(now))

  const { data: existingRows } = await admin.from('content_suggestions').select('*').limit(5000)
  const byFp = new Map((existingRows ?? []).map((r) => [r.fingerprint as string, r]))
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
      if (hash !== (ex.evidence_hash as string)) {
        // Material change: resurface, and adopt the new evidence + hash.
        const { error } = await admin
          .from('content_suggestions')
          .update({ ...fields, evidence_hash: hash, status: 'suggested', dismiss_reason: null })
          .eq('id', ex.id)
        if (error) errors.push(`resurface ${c.fingerprint}: ${error.message}`)
        else resurfaced++
      } else {
        // Stay dismissed; do NOT touch the frozen hash the next change compares to.
        await admin.from('content_suggestions').update({ last_seen_at: nowIso }).eq('id', ex.id)
      }
      continue
    }

    // suggested or snoozed: refresh, waking a snooze whose time has come.
    const wake =
      status === 'snoozed' && ex.snooze_until && new Date(ex.snooze_until as string) <= now
    const { error } = await admin
      .from('content_suggestions')
      .update({ ...fields, evidence_hash: hash, status: wake ? 'suggested' : status })
      .eq('id', ex.id)
    if (error) errors.push(`update ${c.fingerprint}: ${error.message}`)
    else updated++
  }

  // Prune suggested/snoozed rows whose evidence has vanished. Dismissed and
  // drafted are decisions and are kept.
  const stale = (existingRows ?? [])
    .filter((r) => ['suggested', 'snoozed'].includes(r.status as string) && !seen.has(r.fingerprint as string))
    .map((r) => r.id as string)
  let pruned = 0
  if (stale.length > 0) {
    const { error } = await admin.from('content_suggestions').delete().in('id', stale)
    if (error) errors.push(`prune: ${error.message}`)
    else pruned = stale.length
  }

  return { candidates: candidates.length, inserted, updated, resurfaced, pruned, errors }
}
