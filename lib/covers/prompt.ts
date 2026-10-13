// lib/covers/prompt.ts
//
// The image PROMPT for a blog cover's background scene (PR38 §2; rebuilt 14 Oct
// 2026). TutorMint calls no image service (owner, 14 Oct 2026): the three cover
// options are composed from the house illustration library, and this prompt is
// what a manager pastes into their own image tool when they want a painted
// scene instead, then uploads with the existing control. It is stored with the
// cover (posts.cover_prompt) so a good cover can be made again.
//
// The prompt asks for the BACKGROUND SCENE ONLY. No words, no logo, no tagline:
// the title, the TutorMint logo, the brand line and the tagline are put on top
// by code, so their spelling is always right. Pure — the editor, the route and
// the tests read the same text.

import { sceneFor } from './scene'

export type CoverPromptInput = {
  title: string
  /** The topic cluster's display label (e.g. "Boards & exams"). */
  clusterLabel: string
  /** The cluster slug — decides the scene for tutor-career, city guides and exams. */
  cluster?: string | null
  /** Optional city (display string), e.g. "Islamabad". */
  city?: string | null
  /** Optional subject (display string), e.g. "O Level Physics". */
  subject?: string | null
  audience?: 'parents' | 'tutors' | 'both'
  slug?: string | null
}

/**
 * The cover scene prompt, built from the post's subject, level, city and
 * cluster. Deterministic: the same post always produces the same prompt.
 */
export function coverImagePrompt(input: CoverPromptInput): string {
  const title = input.title.trim()
  const city = (input.city ?? '').trim()
  const subject = (input.subject ?? '').trim()
  const scene = sceneFor({ title, cluster: input.cluster ?? '', city, subject, audience: input.audience, slug: input.slug })

  // One line naming what the picture is for — title, topic, and the subject /
  // city when they are set. The place is always Pakistan.
  const about = [
    `about "${title}"`,
    `(topic: ${input.clusterLabel})`,
    subject ? `focused on ${subject}` : '',
    city ? `set in ${city}, Pakistan` : 'set in Pakistan',
  ]
    .filter(Boolean)
    .join(', ')

  return [
    `Create a 1200x630 landscape flat vector illustration: the background scene for a blog cover ${about}.`,
    '',
    `Scene: ${scene.line}.`,
    '',
    'Style: clean, modern flat vector illustration in a friendly editorial style — simple geometric shapes, soft flat shadows, a Pakistani home or study setting. Warm and approachable, not corporate stock photography and not 3D.',
    '',
    'Palette: use ONLY the TutorMint brand colours — brand red #C20202, navy #151E6B, mint green #9AE899, and ink black #0A0A0A — on a white or light background. No other hues, no gradients outside these colours.',
    '',
    'Composition: 1200x630. Keep the people and objects in the RIGHT 40% of the picture. Leave the left 60% calm and almost empty (plain light background) — a title, a logo and a line of text are placed there afterwards.',
    '',
    `People: natural, ordinary and general — invented figures only. No real person, no celebrity and no lookalike. Ages fit the topic (${scene.student}). ${
      scene.religious
        ? 'This topic is religious, so modest dress and a respectful setting are right (for example a headscarf or a prayer cap, the Quran on a stand).'
        : 'Neutral, everyday clothing — no religious or cultural dress or symbols, because the topic is not religious.'
    } Nothing unsuitable for children.`,
    '',
    'Do not show: school logos or crests, uniforms with badges, any brand or product, watermarks, signatures, or readable text or signage of any kind (blank book covers, blank screens, blank boards).',
    '',
    'IMPORTANT: put NO text, words, letters, numbers, captions, logos, taglines or lettering anywhere in the image — the title is added separately by the platform. In particular never add a slogan or a claim such as "largest", "best", "No.1", "#1" or "most trusted".',
  ].join('\n')
}
