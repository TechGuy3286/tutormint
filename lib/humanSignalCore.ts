// lib/humanSignalCore.ts — PURE (owner, 24 Nov 2026 — PR-22 Part B.3).
//
// ONE visitor rule for the Overview "Daily sign-up funnel" and Admin →
// Insights (they are written by the same /api/visit post), and for the search
// log: a page view or a search counts only from a REAL PERSON'S browser.
//
//   server  the user-agent is not a bot or our own crawler (lib/signupFunnelCore
//           countsAsVisit / lib/searchCountCore) — unchanged;
//   browser (new) the page is not driven by automation (navigator.webdriver),
//           and the person did something a person does — tapped, clicked,
//           scrolled, pressed a key — or kept the page open and visible for
//           HUMAN_VISIBLE_MS.
//
// Why: on 22–23 Nov 2026 a crawl that runs page scripts with an ordinary
// desktop browser user-agent posted ~3,900 one-page "visits" (2,240 visitors
// on 22 Nov, 1,683 on 23 Nov — every one Desktop, one page each) and ~2,000
// searches. The user-agent rule could not see it; it never scrolls or taps.
// A visit that leaves within 8 seconds without touching the page is not
// counted — the price of not counting crawlers.

/** The events that show a person is there. */
export const HUMAN_EVENTS = ['pointerdown', 'pointermove', 'keydown', 'scroll', 'touchstart', 'wheel'] as const

/** A page kept open and visible this long counts without any interaction. */
export const HUMAN_VISIBLE_MS = 8000

/** Is the browser driven by automation (Puppeteer, Playwright, Selenium…)? */
export function isAutomated(nav: { webdriver?: boolean } | null | undefined): boolean {
  return !!nav && nav.webdriver === true
}
