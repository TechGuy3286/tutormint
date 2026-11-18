// lib/tutorTeasersCore.ts — PURE (owner, 18 Nov 2026 — PR-06).
//
// Paid-tutor teasers in the bell and the staff WhatsApp updates queue. Every
// rule lives here so the cron, the instant alert, the admin page and the tests
// read one definition. No I/O.
//
// HONEST BY CONSTRUCTION. Every teaser is a count of real rows (profile_views,
// applications, jobs, application_parent_views). A teaser whose numbers are all
// 0 is never built — the builders return null and the callers send nothing.
// No upgrade upsell (promotion is paused), no price, no superlative.
//
// PARENT PRIVACY. A parent is shown only as a blurred name — the first letter of
// the first and last name plus four stars ("S**** K****", the same four stars
// whatever the real length) — and their area. Never a phone, email or address.
//
// Unit-tested by scripts/test-tutor-teasers.ts.

export const DAY_MS = 86_400_000
const PK_OFFSET_MS = 5 * 3_600_000 // Asia/Karachi is UTC+5 all year (no DST).

// ------------------------------------------------------------------ kinds ---

/** The in-app teaser kinds that count towards the weekly cap (PR-08 added the
 *  grouped parent-interest alert, at most one a day). */
export const TEASER_KINDS = ['teaser_profile_views', 'teaser_views_tip', 'teaser_new_tuitions', 'teaser_weekly_summary', 'teaser_parent_interest'] as const
export type TeaserKind = (typeof TEASER_KINDS)[number]
/** The instant alert — never counted towards the cap. */
export const APPLICATION_OPENED_KIND = 'application_opened' as const
/** The instant "sent to the parent" alert (PR-07) — never counted towards the cap. */
export const APPLICATION_FORWARDED_KIND = 'application_forwarded' as const

export const WEEKLY_TEASER_CAP = 3
/** Teasers start this long after the Verification Fee was paid. */
export const TEASER_START_DAYS = 2
/** The 0-views tip goes at most once in this many days. */
export const TIP_EVERY_DAYS = 14
/** A tutor appears in the WhatsApp queue at most this many times a week. */
export const WA_WEEKLY_CAP = 2

/** Pakistan weekday the profile-views teaser goes out (0 = Sunday … 4 = Thursday).
 *  Monday carries the weekly summary, so the views teaser goes mid-week. */
export const VIEWS_TEASER_WEEKDAY = 4
export const SUMMARY_WEEKDAY = 1

// ------------------------------------------------------------- Pakistan time ---

/** Start of the Pakistan day holding `nowMs`, as a UTC ms. */
export function pkDayStartMs(nowMs: number): number {
  const s = new Date(nowMs + PK_OFFSET_MS)
  return Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), s.getUTCDate()) - PK_OFFSET_MS
}

/** 0 = Sunday … 6 = Saturday, in Pakistan. */
export function pkWeekday(nowMs: number): number {
  return new Date(nowMs + PK_OFFSET_MS).getUTCDay()
}

/** Start of the Pakistan week (Monday 00:00 PKT) holding `nowMs`. */
export function pkWeekStartMs(nowMs: number): number {
  const back = (pkWeekday(nowMs) + 6) % 7 // Monday → 0, Sunday → 6
  return pkDayStartMs(nowMs) - back * DAY_MS
}

/** "2026-11-18" — the Pakistan date, for whatsapp_update_sends.pk_day. */
export function pkDateKey(nowMs: number): string {
  return new Date(pkDayStartMs(nowMs) + PK_OFFSET_MS).toISOString().slice(0, 10)
}

// ----------------------------------------------------------------- who gets ---

export type TeaserEligibilityFacts = {
  role: string | null
  /** tutor_profiles.verified_fee_paid_at. */
  feePaidAt: string | null
  isSeed?: boolean | null
  isTeam?: boolean | null
  isTestName?: boolean | null
  hidden?: boolean | null
  /** Staff account (profiles.admin_role set). */
  staff?: boolean
  mergedInto?: string | null
  suspended?: boolean | null
  banned?: boolean | null
  /** profiles.paused_by_user_at set. */
  selfPaused?: boolean
  /** account_erasures 'scheduled' or 'done'. */
  eraseRequested?: boolean
  erased?: boolean
  /** A live "Not interested" mark (follow_up_dismissals, not undone). */
  notInterested?: boolean
  /** An imported profile nobody has claimed (no one reads its bell). */
  unclaimedImport?: boolean
}

export type NotEligibleReason =
  | 'not_tutor'
  | 'not_paid'
  | 'too_soon'
  | 'erase_requested'
  | 'not_interested'
  | 'suspended'
  | 'banned'
  | 'paused'
  | 'staff'
  | 'test'
  | 'unclaimed'

/** Why this tutor gets no teaser, or null when they may get one. PR-08: with
 *  `allowUnpaid` an unpaid tutor may get one too (parent interest, views and
 *  new tuitions) — the 2-day wait applies only after paying. */
export function teaserBlock(f: TeaserEligibilityFacts, nowMs: number, opts: { allowUnpaid?: boolean } = {}): NotEligibleReason | null {
  if (f.staff || f.role === 'admin') return 'staff'
  if (f.role !== 'tutor') return 'not_tutor'
  if (f.erased || f.eraseRequested) return 'erase_requested'
  if (f.isSeed || f.isTeam || f.isTestName || f.hidden || f.mergedInto) return 'test'
  if (f.banned) return 'banned'
  if (f.suspended) return 'suspended'
  if (f.selfPaused) return 'paused'
  if (f.notInterested) return 'not_interested'
  if (f.unclaimedImport) return 'unclaimed'
  const paid = f.feePaidAt ? Date.parse(f.feePaidAt) : NaN
  if (!Number.isFinite(paid)) return opts.allowUnpaid ? null : 'not_paid'
  if (nowMs - paid < TEASER_START_DAYS * DAY_MS) return 'too_soon'
  return null
}

export function teaserEligible(f: TeaserEligibilityFacts, nowMs: number, opts: { allowUnpaid?: boolean } = {}): boolean {
  return teaserBlock(f, nowMs, opts) === null
}

/** Has this tutor paid the Verification Fee? */
export function isPaid(f: Pick<TeaserEligibilityFacts, 'feePaidAt'>): boolean {
  return !!f.feePaidAt && Number.isFinite(Date.parse(f.feePaidAt))
}

// ------------------------------------------------------------- weekly cap ---

/**
 * May the daily new-tuitions teaser go out today? The weekly ones go first on
 * their own day (the summary on Monday, the views teaser on Thursday); the
 * daily one takes a slot only when it leaves room for the views teaser still
 * ahead this week, so the cap never squeezes out the "who viewed you" teaser.
 */
export function dailyTeaserAllowed(sentThisWeek: number, nowMs: number): boolean {
  const day = pkWeekday(nowMs)
  // Days left before Thursday in a Monday-start week: Mon, Tue, Wed.
  const viewsStillAhead = day >= 1 && day < VIEWS_TEASER_WEEKDAY ? 1 : 0
  return sentThisWeek + viewsStillAhead < WEEKLY_TEASER_CAP
}

/** May a weekly teaser (summary or views) go out? Only under the cap. */
export function weeklyTeaserAllowed(sentThisWeek: number): boolean {
  return sentThisWeek < WEEKLY_TEASER_CAP
}

/** The 0-views tip: at most once every 14 days. */
export function tipDue(lastTipAt: string | null | undefined, nowMs: number): boolean {
  if (!lastTipAt) return true
  const t = Date.parse(lastTipAt)
  return !Number.isFinite(t) || nowMs - t >= TIP_EVERY_DAYS * DAY_MS
}

// ------------------------------------------------------------ name blurring ---

const STARS = '****'

/**
 * "Sana Khan" → "S**** K****"; "Sana" → "S****"; "sana ali khan" → "S**** K****"
 * (first and last name only). Always four stars, so the length of the real
 * name is not shown. Anything that is not a letter is dropped; an empty name
 * reads "A parent".
 */
export function blurName(full: string | null | undefined): string {
  const words = (full ?? '')
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}]/gu, ''))
    .filter(Boolean)
  if (words.length === 0) return 'A parent'
  const initial = (w: string) => `${w[0].toUpperCase()}${STARS}`
  if (words.length === 1) return initial(words[0])
  return `${initial(words[0])} ${initial(words[words.length - 1])}`
}

/** An area or city fit to show in a teaser. A value with any digit or @ in it
 *  reads like an address, a phone or an email, so it is not shown at all (the
 *  caller falls back to the city); otherwise only letters, spaces, dots,
 *  apostrophes and hyphens are kept. */
export function safePlace(v: string | null | undefined): string | null {
  const raw = v ?? ''
  if (/[\d@]/.test(raw)) return null
  const s = raw.replace(/[^\p{L}\s.'-]/gu, ' ').replace(/\s+/g, ' ').trim()
  return s.length >= 2 ? s.slice(0, 40) : null
}

// ---------------------------------------------------- a) profile views teaser ---

export type ParentViewer = { name: string | null; area: string | null; city: string | null }

export type ViewsFacts = {
  /** Distinct signed-in parents who viewed the profile this week. */
  parents: ParentViewer[]
  /** Other visitors this week (not signed in, or another tutor) — a count only. */
  otherVisitors: number
}

export type TeaserText = { title: string; body: string | null; href: string }

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** Where the parents are from, when it can be said in a few words. */
export function viewersFrom(parents: ParentViewer[]): string | null {
  const places = [...new Set(parents.map((p) => safePlace(p.area) ?? safePlace(p.city)).filter((v): v is string => !!v))]
  if (places.length === 0 || places.length > 2) return null
  return places.join(' and ')
}

export const NAMES_SHOWN = 3

/**
 * "👀 2 parents from Gulberg viewed your profile this week" /
 * "S**** K**** (Gulberg), A**** M**** (DHA) and 4 other visitors."
 * Null when there were no views at all (the caller then considers the tip).
 */
export function viewsTeaser(f: ViewsFacts): TeaserText | null {
  const n = f.parents.length
  const others = Math.max(0, Math.floor(f.otherVisitors))
  if (n === 0 && others === 0) return null
  const href = '/tutor/dashboard/views'
  if (n === 0) {
    return { title: `👀 ${plural(others, 'visitor', 'visitors')} viewed your profile this week`, body: null, href }
  }
  const from = viewersFrom(f.parents)
  const title = `👀 ${plural(n, 'parent', 'parents')}${from ? ` from ${from}` : ''} viewed your profile this week`
  const shown = f.parents.slice(0, NAMES_SHOWN).map((p) => {
    const place = safePlace(p.area) ?? safePlace(p.city)
    return `${blurName(p.name)}${place ? ` (${place})` : ''}`
  })
  const moreParents = n - shown.length
  const tail: string[] = []
  if (moreParents > 0) tail.push(plural(moreParents, 'more parent', 'more parents'))
  if (others > 0) tail.push(plural(others, 'other visitor', 'other visitors'))
  const body = tail.length ? `${shown.join(', ')} and ${tail.join(' and ')}.` : `${shown.join(', ')}.`
  return { title, body, href }
}

/** The 0-views tip: one missing profile item if there is one (its label is an
 *  instruction, "Add your availability"), else sharing the profile. Profile
 *  completion is a real ranking input (rank_tutors), so the reason is true. */
export function viewsTip(missing: { label: string; href: string } | null): TeaserText {
  if (missing) {
    return {
      title: 'Tip: get more parents to see your profile',
      body: `${missing.label.replace(/[.\s]+$/, '')}. Complete profiles come up higher when parents search.`,
      href: missing.href,
    }
  }
  return {
    title: 'Tip: get more parents to see your profile',
    body: 'Share your profile link on WhatsApp with parents and groups you know.',
    href: '/tutor/dashboard',
  }
}

// ---------------------------------------------------- b) new matching tuitions ---

export type MatchTutor = {
  masterIds: readonly number[]
  /** Main city first, then the other cities the tutor teaches in. */
  cities: readonly string[]
  jobTypes: readonly string[]
  gender: string | null
}

export type MatchJob = {
  id: string
  masterIds: readonly number[]
  city: string | null
  /** Job Type (stored as teaching_mode). */
  jobType: string | null
  genderPreference: string | null
  createdAt: string
}

/** The four rules a match must pass, with the decisions passed in so the core
 *  stays free of imports: subjects overlap, location/Job Type (matchVisibility),
 *  and the gender preference (genderApplyBlocked). */
export function jobMatches(
  job: MatchJob,
  tutor: MatchTutor,
  rules: {
    visibility: (jobType: string | null, jobCity: string | null, tutorTypes: readonly string[], tutorCities: readonly string[]) => 'same_city' | 'online' | 'exclude'
    genderBlocked: (pref: string | null, tutorGender: string | null) => boolean
  },
): boolean {
  if (tutor.masterIds.length === 0 || job.masterIds.length === 0) return false
  const mine = new Set(tutor.masterIds)
  if (!job.masterIds.some((m) => mine.has(m))) return false
  if (rules.visibility(job.jobType, job.city, tutor.jobTypes, tutor.cities) === 'exclude') return false
  if (rules.genderBlocked(job.genderPreference, tutor.gender)) return false
  return true
}

/** The filtered list the teaser links to: the tutor's main city (and the one
 *  subject, when all the matches share a single one). */
export function tuitionsListHref(city: string | null, singleMasterId: number | null): string {
  const p = new URLSearchParams()
  if (city) p.set('city', city)
  if (singleMasterId) p.set('subject', String(singleMasterId))
  const q = p.toString()
  return q ? `/browse/tuitions?${q}` : '/tutor/dashboard/jobs'
}

/** "📚 3 new tuitions in your areas in the last 24 hours". Null when 0. An
 *  unpaid tutor (PR-08) gets the step that stands before Apply as the body
 *  ("Finish your profile to apply." / "Pay the Verification Fee to apply."). */
export function newTuitionsTeaser(count: number, href: string, unpaid?: { body: string; href: string } | null): TeaserText | null {
  const n = Math.floor(count)
  if (!(n >= 1)) return null
  const title = `📚 ${plural(n, 'new tuition', 'new tuitions')} in your areas in the last 24 hours`
  if (unpaid) return { title, body: unpaid.body, href: unpaid.href }
  return { title, body: 'Open the list and apply to the ones that suit you.', href }
}

// ------------------------------------------------------ c) application opened ---

/** "A parent opened your application for Home Tutor, Gulberg". */
export function applicationOpenedText(job: { title: string | null; area: string | null; city: string | null }): TeaserText {
  const title = (job.title ?? '').replace(/\s+/g, ' ').trim().slice(0, 80) || 'a tuition'
  const place = safePlace(job.area) ?? safePlace(job.city)
  return {
    title: `A parent opened your application for ${title}${place ? `, ${place}` : ''}`,
    body: 'Keep your phone close — they may contact you soon.',
    href: '/tutor/dashboard/applications',
  }
}

// --------------------------------------------------- c2) sent to the parent ---

/** "Your application for Home Tutor, Gulberg was sent to the parent" (PR-07):
 *  staff forwarded the application to the tuition's parent. A real forward
 *  only; the title and place are the tuition's own (no parent detail). */
export function applicationForwardedText(job: { title: string | null; area: string | null; city: string | null }): TeaserText {
  const title = (job.title ?? '').replace(/\s+/g, ' ').trim().slice(0, 80) || 'a tuition'
  const place = safePlace(job.area) ?? safePlace(job.city)
  return {
    title: `Your application for ${title}${place ? `, ${place}` : ''} was sent to the parent`,
    body: 'Keep your phone close — the parent may contact you.',
    href: '/tutor/dashboard/applications',
  }
}

export type ForwardAlertFacts = {
  /** The application was withdrawn. */
  withdrawn: boolean
  /** The tutor passes teaserBlock (paid, not test/staff/paused/…). */
  tutorEligible: boolean
  /** The tuition's poster is a test, seed or hidden account. */
  posterTest: boolean
  /** The request runs under View as. */
  viewAs: boolean
}

/** Does a NEW forward send the bell alert? Real events only (PR-07). Once per
 *  application is the caller's first-insert rule (application_forward_alerts). */
export function forwardAlertGoes(f: ForwardAlertFacts): boolean {
  return !f.viewAs && !f.withdrawn && f.tutorEligible && !f.posterTest
}

// ---------------------------------------------------------- d) weekly summary ---

export type WeeklyNumbers = { views: number; applications: number; tuitions: number }

export function allZero(n: WeeklyNumbers): boolean {
  return !(n.views > 0) && !(n.applications > 0) && !(n.tuitions > 0)
}

/** "This week: 4 profile views · 2 applications sent · 7 new tuitions in your areas". Null when all 0. */
export function weeklySummaryTeaser(n: WeeklyNumbers): TeaserText | null {
  if (allZero(n)) return null
  return {
    title: `This week: ${plural(n.views, 'profile view', 'profile views')} · ${plural(n.applications, 'application sent', 'applications sent')} · ${plural(n.tuitions, 'new tuition', 'new tuitions')} in your areas`,
    body: null,
    href: '/tutor/dashboard',
  }
}

// ------------------------------------------------------- WhatsApp updates queue ---

export type WaItem =
  | { kind: 'application_opened'; applicationId: string; at: string; jobTitle: string | null; area: string | null; city: string | null }
  | { kind: 'application_forwarded'; applicationId: string; at: string; jobTitle: string | null; area: string | null; city: string | null }
  | { kind: 'weekly_summary'; numbers: WeeklyNumbers }
  // PR-08, unpaid tutors only: parents who shortlisted or tried to contact
  // them (counts — no names on WhatsApp), and this week's parent views.
  | { kind: 'parent_interest'; eventIds: string[]; shortlists: number; contacts: number; at: string }
  | { kind: 'profile_views'; views: number }

export type WaSend = {
  id: string
  createdAt: string
  undoneAt: string | null
  kinds: string[]
  applicationIds: string[]
  /** Forwards this send carried (PR-07), kept apart from the opened ones. */
  forwardedIds?: string[]
  /** Parent-interest events this send carried (PR-08). */
  interestEventIds?: string[]
  staffId: string | null
  staffName: string | null
}

/** Live (not undone) sends since the start of this Pakistan week. */
export function sendsThisWeek(sends: WaSend[], nowMs: number): WaSend[] {
  const start = pkWeekStartMs(nowMs)
  return sends.filter((s) => !s.undoneAt && Date.parse(s.createdAt) >= start)
}

/** Live sends today (Pakistan). */
export function sendsToday(sends: WaSend[], nowMs: number): WaSend[] {
  const start = pkDayStartMs(nowMs)
  return sends.filter((s) => !s.undoneAt && Date.parse(s.createdAt) >= start)
}

/** Application-opened events new enough to send: today or yesterday (Pakistan),
 *  so an evening open is still in the next morning's queue. */
export function openedWindowStartMs(nowMs: number): number {
  return pkDayStartMs(nowMs) - DAY_MS
}

/** The items still worth sending: application opens not already sent, and the
 *  weekly summary on Mondays when no send this week carried it. */
export function pendingWaItems(items: WaItem[], sends: WaSend[], nowMs: number): WaItem[] {
  const live = sends.filter((s) => !s.undoneAt)
  const sentApps = new Set(live.flatMap((s) => s.applicationIds))
  const sentForwards = new Set(live.flatMap((s) => s.forwardedIds ?? []))
  const sentInterest = new Set(live.flatMap((s) => s.interestEventIds ?? []))
  const week = sendsThisWeek(sends, nowMs)
  const summarySent = week.some((s) => s.kinds.includes('weekly_summary'))
  const viewsSent = week.some((s) => s.kinds.includes('profile_views'))
  const from = openedWindowStartMs(nowMs)
  const out: WaItem[] = []
  for (const i of items) {
    if (i.kind === 'application_opened') {
      if (!sentApps.has(i.applicationId) && Date.parse(i.at) >= from) out.push(i)
    } else if (i.kind === 'application_forwarded') {
      // PR-07: a forward to the parent, today or yesterday, not already sent.
      if (!sentForwards.has(i.applicationId) && Date.parse(i.at) >= from) out.push(i)
    } else if (i.kind === 'parent_interest') {
      // PR-08: only the events no live send carried yet; none left → no item.
      const left = i.eventIds.filter((id) => !sentInterest.has(id))
      if (left.length > 0) out.push(left.length === i.eventIds.length ? i : { ...i, eventIds: left })
    } else if (i.kind === 'profile_views') {
      // PR-08: this week's views, once a week.
      if (!viewsSent && i.views > 0) out.push(i)
    } else if (pkWeekday(nowMs) === SUMMARY_WEEKDAY && !summarySent && !allZero(i.numbers)) {
      out.push(i)
    }
  }
  return out
}

export type WaRowState = 'to_send' | 'sent_today' | 'hidden'

/**
 * Where a tutor stands in today's queue:
 *   hidden     — opted out, no WhatsApp number, not eligible, nothing to send,
 *                or already sent twice this week;
 *   sent_today — sent today (shown with who and when, and Undo);
 *   to_send    — counts in the sidebar badge.
 */
export function waRowState(p: { eligible: boolean; optedIn: boolean; hasNumber: boolean; pending: WaItem[]; sends: WaSend[] }, nowMs: number): WaRowState {
  if (!p.eligible || !p.optedIn || !p.hasNumber) return 'hidden'
  if (sendsToday(p.sends, nowMs).length > 0) return 'sent_today'
  if (p.pending.length === 0) return 'hidden'
  if (sendsThisWeek(p.sends, nowMs).length >= WA_WEEKLY_CAP) return 'hidden'
  return 'to_send'
}

/**
 * The ready WhatsApp message — plain English, no emoji, no price, no
 * superlative; greeting by first name, at most three lines before the one link
 * on its own line, then the support line (the template wording rules).
 */
export function waMessage(p: { firstName: string; items: WaItem[]; link: string; supportWhatsapp: string; unpaid?: boolean }): string {
  const name = p.firstName.trim()
  const opened = p.items.filter((i): i is Extract<WaItem, { kind: 'application_opened' }> => i.kind === 'application_opened')
  const forwarded = p.items.filter((i): i is Extract<WaItem, { kind: 'application_forwarded' }> => i.kind === 'application_forwarded')
  const summary = p.items.find((i): i is Extract<WaItem, { kind: 'weekly_summary' }> => i.kind === 'weekly_summary')
  const interest = p.items.find((i): i is Extract<WaItem, { kind: 'parent_interest' }> => i.kind === 'parent_interest')
  const views = p.items.find((i): i is Extract<WaItem, { kind: 'profile_views' }> => i.kind === 'profile_views')
  const sentences: string[] = []
  // A later sentence starts with a capital; the first follows the greeting.
  const lead = (s: string) => (sentences.length ? s.charAt(0).toUpperCase() + s.slice(1) : s)
  const named = (o: { jobTitle: string | null; area: string | null; city: string | null }) => {
    const place = safePlace(o.area) ?? safePlace(o.city)
    const title = (o.jobTitle ?? '').replace(/\s+/g, ' ').trim().slice(0, 50) || 'a tuition'
    return `${title}${place ? `, ${place}` : ''}`
  }
  // PR-07: the forward first — it comes before a parent can open it.
  if (forwarded.length === 1) sentences.push(lead(`your application for ${named(forwarded[0])} was sent to the parent.`))
  else if (forwarded.length > 1) sentences.push(lead(`${forwarded.length} of your applications were sent to the parents.`))
  if (opened.length === 1) sentences.push(lead(`a parent opened your application for ${named(opened[0])}.`))
  else if (opened.length > 1) sentences.push(lead(`parents opened ${opened.length} of your applications.`))
  // PR-08 (unpaid tutors): real counts only, no names on WhatsApp.
  if (interest) {
    const contactWords = p.unpaid ? 'tried to contact you' : 'contacted you'
    if (interest.contacts === 0) sentences.push(lead(`${plural(interest.shortlists, 'parent', 'parents')} shortlisted your profile.`))
    else if (interest.shortlists === 0) sentences.push(lead(`${plural(interest.contacts, 'parent', 'parents')} ${contactWords}.`))
    else sentences.push(lead(`${plural(interest.shortlists, 'parent', 'parents')} shortlisted your profile and ${plural(interest.contacts, 'parent', 'parents')} ${contactWords}.`))
  }
  if (views && views.views > 0) sentences.push(lead(`parents viewed your profile ${views.views === 1 ? 'once' : `${views.views} times`} this week.`))
  if (p.unpaid && (interest || views)) sentences.push('Get verified so parents can contact you.')
  if (summary) {
    const n = summary.numbers
    const week = `${plural(n.views, 'profile view', 'profile views')}, ${plural(n.applications, 'application sent', 'applications sent')}, ${plural(n.tuitions, 'new tuition', 'new tuitions')} in your areas.`
    sentences.push(sentences.length ? `Your week: ${week}` : `your week: ${week}`)
  }
  // The greeting carries the first sentence, so the message is at most three
  // lines before its one link; any further sentences share the second line.
  const rest = sentences.slice(1)
  const lines = [`Assalam o Alaikum${name ? ` ${name}` : ''}, ${sentences[0] ?? 'here is your update.'}`, ...(rest.length ? [rest.join(' ')] : [])]
  lines.push('See the details here:', p.link, `Need help? WhatsApp ${p.supportWhatsapp}`)
  return lines.join('\n')
}

/** The kinds a send carried, for the log. */
export function waKinds(items: WaItem[]): string[] {
  return [...new Set(items.map((i) => i.kind))]
}

/** Undo: the sender (or the Owner), the same Pakistan day, not already undone. */
export function mayUndoWaSend(send: Pick<WaSend, 'createdAt' | 'undoneAt' | 'staffId'>, actor: { id: string; adminRole: string | null }, nowMs: number): string | null {
  if (send.undoneAt) return 'That send was already undone.'
  if (send.staffId !== actor.id && actor.adminRole !== 'owner') return 'Only the person who sent it can undo it.'
  if (Date.parse(send.createdAt) < pkDayStartMs(nowMs)) return 'A send can only be undone on the day it was sent.'
  return null
}

// ----------------------------------------------------------- today's plan ---

export type SentLog = { kind: string; created_at: string }

/**
 * What one tutor gets today, under the cap, from their own teaser log (the
 * notifications already sent). The weekly summary (Monday) and the views
 * teaser or 0-views tip (Thursday) go first; then the daily new-tuitions one.
 * Each kind at most once a day, the weekly ones once a week.
 */
export function planForTutor(p: {
  nowMs: number
  log: SentLog[]
  views: { parents: ParentViewer[]; otherVisitors: number } | undefined
  newTuitions: { count: number; href: string }
  weekly: WeeklyNumbers | undefined
  missing: { label: string; href: string } | null
  /** PR-08: false for an unpaid tutor (no weekly summary; the new-tuitions
   *  teaser says what stands before Apply). Default true. */
  paid?: boolean
  /** PR-08: the unpaid tutor's step before Apply. */
  unpaidApply?: { body: string; href: string } | null
  /** PR-08: today's grouped parent-interest alert, already built from real
   *  events (null when none). At most one a day; counts towards the cap. */
  interest?: { text: TeaserText; meta?: Record<string, unknown> } | null
}): { kind: TeaserKind; text: TeaserText; meta?: Record<string, unknown> }[] {
  const { nowMs } = p
  const paid = p.paid !== false
  const weekStart = pkWeekStartMs(nowMs)
  const dayStart = pkDayStartMs(nowMs)
  const teasers = p.log.filter((l) => (TEASER_KINDS as readonly string[]).includes(l.kind))
  const thisWeek = teasers.filter((l) => Date.parse(l.created_at) >= weekStart)
  let sentThisWeek = thisWeek.length
  const sentToday = new Set(teasers.filter((l) => Date.parse(l.created_at) >= dayStart).map((l) => l.kind))
  const sentWeekKinds = new Set(thisWeek.map((l) => l.kind))
  const lastTip = teasers.filter((l) => l.kind === 'teaser_views_tip').map((l) => l.created_at).sort().pop() ?? null
  const out: { kind: TeaserKind; text: TeaserText; meta?: Record<string, unknown> }[] = []
  const day = pkWeekday(nowMs)

  if (paid && day === SUMMARY_WEEKDAY && p.weekly && !sentWeekKinds.has('teaser_weekly_summary') && weeklyTeaserAllowed(sentThisWeek)) {
    const text = weeklySummaryTeaser(p.weekly)
    if (text) {
      out.push({ kind: 'teaser_weekly_summary', text, meta: { ...p.weekly } })
      sentThisWeek++
    }
  }
  if (day === VIEWS_TEASER_WEEKDAY && !sentWeekKinds.has('teaser_profile_views') && !sentWeekKinds.has('teaser_views_tip') && weeklyTeaserAllowed(sentThisWeek)) {
    const text = viewsTeaser({ parents: p.views?.parents ?? [], otherVisitors: p.views?.otherVisitors ?? 0 })
    if (text) {
      out.push({ kind: 'teaser_profile_views', text })
      sentThisWeek++
    } else if (tipDue(lastTip, nowMs)) {
      out.push({ kind: 'teaser_views_tip', text: viewsTip(p.missing) })
      sentThisWeek++
    }
  }
  // Parent interest before new tuitions: a real parent is the stronger news.
  if (p.interest && !sentToday.has('teaser_parent_interest') && dailyTeaserAllowed(sentThisWeek, nowMs)) {
    out.push({ kind: 'teaser_parent_interest', text: p.interest.text, meta: p.interest.meta })
    sentThisWeek++
  }
  if (!sentToday.has('teaser_new_tuitions') && dailyTeaserAllowed(sentThisWeek, nowMs)) {
    const text = newTuitionsTeaser(p.newTuitions.count, p.newTuitions.href, paid ? null : (p.unpaidApply ?? null))
    if (text) out.push({ kind: 'teaser_new_tuitions', text, meta: { count: p.newTuitions.count } })
  }
  return out
}
