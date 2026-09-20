// lib/ai/blogRoutes.ts
//
// THE ONE LIST of internal pages a blog post may link to (PR36 §2). Before this,
// the AI link map (what a draft is told to link) and the checker's "page exists"
// rule kept SEPARATE lists — so a draft correctly linked /parent/dashboard/post-job
// for "post a tuition" and the checker then blocked it as "a page that does not
// exist", because that path was in the link map but not in the checker's
// allowlist. Both now read from here, so a draft can never link a page the
// checker rejects.
//
// PURE — no imports — so the AI prompt (lib/ai/blogCopy via platformFacts), the
// checker (lib/ai/platformFacts invalidInternalLinks + lib/ai/blogChecker), the
// Link picker (PostEditor) and the tests all read the same paths.
//
// STATIC pages are listed here. DYNAMIC pages are validated against REAL RECORDS
// by the caller, which passes them to the checker as the `allowed` set:
//   - /blog/<slug>            → the published posts (lib/blogFeed publishedSlugs)
//   - /tutors/<city>/<subject> and /tuitions/<city>/<subject> (landing pages)
//                             → the live landing set (lib/blogEditor)
// Individual /tutor/<slug> and /tuitions/<city>/<slug> pages are NOT offered to a
// draft — a post shows a tutor or a tuition through an embedded CARD
// ({{tutor:slug}} / {{job:public-slug}}), not a Markdown link — so a bare link to
// one is flagged, with a plain-words suggestion (see suggestValidPage).

export type BlogRoute = {
  path: string
  /**
   * true  = a public page.
   * false = login-only, but it redirects a logged-out visitor to
   *         /login?next=<path> and returns them there after signing in, so it is
   *         still a valid link target (PR36 §2). /parent/dashboard/post-job is
   *         the one such page a post links.
   */
  public: boolean
  /** When set, this page is OFFERED to the AI and the Link picker for this
   *  intent, with this suggested link text. Pages without an intent are valid
   *  link targets the AI is simply not steered toward. */
  intent?: string
  text?: string
}

/** Every STATIC internal page a blog post may link. The first five carry an
 *  intent and are what the AI is steered to; the rest are always-valid pages a
 *  human may link. */
export const BLOG_ROUTES: BlogRoute[] = [
  { path: '/browse/tutors', public: true, intent: 'Finding tutors', text: 'browse tutors' },
  { path: '/browse/tuitions', public: true, intent: 'A tutor finding work', text: 'open tuitions' },
  // Login-only but graceful: logged out → /login?next=/parent/dashboard/post-job,
  // and the visitor lands on the post form after signing in. Verified in PR36 §4.
  { path: '/parent/dashboard/post-job', public: false, intent: 'A parent posting a tuition', text: 'post a tuition' },
  { path: '/membership-plans', public: true, intent: 'Plans and pricing', text: 'membership plans' },
  { path: '/faq', public: true, intent: 'Questions and answers', text: 'the FAQ' },
  { path: '/blog', public: true },
  { path: '/about', public: true },
  { path: '/support', public: true },
  { path: '/register', public: true },
  { path: '/', public: true },
]

const norm = (h: string) => h.split('#')[0].replace(/\/$/, '') || '/'

/** Every static path a post may link, for the checker's "page exists" test. */
export function staticValidPaths(): string[] {
  return BLOG_ROUTES.map((r) => r.path)
}

/** The pages OFFERED to the AI and the Link picker (those with an intent+text). */
export const LINK_MAP: { intent: string; path: string; text: string }[] = BLOG_ROUTES.filter(
  (r) => r.intent && r.text,
).map((r) => ({ intent: r.intent as string, path: r.path, text: r.text as string }))

/** The link map as prompt text — each intent, the exact relative path, and the
 *  words to use for the link. */
export const LINK_MAP_TEXT = [
  'LINK MAP — link the RIGHT page for each intent, using the exact relative path (never a full https://tutormint.org URL):',
  ...LINK_MAP.map((l) => `- ${l.intent} → ${l.path} (link text like "${l.text}")`),
  'NEVER send a parent who wants to post a tuition to /browse/tuitions — that page is for tutors finding work.',
].join('\n')

/**
 * When a link target is not a valid page, a plain-words suggestion of which page
 * to use instead (PR36 §2) — so the checker guides the fix rather than only
 * saying "does not exist". Null when nothing obvious fits.
 */
export function suggestValidPage(href: string): string | null {
  const h = norm(href).toLowerCase()
  if (/post[-_]?job|post.?a.?tuition|create.?(job|tuition)|dashboard/.test(h)) {
    return 'To let a parent post a tuition, link /parent/dashboard/post-job.'
  }
  if (/^\/tutor\//.test(h)) {
    return 'To feature a tutor, embed a card with {{tutor:slug}}, or link /browse/tutors.'
  }
  if (/^\/tuitions?\//.test(h)) {
    return 'To feature a tuition, embed a card with {{job:public-slug}}, or link /browse/tuitions.'
  }
  if (/find.?tutor|search.?tutor/.test(h)) return 'To find tutors, link /browse/tutors.'
  if (/find.?work|find.?tuition|jobs?\b/.test(h)) return 'For tutors finding work, link /browse/tuitions.'
  if (/plan|pricing|price|member/.test(h)) return 'For plans and pricing, link /membership-plans.'
  if (/faq|question|help/.test(h)) return 'For questions and answers, link /faq.'
  return null
}
