// lib/paidWelcomeCore.ts
//
// "Send welcome" for every new paid tutor (owner, 9 Nov 2026) — the PURE half:
// the WhatsApp message, the "Welcomed ✓" line, and the "Paid, not welcomed"
// rule the Overview to-do row and the People card both read. No I/O.
//
// A welcome is a member_follow_ups row with source 'welcome' (migration 226),
// written by the staff member who tapped it, with the same 10-second Undo as
// every follow-up. A tutor counts as "Paid, not welcomed" when their
// Verification Fee was paid in the last 30 days and no welcome stands.

export const WELCOME_SOURCE = 'welcome' as const
export const WELCOME_TEMPLATE_KEY = 'paid_welcome'
export const WELCOME_WINDOW_DAYS = 30
export const WELCOME_TODO_KEY = 'todo-not-welcomed'
export const STATUS_IMAGE_SIZE = { width: 1080, height: 1920 } as const

export type Welcome = { id: string; at: string; by: string | null }

export type WelcomeFacts = {
  firstName: string
  /** The live public profile address, or null when it is not public yet. */
  profileUrl: string | null
  /** An upgrade the tutor holds (Premium / Featured) and its end date. */
  plan?: { name: string; endsOn: string } | null
  supportWhatsapp: string
}

/** The welcome text — plain English, no prices, no superlatives. */
export function welcomeMessage(f: WelcomeFacts): string {
  const name = f.firstName.trim()
  const lines = [
    `Assalam o Alaikum${name ? ` ${name}` : ''}, thank you for joining TutorMint and getting verified.`,
  ]
  if (f.profileUrl) {
    lines.push('Your public profile is live. Please share it with parents you know:', f.profileUrl)
  } else {
    lines.push('Your public profile goes live as soon as your documents are approved.')
  }
  lines.push('We are also sending you a status image. Please put it on your WhatsApp status so parents near you see it.')
  if (f.plan) lines.push(`Your ${f.plan.name} plan is active until ${f.plan.endsOn}.`)
  lines.push(`Need help? WhatsApp ${f.supportWhatsapp}`)
  return lines.join('\n')
}

/** "Welcomed ✓ by Aqsa, 9 Nov 2026". */
export function welcomedLine(w: Welcome, fmt: (iso: string) => string): string {
  return `Welcomed ✓${w.by ? ` by ${w.by}` : ''}, ${fmt(w.at)}`
}

/** Paid in the last 30 days and not welcomed. */
export function welcomeDue(paidAt: string | null | undefined, welcome: Welcome | null | undefined, nowMs: number): boolean {
  if (!paidAt || welcome) return false
  const t = Date.parse(paidAt)
  if (!Number.isFinite(t) || t > nowMs) return false
  return nowMs - t <= WELCOME_WINDOW_DAYS * 86_400_000
}

/** How many paid tutors are waiting for a welcome. */
export function countPaidNotWelcomed(rows: { paidAt: string | null; welcome: Welcome | null }[], nowMs: number): number {
  return rows.filter((r) => welcomeDue(r.paidAt, r.welcome, nowMs)).length
}

/** The newest welcome that has not been undone. */
export function currentWelcome(rows: { id: string; created_at: string; undone_at: string | null; staff_name: string | null }[]): Welcome | null {
  const live = rows.filter((r) => !r.undone_at).sort((a, b) => b.created_at.localeCompare(a.created_at))[0]
  return live ? { id: live.id, at: live.created_at, by: live.staff_name } : null
}
