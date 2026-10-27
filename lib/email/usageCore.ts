// lib/email/usageCore.ts — PURE. The Email usage table (owner, 27 Oct 2026):
// per UTC day (Resend's limit is a UTC day) and per type: sent, skipped (with
// the reasons), failed and queued. Built from email_sends rows; an address is
// never part of it.

export type UsageSend = { at: string; template: string; status: string; reason: string | null }

export type UsageRow = {
  day: string
  template: string
  sent: number
  skipped: number
  failed: number
  queued: number
  /** reason → count, for the skipped ones. */
  skipReasons: Record<string, number>
}

/** A reason without any address or long number in it, short. */
export function cleanReason(r: string | null | undefined): string {
  return String(r ?? 'no reason')
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[address]')
    .replace(/\d{7,}/g, '[number]')
    .slice(0, 80)
}

export function usageTable(sends: readonly UsageSend[]): UsageRow[] {
  const by = new Map<string, UsageRow>()
  for (const s of sends) {
    const day = s.at.slice(0, 10)
    const k = `${day}|${s.template}`
    const row = by.get(k) ?? { day, template: s.template, sent: 0, skipped: 0, failed: 0, queued: 0, skipReasons: {} }
    if (s.status === 'sent') row.sent++
    else if (s.status === 'queued') row.queued++
    else if (s.status === 'skipped') {
      row.skipped++
      const r = cleanReason(s.reason)
      row.skipReasons[r] = (row.skipReasons[r] ?? 0) + 1
    } else row.failed++
    by.set(k, row)
  }
  return [...by.values()].sort((a, b) => b.day.localeCompare(a.day) || b.sent - a.sent || a.template.localeCompare(b.template))
}

/** Day totals (for the page header row of each day). */
export function dayTotals(rows: readonly UsageRow[]): { day: string; sent: number; skipped: number; failed: number; queued: number }[] {
  const by = new Map<string, { day: string; sent: number; skipped: number; failed: number; queued: number }>()
  for (const r of rows) {
    const t = by.get(r.day) ?? { day: r.day, sent: 0, skipped: 0, failed: 0, queued: 0 }
    t.sent += r.sent
    t.skipped += r.skipped
    t.failed += r.failed
    t.queued += r.queued
    by.set(r.day, t)
  }
  return [...by.values()].sort((a, b) => b.day.localeCompare(a.day))
}
