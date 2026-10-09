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

import MemberHeaderNav from '../components/MemberHeaderNav'
import { MEMBER_SETTINGS_HREF } from '../lib/memberNav'
import AccountLinks from '../components/dashboard/AccountLinks'
import { menuForRole } from '../lib/userMenu'
import MemberHeader from '../components/MemberHeader'
import TutorHeaderCard from '../components/tutor/TutorHeaderCard'
import ParentHeaderCard from '../components/parent/ParentHeaderCard'
import AppErrorView from '../components/AppErrorView'
import { findValueImports } from './check-server-imports'

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

test('Navbar: tutors/parents get MemberHeader in order, never the dropdown', () => {
  const nav = src('components/Navbar.tsx')
  const member = nav.slice(nav.indexOf('if (isMember) {'), nav.indexOf('return (\n    <Shell>\n      <NotificationBell'))
  assert.match(member, /<MemberHeader\b/)
  assert.doesNotMatch(member, /<UserMenu/)
  const s = src('components/MemberHeader.tsx')
  const order = ['aria-label="Open your dashboard"', '<HeaderMessages', '<NotificationBell', '<MemberHeaderNav']
  const at = order.map((t) => s.indexOf(t))
  assert.ok(at.every((i) => i >= 0), 'every control present')
  assert.deepEqual([...at].sort((a, b) => a - b), at, 'avatar, Messages, Notifications, Settings+Logout')
  // The avatar link has no chevron and no menu.
  assert.doesNotMatch(s, /ChevronDown|aria-haspopup/)
})

// The 9 Oct crash: Navbar (server) read MEMBER_SETTINGS_HREF from the
// 'use client' MemberHeaderNav, got a client reference, and <Link href> got
// undefined on every signed-in member page. The CI check now refuses it.
test('no server file imports a non-component value from a client .tsx module', () => {
  assert.deepEqual(findValueImports(), [])
})

const EMPTY = { hint: 'Nothing yet.', action: { label: 'Browse tutors', href: '/browse/tutors' } }

const MEMBERS = [
  { label: 'tutor with photo', role: 'tutor' as const, name: 'Ali Raza', avatarUrl: 'https://example.supabase.co/storage/v1/object/public/avatars/a.png' },
  { label: 'tutor with no photo', role: 'tutor' as const, name: 'Sana Riaz', avatarUrl: null },
  { label: 'member with no name', role: 'tutor' as const, name: '', avatarUrl: null },
  { label: 'member with a blank name', role: 'parent' as const, name: '   ', avatarUrl: null },
  { label: 'parent', role: 'parent' as const, name: 'Ayesha Siddiqui', avatarUrl: null },
]

for (const m of MEMBERS) {
  test(`member header renders without throwing — ${m.label}`, () => {
    const html = render(
      createElement(MemberHeader, {
        role: m.role,
        name: m.name,
        avatarUrl: m.avatarUrl,
        userId: '00000000-0000-4000-8000-000000000001',
        messagesUnread: 3,
        unread: 120,
        empty: EMPTY,
      }),
    )
    assert.match(html, new RegExp(`href="${MEMBER_SETTINGS_HREF[m.role]}"`))
    assert.match(html, /Logout/)
    assert.match(html, new RegExp(`href="/${m.role}/dashboard"`))
    assert.doesNotMatch(html, /href="undefined"|href=""/)
  })
}

test('dashboard profile cards render without throwing — tutor mid-onboarding, tutor complete, parent', () => {
  const mid = render(
    createElement(TutorHeaderCard, {
      name: '',
      avatarUrl: null,
      city: null,
      verified: false,
      planName: null,
      completion: 20,
      publicHref: null,
    }),
  )
  assert.match(mid, /href="\/tutor\/dashboard\/settings"/)
  assert.match(mid, /href="\/support"/)
  const done = render(
    createElement(TutorHeaderCard, {
      name: 'Ali Raza',
      avatarUrl: null,
      city: 'Lahore',
      verified: true,
      planName: 'Basic',
      badges: ['Verified'],
      completion: 100,
      publicHref: '/tutor/ali-raza',
    }),
  )
  assert.match(done, /View your public page/)
  const parent = render(
    createElement(ParentHeaderCard, {
      name: 'Ayesha Siddiqui',
      avatarUrl: null,
      city: null,
      verified: false,
      featured: false,
      publicHref: '/parent/00000000-0000-4000-8000-000000000002',
    }),
  )
  assert.match(parent, /href="\/parent\/dashboard\/settings"/)
  assert.match(parent, /Help &amp; Support/)
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

test('error page: one English line, one Urdu line, navy Try again, WhatsApp, plain homepage link, no Get help', () => {
  const html = render(
    createElement(AppErrorView, { error: Object.assign(new Error('x'), { digest: '2445384852' }), reset: () => {} }),
  )
  assert.match(html, /<h1[^>]*>Something went wrong at our end<\/h1>/)
  assert.match(html, /Please try again\. If it keeps happening, contact us on WhatsApp\./)
  assert.equal((html.match(/lang="ur"/g) ?? []).length, 1)
  assert.doesNotMatch(html, /This is our fault|Get help|text-\[11px\] text-gray-500">Something went wrong\./)
  assert.match(html, /<button[^>]*bg-tm-navy[^>]*>.*Try again<\/button>/)
  assert.match(html, /href="https:\/\/wa\.me\/923215872222[^"]*"[^>]*>.*Contact support on WhatsApp<\/a>/)
  assert.match(html, /<a[^>]*hover:underline[^>]*href="\/"[^>]*>Go to the homepage<\/a>/)
})
