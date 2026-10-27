// lib/dailyReportCore.ts
//
// Team activity → "Send today's report on WhatsApp" (owner, 16 Oct 2026). The
// daily message staff used to copy by hand, built on the SERVER from the same
// data as the page (lib/dailyReport) and opened as a wa.me link. Pure: no I/O,
// so the text, the encoding and the length rule are unit-tested.
//
// Two sections, today only (Pakistan time):
//   Tuitions posted today: N        one line per tuition — ID · subject · area · fee
//   Signed up today: N              one line per person who PAID today —
//                                   name · Tutor/Parent · staff member
// An empty section prints "none". The whole message stays under
// REPORT_MAX_CHARS; when the full list would not fit, each section keeps the
// count and its first REPORT_LIST_CAP items (fewer if still too long), then
// "…and N more".

import { waSendHref } from './waLinkCore'

export const REPORT_PHONE = '923215872222'
export const REPORT_MAX_CHARS = 1500
export const REPORT_LIST_CAP = 15
const LINE_MAX = 70

export type ReportTuition = { ref: string; subject: string | null; area: string | null; fee: string | null }
export type ReportSignup = { name: string; role: 'tutor' | 'parent'; staff: string }

function clip(s: string, n: number): string {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length <= n ? t : `${t.slice(0, n - 1).trimEnd()}…`
}

export function tuitionLine(t: ReportTuition): string {
  return clip([t.ref, t.subject, t.area, t.fee].filter((x) => x && String(x).trim()).join(' · '), LINE_MAX)
}

export function signupLine(s: ReportSignup): string {
  return clip(`${s.name} · ${s.role === 'tutor' ? 'Tutor' : 'Parent'} · ${s.staff}`, LINE_MAX)
}

function section(heading: string, lines: string[], shown: number): string[] {
  if (lines.length === 0) return [`${heading}: none`]
  const out = [`${heading}: ${lines.length}`, ...lines.slice(0, shown)]
  const more = lines.length - Math.min(shown, lines.length)
  if (more > 0) out.push(`…and ${more} more`)
  return out
}

/** The message text. `dateLabel` e.g. "16 Oct 2026". */
export function buildDailyReport(dateLabel: string, tuitions: ReportTuition[], signups: ReportSignup[]): string {
  const tLines = tuitions.map(tuitionLine)
  const sLines = signups.map(signupLine)
  const compose = (tCap: number, sCap: number) =>
    [`TutorMint daily report — ${dateLabel}`, '', ...section('Tuitions posted today', tLines, tCap), '', ...section('Signed up today', sLines, sCap)].join(
      '\n',
    )
  // Everything when it fits; otherwise the first 15 of each, shrinking the
  // longer list until the message fits.
  const full = compose(tLines.length, sLines.length)
  if (full.length < REPORT_MAX_CHARS) return full
  let tCap = Math.min(REPORT_LIST_CAP, tLines.length)
  let sCap = Math.min(REPORT_LIST_CAP, sLines.length)
  let text = compose(tCap, sCap)
  while (text.length >= REPORT_MAX_CHARS && (tCap > 0 || sCap > 0)) {
    if (tCap >= sCap && tCap > 0) tCap--
    else sCap--
    text = compose(tCap, sCap)
  }
  return text
}

export function whatsappReportLink(text: string): string {
  return waSendHref(REPORT_PHONE, text)
}
