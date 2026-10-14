// lib/covers/prompt.ts
//
// The image PROMPT for a blog cover's background scene (PR38 §2; rebuilt 14 Oct
// 2026). TutorMint calls no image service: the three cover options are
// composed from the house illustration library, and this prompt is what the
// Owner pastes into their own image tool when they want a painted scene
// instead, then uploads it with the existing control. It is saved with the
// cover (posts.cover_prompt) so a good cover can be made again.
//
// One paragraph, about 120 words, the same shape every time:
//   style block · scene (who, doing what, where) · people · colours (the site
//   theme's own hex values) · composition (left 45% plain) · a fixed "do not".
// Plain names only — "Matric English", "FA Maths", "O and A Level" — never a
// raw database label, a cluster name, a brand name or a claim. Pure: the
// editor, the route and the tests read the same text.

import { BRAND } from '@/lib/brand'
import { withArticle } from '@/lib/article'
import { sceneFor } from './scene'

export type CoverPromptInput = {
  title: string
  /** Accepted for older callers; the prompt never uses a cluster name. */
  clusterLabel?: string
  /** The cluster slug — decides the scene for tutor-career, city guides and exams. */
  cluster?: string | null
  city?: string | null
  subject?: string | null
  audience?: 'parents' | 'tutors' | 'both'
  slug?: string | null
}

export const PROMPT_STYLE = 'Flat vector illustration, 1200×630 landscape, clean and friendly, soft daylight.'
export const PROMPT_COLOURS = `Colours: navy blue ${BRAND.navy}, soft green ${BRAND.mint}, red accents ${BRAND.red} and black ${BRAND.black}, on a light background ${BRAND.bg}.`
export const PROMPT_COMPOSITION = 'Composition: keep the left 45% plain and uncluttered; place the main subjects on the right.'
export const PROMPT_DO_NOT =
  'Do not include: text, letters, numbers, logos, signage, watermarks, school crests or uniforms with badges, real or famous people, distorted hands or faces.'

/** The cover scene prompt for a post. Deterministic: the same post, the same prompt. */
export function coverImagePrompt(input: CoverPromptInput): string {
  const scene = sceneFor({
    title: input.title.trim(),
    cluster: input.cluster ?? '',
    city: input.city,
    subject: input.subject,
    audience: input.audience,
    slug: input.slug,
  })
  // The lesson is its own short sentence, so it never trails a clause of the scene.
  const lesson = scene.lesson ? `It is ${withArticle(`${scene.lesson} lesson`)}.` : ''
  const people = scene.religious
    ? 'People in everyday Pakistani clothing with natural friendly expressions, age-appropriate.'
    : 'People in everyday Pakistani clothing with natural friendly expressions, age-appropriate; no religious items.'
  return [PROMPT_STYLE, `Scene: ${scene.line}.`, lesson, people, PROMPT_COLOURS, PROMPT_COMPOSITION, PROMPT_DO_NOT].filter(Boolean).join(' ')
}
