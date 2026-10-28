// lib/contentQueue/searchTopics.ts
//
// Content topics built from REAL Google searches (owner, 28 Oct 2026). Pure — no
// database, no server-only import — so the queue rebuild, the Content queue
// page, the weekly email and scripts/test-search-topics.ts read the same rules.
//
//   • Only queries with at least MIN_IMPRESSIONS impressions in the last 28 days
//     (summed when Google returns the same query more than once). Branded
//     searches ("tutormint", "tutor mint") are not topics.
//   • Near-duplicates are grouped. A tutor-side search (jobs, tuition jobs,
//     teaching jobs, vacancies…) groups by WHERE and WHAT KIND — city, area,
//     female, online, school — so "jobs in lahore for female" and "female
//     teaching jobs lahore" are one topic. A parent-side search groups by its
//     meaningful words, in any order.
//   • Tutor-side topics come first, then by searches (impressions), then clicks.
//   • A topic an existing page or post already answers is "Already covered by
//     <page>" — never offered as something to write.
//   • No priority number anywhere: a topic carries its searches and the queries
//     behind them, nothing else.

import { slugify } from '@/lib/slugs'
import { clusterForQuery, titleFromQuery } from './mix'

export const MIN_IMPRESSIONS = 3
/** How many uncovered topics the queue keeps from searches. */
export const SEARCH_TOPIC_LIMIT = 30

export type QueryRow = { query: string; clicks: number; impressions: number }

export type Side = 'tutor' | 'parent'

export type ParsedQuery = {
  side: Side
  city: string | null
  area: string | null
  female: boolean
  online: boolean
  school: boolean
  home: boolean
  nearMe: boolean
  /** Meaningful words, normalised and sorted (place and filler words removed). */
  words: string[]
}

/** A page that can answer a search. */
export type CoverPage = {
  path: string
  label: string
  kind: 'city' | 'female' | 'online' | 'area' | 'school' | 'landing'
  city: string | null
  area?: string | null
  /** For landing pages: the subject words that must all be in the search. */
  words?: string[]
}

export type CoverPost = { title: string; slug: string; city: string | null }

export type SearchTopic = {
  key: string
  fingerprint: string
  title: string
  side: Side
  cluster: string
  audience: 'parents' | 'tutors' | 'both'
  city: string | null
  area: string | null
  female: boolean
  online: boolean
  school: boolean
  impressions: number
  clicks: number
  /** The queries behind the topic, most searched first. */
  queries: QueryRow[]
  coveredBy: { label: string; path: string } | null
}

export type TopicContext = {
  cities: string[]
  /** Curated areas: name + the city it belongs to. */
  areas: { city: string; area: string }[]
  pages: CoverPage[]
  posts: CoverPost[]
}

const BRAND_RE = /\btutor\s*mint\b|tutormint/

const TUTOR_RE =
  /\b(jobs?|vacanc(?:y|ies)|hiring|recruitment|teaching|careers?|salary|salaries|(?:teacher|tutor)s? (?:needed|required|wanted))\b/

const STOP = new Set([
  'in', 'for', 'the', 'a', 'an', 'of', 'at', 'to', 'and', 'or', 'on', 'with', 'my', 'me', 'near', 'nearby', 'best', 'top',
  'is', 'are', 'how', 'what', 'where', 'which', 'who', 'can', 'do', 'i', 'pakistan', 'pk', 'area', 'city', 'from',
])

/** Lower case, punctuation to spaces, one space. */
export function normaliseQuery(q: string): string {
  return q.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim()
}

/** One spelling per word: plurals and the common variants of a word. */
function stem(w: string): string {
  const map: Record<string, string> = {
    jobs: 'job', tuitions: 'tuition', tution: 'tuition', teachers: 'teacher', tutors: 'tutor',
    teaching: 'teacher', ladies: 'female', lady: 'female', women: 'female', woman: 'female', girls: 'female', females: 'female',
    schools: 'school', vacancies: 'vacancy', academies: 'academy',
  }
  return map[w] ?? w
}

function hasPhrase(text: string, phrase: string): boolean {
  const p = normaliseQuery(phrase)
  if (!p) return false
  return ` ${text} `.includes(` ${p} `)
}

/** Read one search into what it asks for. */
export function parseQuery(query: string, ctx: Pick<TopicContext, 'cities' | 'areas'>): ParsedQuery {
  const text = normaliseQuery(query)
  let rest = text
  // City: the longest city name in the search.
  const city = [...ctx.cities].sort((a, b) => b.length - a.length).find((c) => hasPhrase(text, c)) ?? null
  if (city) rest = ` ${rest} `.replace(` ${normaliseQuery(city)} `, ' ').trim()
  // Area: the longest curated area named, in that city — or, with no city named,
  // in exactly one city (which then becomes the city).
  let area: string | null = null
  let areaCity: string | null = city
  const areaName = (a: string) => normaliseQuery(city ? a.replace(new RegExp(`\\b${city}\\b`, 'i'), '') : a)
  const candidates = ctx.areas
    .filter((a) => !city || a.city.toLowerCase() === city.toLowerCase())
    .filter((a) => areaName(a.area).length > 1 && hasPhrase(rest, areaName(a.area)))
    .sort((a, b) => areaName(b.area).length - areaName(a.area).length)
  if (candidates.length > 0) {
    const best = candidates[0]
    const sameName = candidates.filter((c) => areaName(c.area) === areaName(best.area))
    const cities = new Set(sameName.map((c) => c.city.toLowerCase()))
    if (city || cities.size === 1) {
      area = best.area
      areaCity = city ?? best.city
      rest = ` ${rest} `.replace(` ${areaName(best.area)} `, ' ').trim()
    }
  }
  const female = /\b(female|females|ladies|lady|women|woman|girls?)\b/.test(text)
  const online = /\bonline\b/.test(text)
  const school = /\b(schools?|academy|academies|college)\b/.test(text)
  const home = /\bhome\b/.test(text)
  const nearMe = /\bnear (me|by)\b|\bnearby\b/.test(text)
  const side: Side = TUTOR_RE.test(text) ? 'tutor' : 'parent'
  const words = [...new Set(rest.split(' ').filter((w) => w && !STOP.has(w)).map(stem))].filter((w) => !['female'].includes(w)).sort()
  return { side, city: areaCity, area, female, online, school, home, nearMe, words }
}

function groupKey(p: ParsedQuery): string {
  if (p.side === 'tutor') {
    return ['tutor', p.city?.toLowerCase() ?? '', p.area?.toLowerCase() ?? '', p.female ? 'f' : '', p.online ? 'o' : '', p.school ? 's' : '', !p.city && p.nearMe ? 'near' : ''].join('|')
  }
  return ['parent', p.city?.toLowerCase() ?? '', p.area?.toLowerCase() ?? '', ...p.words].join('|')
}

/** The working title of a tutor-side topic: what kind of jobs, where. */
export function tutorTopicTitle(p: Pick<ParsedQuery, 'city' | 'area' | 'female' | 'online' | 'school' | 'home' | 'nearMe'>): string {
  const kind = p.online
    ? `${p.female ? 'Female online' : 'Online'} tuition jobs`
    : p.school
      ? `${p.female ? 'Female school' : 'School'} teaching jobs`
      : p.female
        ? 'Female teaching jobs'
        : p.home
          ? 'Home tuition jobs'
          : 'Teaching and tuition jobs'
  const place = p.area && p.city ? ` in ${p.area.replace(new RegExp(`\\s*${p.city}$`, 'i'), '')}, ${p.city}` : p.city ? ` in ${p.city}` : p.nearMe ? ' near you' : ' in Pakistan'
  return `${kind}${place}: how to find and apply`
}

function sameCity(a: string | null | undefined, b: string | null | undefined): boolean {
  return !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase()
}

/** The page or post that already answers a topic, or null. */
export function coveredBy(t: Omit<SearchTopic, 'coveredBy'>, words: string[], ctx: Pick<TopicContext, 'pages' | 'posts'>): { label: string; path: string } | null {
  // A post answers it when its title has every word of the topic and the same
  // city (or neither names a city).
  const topicWords = t.side === 'tutor' ? ['job', ...(t.female ? ['female'] : []), ...(t.online ? ['online'] : []), ...(t.school ? ['school'] : [])] : words
  for (const post of ctx.posts) {
    const title = normaliseQuery(post.title)
    const postWords = new Set(title.split(' ').map(stem))
    const postCity = post.city ?? null
    const cityOk = t.city ? sameCity(postCity, t.city) || hasPhrase(title, t.city) : !postCity
    if (cityOk && topicWords.length > 0 && topicWords.every((w) => postWords.has(w))) return { label: post.title, path: `/blog/${post.slug}` }
  }
  if (t.side === 'tutor') {
    // A city page answers "jobs in <city>"; the female / online / area page the
    // narrower search. A school-jobs search and a search with no city are not
    // answered by a city page.
    if (!t.city || t.school) return null
    const want: CoverPage['kind'] = t.area ? 'area' : t.female ? 'female' : t.online ? 'online' : 'city'
    if (t.area && (t.female || t.online)) return null
    const page = ctx.pages.find(
      (p) => p.kind === want && sameCity(p.city, t.city) && (want !== 'area' || sameCity(p.area, t.area)),
    )
    return page ? { label: page.label, path: page.path } : null
  }
  // Parent side: a landing page answers it when its subject words and city are
  // all in the search.
  for (const p of ctx.pages) {
    if (p.kind !== 'landing' || !p.words?.length) continue
    if (t.city && !sameCity(p.city, t.city)) continue
    if (!t.city) continue
    if (p.words.every((w) => words.includes(stem(w)))) return { label: p.label, path: p.path }
  }
  return null
}

/** Sum duplicate queries (case and spacing ignored) and keep those with enough impressions. */
export function usableQueries(rows: QueryRow[]): QueryRow[] {
  const by = new Map<string, QueryRow>()
  for (const r of rows) {
    const k = normaliseQuery(r.query)
    if (!k) continue
    const cur = by.get(k)
    if (cur) {
      cur.clicks += r.clicks
      cur.impressions += r.impressions
    } else by.set(k, { query: r.query.trim(), clicks: r.clicks, impressions: r.impressions })
  }
  return [...by.entries()]
    .filter(([k, r]) => r.impressions >= MIN_IMPRESSIONS && !BRAND_RE.test(k))
    .map(([, r]) => r)
}

/** Every topic (covered ones included), tutor-side first, then by searches. */
export function buildSearchTopics(rows: QueryRow[], ctx: TopicContext): SearchTopic[] {
  const groups = new Map<string, { parsed: ParsedQuery; queries: QueryRow[] }>()
  for (const q of usableQueries(rows)) {
    const parsed = parseQuery(q.query, ctx)
    const key = groupKey(parsed)
    const g = groups.get(key)
    if (g) g.queries.push(q)
    else groups.set(key, { parsed, queries: [q] })
  }
  const topics: SearchTopic[] = []
  for (const [key, g] of groups) {
    const queries = [...g.queries].sort((a, b) => b.impressions - a.impressions || b.clicks - a.clicks)
    const p = g.parsed
    // Words for the parent side: the most searched query's.
    const top = queries[0]
    const impressions = queries.reduce((s, q) => s + q.impressions, 0)
    const clicks = queries.reduce((s, q) => s + q.clicks, 0)
    const parentMeta = clusterForQuery(top.query, ctx.cities)
    const base: Omit<SearchTopic, 'coveredBy'> = {
      key,
      fingerprint: `gsc:${slugify(key.replace(/\|/g, ' ')) || 'q'}`,
      title: p.side === 'tutor' ? tutorTopicTitle({ ...p, home: queries.some((q) => /\bhome\b/i.test(q.query)) }) : titleFromQuery(top.query),
      side: p.side,
      cluster: p.side === 'tutor' ? 'tutor-career' : parentMeta.cluster,
      audience: p.side === 'tutor' ? 'tutors' : parentMeta.audience === 'tutors' ? 'tutors' : 'parents',
      city: p.city,
      area: p.area,
      female: p.female,
      online: p.online,
      school: p.school,
      impressions,
      clicks,
      queries,
    }
    topics.push({ ...base, coveredBy: coveredBy(base, p.words, ctx) })
  }
  return topics.sort(
    (a, b) => (a.side === b.side ? 0 : a.side === 'tutor' ? -1 : 1) || b.impressions - a.impressions || b.clicks - a.clicks || a.title.localeCompare(b.title),
  )
}

/** "N searches last month" — Search Console impressions over the last 28 days. */
export function searchesLine(n: number): string {
  return `${n.toLocaleString('en-US')} search${n === 1 ? '' : 'es'} last month`
}

/** The one plain line on why a topic is worth a post. */
export function whyLine(t: Pick<SearchTopic, 'side' | 'coveredBy'>): string {
  if (t.coveredBy) return `Already covered by ${t.coveredBy.label}.`
  return t.side === 'tutor'
    ? 'Tutors search for this on Google and no page or post on TutorMint answers it yet.'
    : 'Parents search for this on Google and no page or post on TutorMint answers it yet.'
}

/** What the writer is told about a topic: the searches, without their figures. */
export function topicNotes(t: Pick<SearchTopic, 'queries' | 'side'>): string {
  const qs = t.queries.slice(0, 8).map((q) => `“${q.query}”`).join(', ')
  return t.side === 'tutor'
    ? `Tutors find TutorMint on Google with searches like ${qs}. Write a practical guide for tutors: how to find and apply for these jobs on TutorMint, what parents look for, and which areas to look in.`
    : `Parents find TutorMint on Google with searches like ${qs}.`
}

// ---------------------------------------------------------- CSV upload ------

/**
 * A Search Console "Queries" export (Performance → Export → CSV, Queries.csv):
 * columns "Top queries" (or "Query"), "Clicks", "Impressions", "CTR",
 * "Position". Returns the rows, or an error naming what is missing.
 */
export function parseQueriesCsv(csv: string): { ok: true; rows: QueryRow[] } | { ok: false; error: string } {
  const text = csv.replace(/^﻿/, '')
  const lines = splitCsv(text).filter((r) => r.some((c) => c.trim() !== ''))
  if (lines.length === 0) return { ok: false, error: 'That file is empty.' }
  const header = lines[0].map((h) => h.trim().toLowerCase())
  const qi = header.findIndex((h) => h === 'top queries' || h === 'query' || h === 'queries')
  const ci = header.findIndex((h) => h === 'clicks')
  const ii = header.findIndex((h) => h === 'impressions')
  if (qi < 0) return { ok: false, error: 'Missing column: Top queries. Export the "Queries" tab from Search Console.' }
  if (ci < 0) return { ok: false, error: 'Missing column: Clicks.' }
  if (ii < 0) return { ok: false, error: 'Missing column: Impressions.' }
  const num = (s: string | undefined) => {
    const n = Number(String(s ?? '').replace(/[,\s]/g, ''))
    return Number.isFinite(n) && n >= 0 ? Math.round(n) : 0
  }
  const rows: QueryRow[] = []
  for (const r of lines.slice(1)) {
    const query = (r[qi] ?? '').trim()
    if (!query) continue
    rows.push({ query: query.slice(0, 200), clicks: num(r[ci]), impressions: num(r[ii]) })
  }
  if (rows.length === 0) return { ok: false, error: 'No queries found in that file.' }
  return { ok: true, rows: rows.slice(0, 5000) }
}

function splitCsv(text: string): string[][] {
  const out: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"'
        i++
      } else if (ch === '"') quoted = false
      else cell += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') {
      row.push(cell)
      cell = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(cell)
      out.push(row)
      row = []
      cell = ''
    } else cell += ch
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell)
    out.push(row)
  }
  return out
}

// ---------------------------------------------------- Search Console access --

/** A plain reading of a Search Console API error, with what the owner should do. */
export function gscAccessProblem(message: string, serviceEmail: string | null): { summary: string; steps: string[] } {
  const m = message.toLowerCase()
  const who = serviceEmail ? `the service account ${serviceEmail}` : 'the Google service account in GOOGLE_INDEXING_CLIENT_EMAIL'
  if (m.includes('has not been used') || m.includes('disabled') || m.includes('accessnotconfigured')) {
    return {
      summary: 'The Search Console API is switched off in the Google Cloud project.',
      steps: [
        'Open Google Cloud Console → APIs & Services → Library for the project the service account belongs to.',
        'Search "Google Search Console API" and press Enable.',
        'Wait a few minutes, then press "Rebuild now" on the Content queue.',
      ],
    }
  }
  if (m.includes('permission') || m.includes('forbidden') || m.includes('403') || m.includes('not a verified owner') || m.includes('user does not have')) {
    return {
      summary: 'The service account cannot read this Search Console property.',
      steps: [
        'Open Search Console → Settings → Users and permissions for https://www.tutormint.org/.',
        `Press "Add user", enter ${who}, choose "Full" (or "Restricted"), and save.`,
        'Then press "Rebuild now" on the Content queue.',
      ],
    }
  }
  if (m.includes('no google service-account credentials') || m.includes('credentials')) {
    return {
      summary: 'No Google service account is set up.',
      steps: ['Set GOOGLE_INDEXING_CLIENT_EMAIL and GOOGLE_INDEXING_PRIVATE_KEY in Vercel (the same account the Indexing API uses), then redeploy.'],
    }
  }
  return { summary: 'Search Console could not be read.', steps: ['Press "Rebuild now" to try again. Until it works, upload a Queries CSV export below.'] }
}

// --------------------------------------------------------- as a candidate --

import type { Candidate } from './core'

/** An uncovered topic as a content-queue row. The searches are its evidence
 *  (shown to staff); the notes handed to the writer carry no figures. */
export function searchTopicCandidate(t: SearchTopic): Candidate {
  return {
    fingerprint: t.fingerprint,
    card: 'content',
    source: 'gsc',
    title: t.title,
    cluster: t.cluster,
    audience: t.audience,
    language: 'en',
    components: { demand: t.impressions, rankProximity: 1, seasonality: 1, gapAge: 1 },
    evidence: [
      `${searchesLine(t.impressions)} · ${t.clicks} click${t.clicks === 1 ? '' : 's'}`,
      ...t.queries.slice(0, 8).map((q) => `“${q.query}” — ${q.impressions} impression${q.impressions === 1 ? '' : 's'}, ${q.clicks} click${q.clicks === 1 ? '' : 's'}`),
    ],
    evidenceKey: {
      impressions: t.impressions,
      side: t.side,
      city: t.city ?? '',
      area: t.area ?? '',
      female: t.female ? 1 : 0,
      online: t.online ? 1 : 0,
      school: t.school ? 1 : 0,
    },
    notes: topicNotes(t),
  }
}

/**
 * Should the page ask Google again before showing Search Console's state (owner,
 * 28 Oct 2026: "Rebuild now must re-check access fresh, never showing a stored
 * old error")? Yes when the stored result is an error or nothing was read yet,
 * as long as credentials exist. A stored success is shown as it is.
 */
export function needsFreshCheck(
  stored: { status: 'ok' | 'error' } | null,
  allowed: boolean,
  configured: boolean,
): boolean {
  if (!allowed || !configured) return false
  return !stored || stored.status === 'error'
}

/** "Other topics" list tutor-side topics first (owner, 28 Oct 2026): written
 *  for tutors, or in the Tutor career cluster; the rest keep their order. */
export function tutorSideFirst<T extends { audience: string; cluster: string | null }>(rows: readonly T[]): T[] {
  const tutorSide = (r: T) => r.audience === 'tutors' || r.cluster === 'tutor-career'
  return [...rows.filter(tutorSide), ...rows.filter((r) => !tutorSide(r))]
}
