// Member header: Settings and Logout always visible, no dropdown (owner, 9 Oct 2026).
//
// The header itself is an async server component that needs a session, so the
// visible controls are server-rendered directly (MemberHeaderNav) and the
// wiring around them — which role gets which header — is checked in source.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime'

import MemberHeaderNav, { MEMBER_SETTINGS_HREF } from '../components/MemberHeaderNav'
import AccountLinks from '../components/dashboard/AccountLinks'
import { menuForRole } from '../lib/userMenu'

const router = {
  push() {},
  replace() {},
  refresh() {},
  back() {},
  forward() {},
  prefetch() {},
  hmrRefresh() {},
}

function render(el: ReturnType<typeof createElement>): string {
  return renderToStaticMarkup(createElement(AppRouterContext.Provider, { value: router as never }, el))
}

const src = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

test('member header renders Settings and Logout as visible controls (no menu)', () => {
  for (const role of ['tutor', 'parent'] as const) {
    const html = render(createElement(MemberHeaderNav, { settingsHref: MEMBER_SETTINGS_HREF[role] }))
    assert.match(html, new RegExp(`<a[^>]*href="${MEMBER_SETTINGS_HREF[role]}"[^>]*>.*Settings</span></a>`))
    assert.match(html, /<button[^>]*type="button"[^>]*>.*Logout<\/span><\/button>/)
    assert.match(html, /text-tm-red/, 'Logout keeps the red used for Logout')
    assert.doesNotMatch(html, /aria-haspopup|role="menu"|aria-expanded/)
  }
  assert.equal(MEMBER_SETTINGS_HREF.tutor, '/tutor/dashboard/settings')
  assert.equal(MEMBER_SETTINGS_HREF.parent, '/parent/dashboard/settings')
})

test('Logout signs out with the same flow: signOut, then home + refresh', () => {
  const s = src('components/MemberHeaderNav.tsx')
  assert.match(s, /auth\.signOut\(\)/)
  assert.match(s, /router\.push\('\/'\)[\s\S]*router\.refresh\(\)/)
})

test('Navbar: tutors/parents get MemberHeaderNav in order, never the dropdown', () => {
  const s = src('components/Navbar.tsx')
  const member = s.slice(s.indexOf('if (isMember) {'), s.indexOf('return (\n    <Shell>\n      <NotificationBell'))
  assert.ok(member.length > 0)
  assert.doesNotMatch(member, /<UserMenu/)
  const order = ['href={dashboardHref}', '<HeaderMessages', '<NotificationBell', '<MemberHeaderNav']
  const at = order.map((t) => member.indexOf(t))
  assert.ok(at.every((i) => i >= 0), 'every control present')
  assert.deepEqual([...at].sort((a, b) => a - b), at, 'avatar, Messages, Notifications, Settings+Logout')
  // The avatar link has no chevron and no menu.
  assert.doesNotMatch(member, /ChevronDown|aria-haspopup/)
})

test('signed-out header is unchanged (AuthCTA only)', () => {
  const s = src('components/Navbar.tsx')
  assert.match(s, /if \(!session\) \{[\s\S]*?<Shell>\s*<AuthCTA \/>\s*<\/Shell>/)
})

test('admin header is unchanged: admin layout does not use the member header', () => {
  const s = src('app/admin/layout.tsx')
  assert.doesNotMatch(s, /MemberHeaderNav|AccountLinks/)
  assert.match(s, /AdminSignOut/)
  // Admins on the site header keep their screen list.
  const items = menuForRole({ role: 'admin', adminScreens: [] })
  assert.equal(items[0].href, '/admin')
})

test('dashboard profile cards carry Settings and Help & Support', () => {
  const html = renderToStaticMarkup(createElement(AccountLinks, { settingsHref: '/tutor/dashboard/settings' }))
  assert.match(html, /href="\/tutor\/dashboard\/settings"[^>]*>.*Settings<\/a>/)
  assert.match(html, /href="\/support"[^>]*>.*Help &amp; Support<\/a>/)
  assert.match(src('components/tutor/TutorHeaderCard.tsx'), /<AccountLinks settingsHref="\/tutor\/dashboard\/settings" \/>/)
  assert.match(src('components/parent/ParentHeaderCard.tsx'), /<AccountLinks settingsHref="\/parent\/dashboard\/settings" \/>/)
})
