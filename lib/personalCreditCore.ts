// lib/personalCreditCore.ts — PURE rules for "Not business (personal)" on a bank
// credit (owner, 10 Nov 2026; migration 228). I/O in lib/personalCredits.ts.
//
// The Owner marks a bank-received entry as personal money with a short note.
// A marked credit is left out of Received in bank, the PayPro settlement, Due
// from PayPro, revenue and every Finance total (lib/ignoredCredits). It stays
// listed in a grey line under its month with an Undo. Nothing is deleted.

export const PERSONAL_LABEL = 'Not business (personal)'
export const NOTE_MIN = 3
export const NOTE_MAX = 500

export type PersonalState = { personalAt: string | null }

/** Why a mark cannot be saved, or null. */
export function personalMarkProblem(row: PersonalState | null, note: string): { status: number; error: string } | null {
  if (!row) return { status: 404, error: 'That bank credit was not found.' }
  if (row.personalAt) return { status: 409, error: 'This entry is already marked as personal.' }
  const n = note.trim()
  if (n.length < NOTE_MIN) return { status: 400, error: 'Add a short note.' }
  if (n.length > NOTE_MAX) return { status: 400, error: 'Keep the note under 500 characters.' }
  return null
}

/** Why an Undo cannot be done, or null. */
export function personalUndoProblem(row: PersonalState | null): { status: number; error: string } | null {
  if (!row) return { status: 404, error: 'That bank credit was not found.' }
  if (!row.personalAt) return { status: 409, error: 'This entry is not marked as personal.' }
  return null
}

export type PersonalEntry = {
  id: string
  /** YYYY-MM-DD, the day the money arrived. */
  date: string
  amountPkr: number
  note: string | null
  byName: string | null
  markedAt: string
}

export type PersonalMonth = { month: string; count: number; amount: number; entries: PersonalEntry[] }

const round2 = (n: number) => Math.round(n * 100) / 100

/** Marked entries grouped by the month the money arrived, newest month first. */
export function personalByMonth(entries: PersonalEntry[]): PersonalMonth[] {
  const by = new Map<string, PersonalEntry[]>()
  for (const e of entries) by.set(e.date.slice(0, 7), [...(by.get(e.date.slice(0, 7)) ?? []), e])
  return [...by.entries()]
    .map(([month, es]) => ({
      month,
      count: es.length,
      amount: round2(es.reduce((s, e) => s + e.amountPkr, 0)),
      entries: [...es].sort((a, b) => a.date.localeCompare(b.date)),
    }))
    .sort((a, b) => b.month.localeCompare(a.month))
}

/** "Personal, excluded: Rs 10,000 (1 entry)" — the grey line under a month. */
export function personalMonthLine(m: Pick<PersonalMonth, 'count' | 'amount'>): string {
  return `Personal, excluded: Rs ${m.amount.toLocaleString('en-PK', { maximumFractionDigits: 2 })} (${m.count} ${m.count === 1 ? 'entry' : 'entries'})`
}
