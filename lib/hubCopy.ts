// lib/hubCopy.ts
//
// The words on a hub page (owner, 12 Oct 2026): a short intro and three
// questions and answers, built ONLY from the page's own live data — the count,
// the areas, the levels, the budgets present. Because each of those differs by
// page, no two hubs read the same, and nothing here is invented: a fact the
// page does not hold is left out with its sentence.
//
// Pure. The FAQ a page shows and the FAQPage JSON-LD it emits are the same
// array, so the structured data can never say what the page does not.

import { fitTitle, seoDescription, BRAND } from '@/lib/seo'
import { TUITION_LIVE_LABEL } from '@/lib/tuitionStatus'

export type HubFacts = {
  count: number
  /** Areas represented, busiest first. */
  areas: string[]
  /** Class levels represented ("Grade 6–8", "O Levels"). */
  levels: string[]
  /** Job Types represented ("Home Tutor", "Primary Teacher"). */
  jobTypes: string[]
  budgetMin: number | null
  budgetMax: number | null
}

export type HubKind = 'city' | 'area' | 'female' | 'online' | 'school'
export type Faq = { q: string; a: string }

const rs = (n: number) => `Rs ${n.toLocaleString('en-PK')}`
const plural = (n: number, one: string, many = one + 's') => (n === 1 ? one : many)

function words(items: string[], max = 3): string {
  const xs = items.filter(Boolean).slice(0, max)
  if (xs.length === 0) return ''
  if (xs.length === 1) return xs[0]
  return `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`
}

export function distinctWords(values: (string | null | undefined)[], max = 5): string[] {
  const out: string[] = []
  for (const v of values) {
    const t = (v ?? '').trim()
    if (t && !out.some((x) => x.toLowerCase() === t.toLowerCase())) out.push(t)
    if (out.length >= max) break
  }
  return out
}

/** What the page lists, as a noun phrase: "teaching jobs in Bahria Town, Lahore". */
export function hubNoun(kind: HubKind, name: string): string {
  if (kind === 'school') return `teaching jobs at ${name}`
  if (kind === 'female') return `female teaching jobs in ${name}`
  if (kind === 'online') return `online tuition jobs in ${name}`
  if (kind === 'area') return `teaching jobs in ${name}`
  return `tuition and teaching jobs in ${name}`
}

export function hubHeading(kind: HubKind, name: string): string {
  if (kind === 'school') return `${name} teacher jobs`
  if (kind === 'female') return `Female teaching jobs in ${name}`
  if (kind === 'online') return `Online tuition jobs in ${name}`
  if (kind === 'area') return `Teaching jobs in ${name}`
  return `Tuition and teaching jobs in ${name}`
}

/** ≤ 60 characters: the full pattern first, shorter forms after it. */
export function hubTitle(kind: HubKind, name: string, count: number, shortName?: string): string {
  if (kind === 'school') {
    const s = shortName ?? name
    return fitTitle([
      `${s} Teacher Jobs – ${count} Open ${plural(count, 'Vacancy', 'Vacancies')} | ${BRAND}`,
      `${s} Teacher Jobs – ${count} Open | ${BRAND}`,
      `${s} Teacher Jobs – ${count} Open`,
      `${s} Teacher Jobs`,
    ])
  }
  const lead =
    kind === 'female'
      ? `Female Teacher Jobs in ${name}`
      : kind === 'online'
        ? `Online Tuition Jobs in ${name}`
        : kind === 'area'
          ? `Teaching Jobs in ${name}`
          : `Tuition & Teaching Jobs in ${name}`
  return fitTitle([`${lead} – ${count} Open | ${BRAND}`, `${lead} – ${count} Open`, `${lead} | ${BRAND}`, lead])
}

export function hubDescription(kind: HubKind, name: string, f: HubFacts): string {
  const levels = f.levels.length ? ` for ${words(f.levels)}` : ''
  return seoDescription(
    `${f.count} open ${hubNoun(kind, name)}${levels}, updated daily. Free to join, no commission — apply on TutorMint.`,
  )
}

/** Two or three sentences from the page's own numbers. */
export function hubIntro(kind: HubKind, name: string, f: HubFacts): string {
  if (f.count === 0) {
    return 'There are no open posts here right now. New ones are added most days, and the list below updates as they arrive.'
  }
  const first = `${f.count} open ${plural(f.count, 'post')} ${f.count === 1 ? 'is' : 'are'} listed under ${hubNoun(kind, name)} right now, newest first.`
  const where = kind !== 'area' && f.areas.length ? ` in ${words(f.areas)}` : ''
  const what = f.levels.length ? `They cover ${words(f.levels)}${where}.` : where ? `They are${where}.` : ''
  const pay =
    f.budgetMin != null && f.budgetMax != null
      ? f.budgetMin === f.budgetMax
        ? `Monthly pay on these posts is around ${rs(f.budgetMin)}.`
        : `Monthly pay on these posts runs from ${rs(f.budgetMin)} to ${rs(f.budgetMax)}.`
      : ''
  return [first, what, pay, 'Browsing is free and needs no account.'].filter(Boolean).join(' ')
}

/** Three questions a job seeker asks of this page, answered from its data. */
export function hubFaq(kind: HubKind, name: string, f: HubFacts): Faq[] {
  const noun = hubNoun(kind, name)
  const out: Faq[] = [
    {
      q: `How many ${noun} are open right now?`,
      a: `${f.count} ${plural(f.count, 'post is', 'posts are')} open today. The list is updated daily: new posts are added as they come in, and a post that is not renewed is paused after ${TUITION_LIVE_LABEL}.`,
    },
  ]
  if (f.levels.length || f.areas.length || f.jobTypes.length) {
    const bits = [
      f.jobTypes.length ? `The open roles are ${words(f.jobTypes, 4)}.` : '',
      f.levels.length ? `The classes are ${words(f.levels, 4)}.` : '',
      kind !== 'area' && f.areas.length ? `The areas include ${words(f.areas, 4)}.` : '',
    ].filter(Boolean)
    out.push({ q: `Which classes and roles are these jobs for?`, a: bits.join(' ') })
  } else {
    out.push({
      q: `What do these jobs pay?`,
      a:
        f.budgetMin != null && f.budgetMax != null
          ? `Each post shows its own monthly pay. On the posts open now it runs from ${rs(f.budgetMin)} to ${rs(f.budgetMax)} a month.`
          : `Each post shows its own monthly pay where the family or school gave one.`,
    })
  }
  out.push({
    q: `How do I apply for ${kind === 'school' ? `a job at ${name}` : `one of these jobs`}?`,
    a: `Open the post and press Apply. You need a TutorMint tutor account with a verified mobile number, and a verified profile to send an application. Joining is free and TutorMint takes no commission on any job.`,
  })
  return out
}

/** The three Q&As on a city × subject landing page. */
export function landingFaq(
  kind: 'tutors' | 'tuitions',
  subject: string,
  city: string,
  f: { count: number; feeMin: number | null; feeMax: number | null; areas: string[] },
): Faq[] {
  if (kind === 'tutors') {
    return [
      {
        q: `How many ${subject} tutors are there in ${city}?`,
        a: `${f.count} ${subject} ${plural(f.count, 'tutor is', 'tutors are')} listed in ${city} today${f.areas.length ? `, in areas including ${words(f.areas)}` : ''}. The list changes as tutors join.`,
      },
      {
        q: `What does a ${subject} tutor in ${city} charge?`,
        a:
          f.feeMin != null && f.feeMax != null
            ? f.feeMin === f.feeMax
              ? `Each tutor sets their own monthly fee. The tutors listed here ask around ${rs(f.feeMin)} a month.`
              : `Each tutor sets their own monthly fee. The tutors listed here ask from ${rs(f.feeMin)} to ${rs(f.feeMax)} a month.`
            : `Each tutor sets their own monthly fee, shown on their profile where they have given one.`,
      },
      {
        q: `How do I contact a tutor?`,
        a: `Browsing is free and needs no account. To message a tutor or ask for a demo lesson, sign up as a parent and verify your mobile number. TutorMint takes no commission.`,
      },
    ]
  }
  return [
    {
      q: `How many ${subject} tuitions are open in ${city}?`,
      a: `${f.count} ${subject} ${plural(f.count, 'tuition is', 'tuitions are')} open in ${city} today${f.areas.length ? `, in areas including ${words(f.areas)}` : ''}. A tuition that is not renewed is paused after ${TUITION_LIVE_LABEL}.`,
    },
    {
      q: `What do ${subject} tuitions in ${city} pay?`,
      a:
        f.feeMin != null && f.feeMax != null
          ? f.feeMin === f.feeMax
            ? `Each tuition shows the family's own monthly budget. The ones open now are around ${rs(f.feeMin)} a month.`
            : `Each tuition shows the family's own monthly budget. The ones open now run from ${rs(f.feeMin)} to ${rs(f.feeMax)} a month.`
          : `Each tuition shows the family's own monthly budget where they gave one.`,
    },
    {
      q: `How do I apply for a tuition?`,
      a: `Open the tuition and press Apply. You need a TutorMint tutor account with a verified mobile number, and a verified profile to send an application. Joining is free and TutorMint takes no commission.`,
    },
  ]
}
