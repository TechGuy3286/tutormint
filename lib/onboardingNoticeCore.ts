// PURE (scripts/test-pr17.ts). What to do with the tutor's one "Continue
// onboarding (X of 16)" notification (PR-17 C.6) — lib/onboardingNotice applies it.

export type NoticeChange = {
  insert: { title: string; body: string | null } | null
  update: { id: string; title: string; body: string | null } | null
  markRead: string[]
}

export function onboardingNoticeChange(input: {
  finished: boolean
  title: string
  body: string | null
  /** Unread notices of this kind, newest first. */
  open: { id: string; title: string }[]
}): NoticeChange {
  const [keep, ...extra] = input.open
  if (input.finished) return { insert: null, update: null, markRead: input.open.map((o) => o.id) }
  if (!keep) return { insert: { title: input.title, body: input.body }, update: null, markRead: [] }
  return {
    insert: null,
    update: keep.title === input.title ? null : { id: keep.id, title: input.title, body: input.body },
    // Never two open copies.
    markRead: extra.map((o) => o.id),
  }
}
