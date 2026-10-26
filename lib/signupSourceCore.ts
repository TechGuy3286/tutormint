// lib/signupSourceCore.ts
//
// PURE. Where a sign-up came from, grouped (owner, 17 Oct 2026).
//
// A member's first touch is profiles.utm_source (lib/utm). AI assistants put
// their own site in it when they link to us — ChatGPT adds
// ?utm_source=chatgpt.com to every link it shows — so "Came from: chatgpt.com"
// is a tutor who found us through ChatGPT. Every such site is grouped under ONE
// source, "AI assistants"; the exact site stays visible on the member page
// ("AI assistant · chatgpt.com") and in the per-site breakdown.

export const AI_ASSISTANTS = 'AI assistants'

/** Known AI-assistant sites, as the host they send (www. removed). */
const AI_HOSTS: Record<string, string> = {
  'chatgpt.com': 'chatgpt.com',
  'chat.openai.com': 'chat.openai.com',
  'openai.com': 'openai.com',
  'gemini.google.com': 'gemini.google.com',
  'bard.google.com': 'bard.google.com',
  'aistudio.google.com': 'aistudio.google.com',
  'perplexity.ai': 'perplexity.ai',
  'copilot.microsoft.com': 'copilot.microsoft.com',
  'copilot.com': 'copilot.com',
  'claude.ai': 'claude.ai',
  'chat.deepseek.com': 'chat.deepseek.com',
  'deepseek.com': 'deepseek.com',
  'meta.ai': 'meta.ai',
  'grok.com': 'grok.com',
  'you.com': 'you.com',
  'phind.com': 'phind.com',
  'poe.com': 'poe.com',
  'chat.mistral.ai': 'chat.mistral.ai',
}

/** A bare name some assistants send instead of a host → the site it means. */
const AI_NAMES: Record<string, string> = {
  chatgpt: 'chatgpt.com',
  openai: 'openai.com',
  gemini: 'gemini.google.com',
  perplexity: 'perplexity.ai',
  copilot: 'copilot.microsoft.com',
  claude: 'claude.ai',
  deepseek: 'chat.deepseek.com',
}

/** utm_source → its host: lower case, scheme, www., path and port dropped. */
function hostOf(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, '')
    .replace(/^www\./, '')
    .split(/[/?#:]/)[0]
}

/**
 * The AI-assistant site a utm_source names, or null when it is not one. A
 * subdomain of a known host counts (e.g. "labs.perplexity.ai").
 */
export function aiAssistantSite(utmSource: string | null | undefined): string | null {
  if (!utmSource || !utmSource.trim()) return null
  const host = hostOf(utmSource)
  if (!host) return null
  if (AI_NAMES[host]) return AI_NAMES[host]
  if (AI_HOSTS[host]) return AI_HOSTS[host]
  for (const known of Object.keys(AI_HOSTS)) {
    if (host.endsWith(`.${known}`)) return AI_HOSTS[known]
  }
  return null
}

export type SourceGroup = 'ai' | 'campaign' | 'direct'

/** Which group a sign-up belongs to. */
export function sourceGroup(utmSource: string | null | undefined): SourceGroup {
  if (aiAssistantSite(utmSource)) return 'ai'
  return utmSource && utmSource.trim() ? 'campaign' : 'direct'
}

export const SOURCE_GROUP_LABEL: Record<SourceGroup, string> = {
  ai: AI_ASSISTANTS,
  campaign: 'Other links and campaigns',
  direct: 'Direct (no source)',
}

/**
 * How "Came from" reads on an admin screen: "AI assistant · chatgpt.com" for
 * an AI assistant (medium and campaign after it, if any), else the caller's
 * usual line.
 */
export function describeSource(
  utm: { utm_source?: string | null; utm_medium?: string | null; utm_campaign?: string | null } | null | undefined,
  usual: string | null,
): string | null {
  const site = aiAssistantSite(utm?.utm_source)
  if (!site) return usual
  const rest = [utm?.utm_medium, utm?.utm_campaign].filter((v) => v && v.trim())
  return ['AI assistant', site, ...rest].join(' · ')
}

export type SourceWindowKey = 'today' | 'yesterday' | 'last7' | 'month'

export type SourceRow = {
  group: SourceGroup
  label: string
  counts: Record<SourceWindowKey, number>
  /** AI assistants only: one row per site. */
  sites?: { site: string; counts: Record<SourceWindowKey, number> }[]
}

const zero = (): Record<SourceWindowKey, number> => ({ today: 0, yesterday: 0, last7: 0, month: 0 })

/**
 * Count sign-ups per source group for the four windows. `windows` gives each
 * window's [from, to) in ms; a sign-up counts in every window it falls in.
 */
export function countSources(
  signups: { createdAtMs: number; utmSource: string | null }[],
  windows: Record<SourceWindowKey, { fromMs: number; toMs: number }>,
): SourceRow[] {
  const groups: Record<SourceGroup, Record<SourceWindowKey, number>> = { ai: zero(), campaign: zero(), direct: zero() }
  const sites = new Map<string, Record<SourceWindowKey, number>>()
  for (const s of signups) {
    const g = sourceGroup(s.utmSource)
    const site = g === 'ai' ? aiAssistantSite(s.utmSource) : null
    for (const k of Object.keys(windows) as SourceWindowKey[]) {
      const w = windows[k]
      if (s.createdAtMs < w.fromMs || s.createdAtMs >= w.toMs) continue
      groups[g][k] += 1
      if (site) {
        const c = sites.get(site) ?? zero()
        c[k] += 1
        sites.set(site, c)
      }
    }
  }
  return (['ai', 'campaign', 'direct'] as SourceGroup[]).map((g) => ({
    group: g,
    label: SOURCE_GROUP_LABEL[g],
    counts: groups[g],
    ...(g === 'ai'
      ? { sites: [...sites.entries()].sort((a, b) => b[1].month - a[1].month || a[0].localeCompare(b[0])).map(([site, counts]) => ({ site, counts })) }
      : {}),
  }))
}

// ------------------------------------------- AI assistants summary (26 Oct 2026)

export type AiWindowKey = 'last7' | 'last30' | 'all'
export const AI_WINDOW_LABEL: Record<AiWindowKey, string> = { last7: 'Last 7 days', last30: 'Last 30 days', all: 'All time' }

export type AiTotals = {
  signups: Record<AiWindowKey, number>
  /** Of those sign-ups, the tutors who have paid the Verification Fee. */
  paidTutors: Record<AiWindowKey, number>
  sites: { site: string; signups: Record<AiWindowKey, number>; paidTutors: Record<AiWindowKey, number> }[]
}

const zeroAi = (): Record<AiWindowKey, number> => ({ last7: 0, last30: 0, all: 0 })

/**
 * The "AI assistants" source group (owner, 26 Oct 2026): sign-ups whose first
 * touch was an AI-assistant site (chatgpt.com, gemini, perplexity, copilot,
 * claude.ai and similar), and how many of those are tutors who paid — for the
 * last 7 days, the last 30 days and all time, by sign-up date.
 */
export function aiAssistantTotals(
  signups: { createdAtMs: number; utmSource: string | null; role: string | null; paid: boolean }[],
  nowMs: number,
): AiTotals {
  const DAY = 86_400_000
  const from: Record<AiWindowKey, number> = { last7: nowMs - 7 * DAY, last30: nowMs - 30 * DAY, all: -Infinity }
  const total: AiTotals = { signups: zeroAi(), paidTutors: zeroAi(), sites: [] }
  const bySite = new Map<string, { signups: Record<AiWindowKey, number>; paidTutors: Record<AiWindowKey, number> }>()
  for (const s of signups) {
    const site = aiAssistantSite(s.utmSource)
    if (!site) continue
    const row = bySite.get(site) ?? { signups: zeroAi(), paidTutors: zeroAi() }
    for (const k of Object.keys(from) as AiWindowKey[]) {
      if (s.createdAtMs < from[k] || s.createdAtMs > nowMs) continue
      total.signups[k] += 1
      row.signups[k] += 1
      if (s.role === 'tutor' && s.paid) {
        total.paidTutors[k] += 1
        row.paidTutors[k] += 1
      }
    }
    bySite.set(site, row)
  }
  total.sites = [...bySite.entries()]
    .sort((a, b) => b[1].signups.all - a[1].signups.all || a[0].localeCompare(b[0]))
    .map(([site, r]) => ({ site, ...r }))
  return total
}
