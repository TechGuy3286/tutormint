// lib/covers/prompt.ts
//
// The image-generation PROMPT for a blog cover (PR38 §2). TutorMint generates
// nothing and calls no image service — this only builds the text a manager copies
// into their own image tool, generates a cover, and uploads with the existing
// control. The prompt locks the HOUSE STYLE so a hand-generated cover matches the
// composed ones: the same flat illustration look, the brand palette, 1200x630,
// Pakistan-specific subject matter, and NO text in the image (the platform adds
// the title). Pure — no imports — so the editor and the tests read the same text.

export type CoverPromptInput = {
  title: string
  /** The topic cluster's display label (e.g. "Boards & exams"). */
  clusterLabel: string
  /** Optional city (display string), e.g. "Islamabad". */
  city?: string | null
  /** Optional subject (display string), e.g. "O Level Physics". */
  subject?: string | null
}

/**
 * The cover image prompt, built from the post's title, cluster, city and subject.
 * Deterministic: the same post always produces the same prompt, so a manager can
 * regenerate a matching cover.
 */
export function coverImagePrompt(input: CoverPromptInput): string {
  const title = input.title.trim()
  const city = (input.city ?? '').trim()
  const subject = (input.subject ?? '').trim()

  // One line naming what the picture is about — title, topic, and the subject /
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
    `Create a 1200x630 landscape flat vector illustration for a blog cover ${about}.`,
    '',
    'Style: clean, modern flat vector illustration in a friendly editorial style — simple geometric shapes, soft flat shadows, a Pakistani education context (students and tutors, books, and a recognisable local skyline or landmark when a city is given). Warm and approachable, not corporate stock photography and not 3D.',
    '',
    'Palette: use ONLY the TutorMint brand colours — brand red #C20202, navy #151E6B, mint green #9AE899, and ink black #0A0A0A — on a white or light background, or light shapes on a navy #151E6B background. No other hues, no gradients outside these colours.',
    '',
    'Composition: 1200x630, balanced, with calm negative space on the left so a headline could sit there later.',
    '',
    'IMPORTANT: put NO text, words, letters, numbers, captions or lettering anywhere in the image — the title is added separately by the platform.',
  ].join('\n')
}
