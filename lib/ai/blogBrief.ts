// lib/ai/blogBrief.ts
//
// The pure half of blog AI-drafting: the figure verifier and the deterministic
// fallback composer. No network, no server-only import -- so it runs in the
// editor (the live "not in your notes" flags), on the server (the save-time
// gate), AND in the test runner. Same split, and same reason, as
// lib/ai/jobBrief.ts: lib/ai/blogCopy.ts reaches the Anthropic API through a
// module that imports 'server-only' and refuses to load anywhere else.
//
// THE RULE THAT SHAPES IT: a published post must invent no statistic. A blog
// post carries authority a job advert does not -- a made-up "83% of O Level
// students" reads as researched fact and will be quoted back at us. So every
// FIGURE in the body must trace to the manager's fact notes, and the ones that
// do not are flagged and block the Reviewed tick until the manager edits them
// out or confirms them with a written source. The prompt argues for this; the
// verifier is what holds when the model is having a confident day.
//
// WHAT "trace" MEANS, and its deliberate narrowness, is at unsupportedFigures().

export const BLOG_MIN_WORDS = 700
export const BLOG_MAX_WORDS = 1600

/** The brand line every generated meta description ends with. */
export const SEO_BRAND_TAIL = 'No fee, no commission, no middleman.'

export type BlogBrief = {
  title: string
  clusterLabel: string
  audience: 'parents' | 'tutors' | 'both'
  language: 'en' | 'ur'
  /** The manager's fact notes -- local numbers, a name, a story. */
  notes: string
  /** Live landing pages the draft may link to, as {label, path}. */
  landingLinks: { label: string; path: string }[]
}

export type BlogDraft = {
  body: string
  seoTitle: string
  seoDescription: string
  /** 'claude' when the model wrote it, 'composed' when this file did. */
  source: 'claude' | 'composed'
  /** Set when a generation was attempted and did not produce usable text. */
  note?: string
  /** The verbatim failure reason (status + body) when a call failed. Admin-only. */
  reason?: string
  /** Figures in the body that do not trace to the notes. */
  untraced: string[]
}

/** A live landing page the body may link to, for the figure exemption below. */
export type LandingRef = { path: string; label: string }

export type ConfirmedFigure = { figure: string; source: string }

// -------------------------------------------------------------- verifier ---

/** Every numeric run in a string, both comma-grouped and bare forms. */
function numbersOf(s: string | null | undefined): Set<string> {
  const out = new Set<string>()
  for (const m of String(s ?? '').matchAll(/\d[\d,]*/g)) {
    out.add(m[0])
    out.add(m[0].replace(/,/g, ''))
  }
  return out
}

/** A four-digit year (1900–2099) is a date, not a statistic. */
function isYear(bare: string): boolean {
  return /^(?:19|20)\d\d$/.test(bare)
}

/**
 * Figures in `body` that the notes do not support.
 *
 * WHAT IT CATCHES, and it is deliberately narrow: NUMBERS. A blog post's
 * dangerous inventions are numeric -- a percentage, a fee, a pass rate, a
 * count of students, a year. Those read as specific and checkable and a reader
 * will believe them, and a number in the body that is in neither the notes nor
 * the confirmed list was invented. That is a decidable question, unlike
 * "is this sentence overstated".
 *
 * WHAT IT DOES NOT CATCH: invented prose ("Lahore's most trusted method"). The
 * prompt argues against it and a human reads every word before publishing; the
 * verifier is for the class of invention that is both likely and damaging.
 *
 * ALLOWED, so the gate is not noise:
 *   - Any figure appearing in the notes (comma or bare form).
 *   - Any figure appearing in the TITLE ("Grade 10", "O Levels 2026") -- the
 *     manager chose the title, so a number in it is a fact they asserted.
 *   - Any figure the manager confirmed with a source.
 *
 * `confirmed` is the list of figure strings already confirmed.
 *
 * `landing` exempts digits that are part of a REAL landing page's own title,
 * when the body links to that page: a page title ("Grade 1 to 5 Mathematics")
 * is not a statistic. The exemption uses the landing page's CANONICAL label,
 * not the author's free-text link text, so a stat smuggled into a link label
 * ("[83% pass](/tutors/lahore/o-levels-physics)") is still flagged — 83 is not
 * in that page's title. Only links whose path is a known live landing count.
 */
const LINK_RE = /\[[^\]]+\]\(([^)\s]+)\)/g

export function unsupportedFigures(
  body: string,
  notes: string,
  title: string,
  confirmed: string[] = [],
  landing: LandingRef[] = [],
): string[] {
  // Title numbers count as asserted facts ONLY when there are notes. With no
  // notes the post is meant to be figure-free (the title-only generation path),
  // so a non-year number in the title does not license the same number in the
  // body — only a year survives, via the year exemption in the scan below.
  const hasNotes = notes.trim().length > 0
  const allowed = new Set<string>([
    ...numbersOf(notes),
    ...(hasNotes ? numbersOf(title) : []),
    ...confirmed.flatMap((c) => [c, c.replace(/,/g, '')]),
  ])

  // Exempt the digits of a real landing page's title, but only when the body
  // actually links to that page.
  if (landing.length > 0) {
    const byPath = new Map(landing.map((l) => [l.path.replace(/^\//, ''), l.label]))
    for (const m of body.matchAll(LINK_RE)) {
      const href = m[1].replace(/^\//, '')
      const label = byPath.get(href)
      if (label) for (const n of numbersOf(label)) allowed.add(n)
    }
  }

  // An ordered-list enumerator ("1.", "2.") is not a statistic. Strip the
  // leading marker before scanning so a numbered list does not block review —
  // numbers inside the list text are still scanned. Same OL shape the Markdown
  // renderer recognises.
  const scanned = body.replace(/^[ \t]*\d+\.[ \t]+/gm, '')

  const found: string[] = []
  for (const m of scanned.matchAll(/\d[\d,]*/g)) {
    const raw = m[0]
    const bare = raw.replace(/,/g, '')
    if (isYear(bare)) continue // a year is a date, never a statistic
    if (allowed.has(raw) || allowed.has(bare)) continue
    found.push(raw)
  }
  return [...new Set(found)]
}

/**
 * Whether a save that ticks Reviewed may proceed on figure grounds.
 *
 * The gate is ACTIVE ONLY WHEN THERE ARE NOTES. A hand-written post (the part-1
 * flow) with no notes is not blocked -- otherwise every "5 tips" and "Grade 10"
 * in a manually written post would need confirming, which is friction the
 * part-1 authors never signed up for and a regression of a shipped flow. Record
 * notes (or generate from them) and the discipline switches on: then every
 * figure must trace. This is the one rule; the editor and the server read it
 * the same way.
 */
export function figureGate(
  body: string,
  notes: string,
  title: string,
  confirmed: string[] = [],
  landing: LandingRef[] = [],
): { active: boolean; untraced: string[] } {
  if (!notes.trim()) return { active: false, untraced: [] }
  return { active: true, untraced: unsupportedFigures(body, notes, title, confirmed, landing) }
}

// ------------------------------------------------------------- SEO tail ----

/**
 * A meta description that ends with the brand line and fits the 155 ceiling.
 * The lead is trimmed as needed so the tail always survives -- the brand line
 * is the part that must not be cut.
 */
export function withBrandTail(lead: string, max = 155): string {
  const tail = SEO_BRAND_TAIL
  const clean = lead.trim().replace(/[.\s]+$/, '')
  if (clean.toLowerCase().includes('no commission')) return clean.slice(0, max)
  const room = max - tail.length - 2 // ". "
  if (room <= 0) return tail.slice(0, max)
  const head = clean.length > room ? clean.slice(0, room).replace(/\s+\S*$/, '') : clean
  return `${head}. ${tail}`
}

// ------------------------------------------------------------- composed ----

function wordCount(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length
}

export { wordCount }

/**
 * The plain draft, built from the manager's notes and nothing else.
 *
 * This is what the editor gets when there is no API key, when the call fails,
 * or when the generated draft does not survive checks. It is a real starting
 * point a human expands -- unremarkable and honest beats absent. It contains no
 * number the notes do not, so it can never fail its own verifier.
 *
 * The notes become the spine: each non-empty note line is a talking point under
 * a generic H2, so the manager sees their own facts laid out rather than a
 * blank page. The FAQ and CTA are structural, not factual.
 */
export function composeBlogDraft(brief: BlogBrief): BlogDraft {
  const noteLines = brief.notes
    .split('\n')
    .map((l) => l.replace(/^[-*\d.\s]+/, '').trim())
    .filter(Boolean)

  const audienceWord =
    brief.audience === 'tutors' ? 'tutors' : brief.audience === 'parents' ? 'parents' : 'parents and tutors'

  const parts: string[] = []

  // Answer-first intro, from the title only (no invented specifics).
  parts.push(
    `${brief.title} — here is what ${audienceWord} in Pakistan should know, in plain terms.`,
  )
  parts.push('_We put this together from your notes. Edit it into shape before publishing._')

  parts.push('## What to know')
  if (noteLines.length > 0) {
    parts.push(noteLines.map((n) => `- ${n}`).join('\n'))
  } else {
    parts.push('Add the key points here.')
  }

  parts.push('## How it works')
  parts.push(
    'Explain the steps in order, in short paragraphs. Keep it specific to Pakistan and to the reader in front of you.',
  )

  // One real landing link, when there is one, so the draft is internally
  // linked from the start. Only links we were given -- never an invented URL.
  if (brief.landingLinks.length > 0) {
    const l = brief.landingLinks[0]
    parts.push(`See [${l.label}](/${l.path}) for tutors and tuitions in this area.`)
  }

  parts.push('## Frequently asked questions')
  parts.push('### Is TutorMint free to use?')
  parts.push('Yes. Browsing tutors and posting a tuition is free. There is no fee and no commission.')

  parts.push(
    brief.audience === 'tutors'
      ? 'Ready to teach? Join TutorMint and appear to parents searching for your subject in your area.'
      : 'Looking for a tutor? Post what you need and let verified tutors come to you.',
  )

  const body = parts.join('\n\n')
  const seoTitle = brief.title.slice(0, 60)
  const seoDescription = withBrandTail(
    `${brief.title} — a plain guide for ${audienceWord} on TutorMint`,
  )

  return { body, seoTitle, seoDescription, source: 'composed', untraced: [] }
}
