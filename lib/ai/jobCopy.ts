// lib/ai/jobCopy.ts
//
// The Claude half of "Write this for me".
//
// The deterministic composer and the verifier live in lib/ai/jobBrief.ts and
// are pure; this file is the part that talks to the API, so it is the part
// that can only run on a server. Everything here falls back to
// `composeJobCopy` -- never to an error -- because the member is trying to
// post a job and a generation problem must not become their problem.

import { complete, isConfigured } from './anthropic'
import {
  budgetPhrase,
  composeJobCopy,
  modePhrase,
  placePhrase,
  unsupportedFacts,
  MIN_WORDS,
  MAX_WORDS,
  type JobCopy,
  type JobSelection,
} from './jobBrief'

export { composeJobCopy, unsupportedFacts } from './jobBrief'
export type { JobCopy, JobSelection } from './jobBrief'

function wordCount(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length
}


const SYSTEM = [
  'You write short tuition adverts for TutorMint, a Pakistani platform where parents find tutors.',
  'You are writing in the parent\'s own voice: first person plural ("we"), plain and warm, the way a parent in Lahore or Karachi would actually write a note.',
  'Rules you must not break:',
  '- Use ONLY the facts given to you. Invent nothing.',
  '- Do NOT mention a grade, mark, percentage, exam result, age, budget, fee, day or time unless it is in the facts.',
  '- Do NOT describe the child. You have not met them and the parent has not told you anything about them.',
  '- No corporate filler: no "passionate", no "dynamic", no "we are seeking a highly qualified individual".',
  '- No greeting, no sign-off, no emoji, no hashtags, no markdown.',
  `- The description must be between ${MIN_WORDS} and ${MAX_WORDS} words.`,
  '- The title must be one line, under 90 characters, and say the subject and where.',
  'Reply as JSON only, exactly: {"title": "...", "description": "..."}',
].join('\n')

function factsBlock(sel: JobSelection): string {
  const facts: string[] = []
  if (sel.level) facts.push(`Level: ${sel.level}`)
  if (sel.subjects.length > 0) facts.push(`Subjects: ${sel.subjects.join(', ')}`)
  const place = placePhrase(sel)
  if (place) facts.push(`Location: ${place}`)
  const mode = modePhrase(sel)
  if (mode) facts.push(`Lessons: ${mode}`)
  if (sel.schedule) facts.push(`Days and times: ${sel.schedule}`)
  const budget = budgetPhrase(sel)
  if (budget) facts.push(`Monthly budget: ${budget}`)
  return facts.join('\n')
}

/**
 * Write the post, and check it before handing it back.
 *
 * Falls back to `composeJobCopy` -- never to an error -- on every failure
 * path: no key, a bad response, unparseable JSON, the wrong length, or a
 * number the parent did not select. The member is trying to post a job; a
 * generation problem must not become their problem.
 */
export async function generateJobCopy(sel: JobSelection): Promise<JobCopy> {
  const fallback = composeJobCopy(sel)

  if (!isConfigured()) {
    return { ...fallback, note: 'unconfigured' }
  }

  const facts = factsBlock(sel)
  if (!facts.trim()) return { ...fallback, note: 'nothing selected' }

  const result = await complete({
    system: SYSTEM,
    prompt: `Facts:\n${facts}\n\nWrite the advert.`,
  })

  if (!result.ok) {
    console.error('[jobCopy] generation failed:', result.reason)
    return { ...fallback, note: 'failed' }
  }

  let parsed: { title?: unknown; description?: unknown }
  try {
    // Be forgiving about a model that wraps JSON in prose or a fence: take the
    // outermost braces. Being strict here would spend a real API call to
    // produce a fallback we could have had for free.
    const raw = result.text
    const start = raw.indexOf('{')
    const end = raw.lastIndexOf('}')
    if (start === -1 || end <= start) throw new Error('no JSON object in reply')
    parsed = JSON.parse(raw.slice(start, end + 1)) as typeof parsed
  } catch (e) {
    console.error('[jobCopy] unparseable reply:', String(e))
    return { ...fallback, note: 'failed' }
  }

  const title = typeof parsed.title === 'string' ? parsed.title.trim() : ''
  const description = typeof parsed.description === 'string' ? parsed.description.trim() : ''

  if (!title || !description) return { ...fallback, note: 'failed' }
  if (title.length > 200) return { ...fallback, note: 'failed' }

  const words = wordCount(description)
  // A little slack either side of the brief: a 58-word description is not a
  // reason to throw away a good one, but 200 words is a different thing from
  // what was asked for.
  if (words < MIN_WORDS - 10 || words > MAX_WORDS + 20) {
    console.error(`[jobCopy] rejected: ${words} words, wanted ${MIN_WORDS}-${MAX_WORDS}`)
    return { ...fallback, note: 'failed' }
  }

  const invented = unsupportedFacts(`${title} ${description}`, sel)
  if (invented.length > 0) {
    console.error('[jobCopy] rejected, unselected figures:', invented.join(', '))
    return { ...fallback, note: 'unverified' }
  }

  return { title, description, source: 'claude' }
}
