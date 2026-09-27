// lib/timeSlots.ts
//
// One time model for the whole platform (PR73 §A). A tutor's availability and a
// tuition's schedule are a list of day+slot pairs, where a slot is one of three
// coarse bands — never a free-text time. PURE (no React, no DB) so the grid, the
// forms, the server save paths, the display helpers and the backfill all read
// one source, and the parser is unit-tested.
//
// Cut-offs (owner PR73 §A.1): Morning = before 12 pm; Afternoon = 12–4 pm;
// Evening = after 4 pm. So 4:00 pm (16:00) is Evening.

export type SlotKey = 'morning' | 'afternoon' | 'evening'
export type DayKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun'
export type DaySlot = { day: DayKey; slot: SlotKey }

export const DAYS: { key: DayKey; short: string; full: string; ur: string }[] = [
  { key: 'mon', short: 'Mon', full: 'Monday', ur: 'پیر' },
  { key: 'tue', short: 'Tue', full: 'Tuesday', ur: 'منگل' },
  { key: 'wed', short: 'Wed', full: 'Wednesday', ur: 'بدھ' },
  { key: 'thu', short: 'Thu', full: 'Thursday', ur: 'جمعرات' },
  { key: 'fri', short: 'Fri', full: 'Friday', ur: 'جمعہ' },
  { key: 'sat', short: 'Sat', full: 'Saturday', ur: 'ہفتہ' },
  { key: 'sun', short: 'Sun', full: 'Sunday', ur: 'اتوار' },
]

export const SLOTS: { key: SlotKey; en: string; ur: string; hint: string }[] = [
  { key: 'morning', en: 'Morning', ur: 'صبح', hint: 'before 12 pm' },
  { key: 'afternoon', en: 'Afternoon', ur: 'دوپہر', hint: '12–4 pm' },
  { key: 'evening', en: 'Evening', ur: 'شام', hint: 'after 4 pm' },
]

const DAY_ORDER: Record<DayKey, number> = { mon: 0, tue: 1, wed: 2, thu: 3, fri: 4, sat: 5, sun: 6 }
const SLOT_ORDER: Record<SlotKey, number> = { morning: 0, afternoon: 1, evening: 2 }
const DAY_BY_ORDER = (['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as DayKey[])

const dayShort = (d: DayKey) => DAYS.find((x) => x.key === d)!.short
const slotEn = (s: SlotKey) => SLOTS.find((x) => x.key === s)!.en

/** A 24-hour clock hour → its slot (Morning <12, Afternoon 12–<16, Evening ≥16). */
export function slotForHour(hour24: number): SlotKey {
  if (hour24 < 12) return 'morning'
  if (hour24 < 16) return 'afternoon'
  return 'evening'
}

/** Normalise + dedupe a list of day+slot pairs into a stable order. */
export function normalizeSlots(list: DaySlot[]): DaySlot[] {
  const seen = new Set<string>()
  const out: DaySlot[] = []
  for (const s of list) {
    if (!DAY_ORDER.hasOwnProperty(s.day) || !SLOT_ORDER.hasOwnProperty(s.slot)) continue
    const k = `${s.day}:${s.slot}`
    if (seen.has(k)) continue
    seen.add(k)
    out.push({ day: s.day, slot: s.slot })
  }
  out.sort((a, b) => DAY_ORDER[a.day] - DAY_ORDER[b.day] || SLOT_ORDER[a.slot] - SLOT_ORDER[b.slot])
  return out
}

/** Parse a value that might be DaySlot[] (jsonb) into a clean DaySlot[]. */
export function coerceSlots(value: unknown): DaySlot[] {
  if (!Array.isArray(value)) return []
  const out: DaySlot[] = []
  for (const v of value) {
    if (v && typeof v === 'object' && 'day' in v && 'slot' in v) {
      out.push({ day: String((v as { day: unknown }).day) as DayKey, slot: String((v as { slot: unknown }).slot) as SlotKey })
    }
  }
  return normalizeSlots(out)
}

// ---- display ----------------------------------------------------------------

/**
 * "Mon, Tue, Wed: Evening · Sat: Morning" — one short line, everywhere.
 * Groups days by the exact set of slots they share, in day then slot order.
 */
export function formatSlots(list: DaySlot[]): string {
  const slots = normalizeSlots(list)
  if (slots.length === 0) return ''
  // day → sorted slot list
  const byDay = new Map<DayKey, SlotKey[]>()
  for (const s of slots) {
    if (!byDay.has(s.day)) byDay.set(s.day, [])
    byDay.get(s.day)!.push(s.slot)
  }
  // group days that share the identical slot set, preserving day order
  const groups: { days: DayKey[]; slotLabel: string }[] = []
  for (const day of DAY_BY_ORDER) {
    const ds = byDay.get(day)
    if (!ds) continue
    const label = ds.map(slotEn).join(', ')
    const last = groups[groups.length - 1]
    if (last && last.slotLabel === label) last.days.push(day)
    else groups.push({ days: [day], slotLabel: label })
  }
  return groups.map((g) => `${g.days.map(dayShort).join(', ')}: ${g.slotLabel}`).join(' · ')
}

// ---- backfill / free-text parsing ------------------------------------------

const DAY_WORDS: { re: RegExp; days: DayKey[] }[] = [
  { re: /\bevery\s?day\b|\ball\s?days?\b|\bdaily\b/i, days: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] },
  { re: /\bweek\s?days?\b/i, days: ['mon', 'tue', 'wed', 'thu', 'fri'] },
  { re: /\bweek\s?ends?\b/i, days: ['sat', 'sun'] },
  { re: /\bmon(day)?\b/i, days: ['mon'] },
  { re: /\btue(s|sday)?\b/i, days: ['tue'] },
  { re: /\bwed(nesday)?\b/i, days: ['wed'] },
  { re: /\bthu(r|rs|rsday)?\b/i, days: ['thu'] },
  { re: /\bfri(day)?\b/i, days: ['fri'] },
  { re: /\bsat(urday)?\b/i, days: ['sat'] },
  { re: /\bsun(day)?\b/i, days: ['sun'] },
]

/** Every day named in a free-text schedule; [] when none (caller may default). */
export function daysFromText(text: string): DayKey[] {
  const t = text.toLowerCase()
  const found = new Set<DayKey>()
  // "every day"/"weekdays"/"weekends" win as a group; then individual days.
  if (/\bevery\s?day\b|\ball\s?days?\b|\bdaily\b/i.test(t)) return [...DAY_BY_ORDER]
  let groupHit = false
  if (/\bweek\s?days?\b/i.test(t)) { for (const d of ['mon', 'tue', 'wed', 'thu', 'fri'] as DayKey[]) found.add(d); groupHit = true }
  if (/\bweek\s?ends?\b/i.test(t)) { found.add('sat'); found.add('sun'); groupHit = true }
  if (!groupHit) {
    for (const { re, days } of DAY_WORDS.slice(3)) if (re.test(t)) days.forEach((d) => found.add(d))
  }
  return DAY_BY_ORDER.filter((d) => found.has(d))
}

/**
 * The slots a free-text TIME covers, or null when it cannot be understood
 * (a bare number with no am/pm, an empty string). Word forms
 * (morning/afternoon/evening/night) and clock forms ("4:00 PM",
 * "04:00 PM - 07:00 PM", "10 AM to 10 PM") are parsed.
 */
export function slotsFromTimeText(text: string): SlotKey[] | null {
  const t = text.toLowerCase().trim()
  if (!t) return null
  const words = new Set<SlotKey>()
  if (/\bmornings?\b/.test(t)) words.add('morning')
  if (/\bafternoons?\b/.test(t)) words.add('afternoon')
  if (/\bevenings?\b|\bnights?\b/.test(t)) words.add('evening')
  if (words.size > 0) return [...words].sort((a, b) => SLOT_ORDER[a] - SLOT_ORDER[b])

  // Clock times WITH am/pm (a bare number is ambiguous → unparseable).
  const clock = [...t.matchAll(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)/g)]
  if (clock.length === 0) return null
  const toHour = (m: RegExpMatchArray): number => {
    let h = parseInt(m[1], 10) % 12
    if (m[3] === 'pm') h += 12
    return h
  }
  const hours = clock.map(toHour)
  if (hours.length === 1) return [slotForHour(hours[0])]
  // A range: cover every slot from the first to the last hour (inclusive).
  const start = Math.min(...hours)
  const end = Math.max(...hours)
  const covered = new Set<SlotKey>()
  for (let h = start; h <= end; h++) covered.add(slotForHour(h))
  return [...covered].sort((a, b) => SLOT_ORDER[a] - SLOT_ORDER[b])
}

/**
 * A tuition's free-text `timings` ("Weekdays, Evenings", "Mon/Wed/Fri evenings")
 * → day+slot pairs, or null when the time part cannot be understood. When days
 * are named but no time, or a time but no days, returns null (kept in old
 * column, reported) — we do not invent the missing half.
 */
export function parseTimings(text: string): DaySlot[] | null {
  if (!text || !text.trim()) return null
  const days = daysFromText(text)
  const slots = slotsFromTimeText(text)
  if (slots === null) return null
  const useDays = days.length > 0 ? days : [...DAY_BY_ORDER] // "Evenings" alone → every day
  const out: DaySlot[] = []
  for (const d of useDays) for (const s of slots) out.push({ day: d, slot: s })
  return normalizeSlots(out)
}

/**
 * A tutor's legacy availability_list (each element JSON {day, timeSlot}) → day+
 * slot pairs. Parseable entries convert; unparseable ones are skipped (and stay
 * in the old column). Returns { slots, unparsed } so the backfill can report.
 */
export function parseAvailabilityList(items: { day: string; timeSlot: string }[]): { slots: DaySlot[]; unparsed: { day: string; timeSlot: string }[] } {
  const out: DaySlot[] = []
  const unparsed: { day: string; timeSlot: string }[] = []
  for (const it of items) {
    const days = daysFromText(it.day)
    const slots = slotsFromTimeText(it.timeSlot ?? '')
    if (days.length === 0 || slots === null) { unparsed.push(it); continue }
    for (const d of days) for (const s of slots) out.push({ day: d, slot: s })
  }
  return { slots: normalizeSlots(out), unparsed }
}

/** Sync the OLD tutor column: one {day, timeSlot} per slot, timeSlot = the label. */
export function slotsToAvailabilityList(list: DaySlot[]): string[] {
  return normalizeSlots(list).map((s) =>
    JSON.stringify({ day: DAYS.find((d) => d.key === s.day)!.full, timeSlot: slotEn(s.slot) }),
  )
}

/**
 * Read a tutor's availability_list (a text[] whose elements are JSON strings, or
 * already-parsed objects) into {day, timeSlot} pairs — tolerant of both shapes. */
export function readAvailabilityRaw(raw: unknown): { day: string; timeSlot: string }[] {
  if (!Array.isArray(raw)) return []
  const out: { day: string; timeSlot: string }[] = []
  for (const el of raw) {
    let obj: unknown = el
    if (typeof el === 'string') {
      try { obj = JSON.parse(el) } catch { continue }
    }
    if (obj && typeof obj === 'object' && 'day' in obj) {
      const o = obj as { day?: unknown; timeSlot?: unknown; slot?: unknown }
      // A new-shape {day, slot} element (already a slot) OR an old {day, timeSlot}.
      if (typeof o.slot === 'string') out.push({ day: String(o.day), timeSlot: slotEn(o.slot as SlotKey) })
      else out.push({ day: String(o.day ?? ''), timeSlot: String(o.timeSlot ?? '') })
    }
  }
  return out
}

/** A tutor's availability_list → DaySlot[] for the grid (parseable entries only). */
export function availabilityToSlots(raw: unknown): DaySlot[] {
  return parseAvailabilityList(readAvailabilityRaw(raw)).slots
}
