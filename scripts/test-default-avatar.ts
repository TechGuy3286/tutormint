/**
 * scripts/test-default-avatar.ts — npm run test:defaultavatar
 * Grey gender-based default avatar when a member has no photo (owner, 10 Oct 2026).
 *   - a real photo is shown when present, unchanged
 *   - no photo → male / female / neutral by gender, incl. null and unknown values
 *   - no coloured-initials fallback is left on any member avatar
 *   - the three files exist, are greyscale and under 2 KB
 *   - the default never reaches og:image or structured data
 * Renders the shared <Avatar>; source scans for the wiring. No browser.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import Avatar from '../components/Avatar'
import { defaultAvatarKind, defaultAvatarSrc, DEFAULT_AVATAR_FILES } from '../lib/defaultAvatar'

const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n')
const html = (props: Parameters<typeof Avatar>[0]) => renderToStaticMarkup(createElement(Avatar, props))

test('gender picks the default: male, female, and neutral for everything else', () => {
  assert.equal(defaultAvatarKind('male'), 'male')
  assert.equal(defaultAvatarKind('female'), 'female')
  assert.equal(defaultAvatarKind('Male'), 'male')
  assert.equal(defaultAvatarKind(' FEMALE '), 'female')
  for (const g of ['trans', 'Trans', 'other', 'm', 'f', 'unknown', '', '   ', null, undefined]) {
    assert.equal(defaultAvatarKind(g), 'neutral', `gender ${JSON.stringify(g)} → neutral`)
  }
  assert.equal(defaultAvatarSrc('male'), '/avatars/male.svg')
  assert.equal(defaultAvatarSrc('female'), '/avatars/female.svg')
  assert.equal(defaultAvatarSrc(null), '/avatars/neutral.svg')
  assert.equal(defaultAvatarSrc('trans'), '/avatars/neutral.svg')
})

test('a real photo is shown when present, whatever the gender', () => {
  const photo = 'https://example.com/someone.jpg'
  for (const gender of ['male', 'female', 'trans', null]) {
    const out = html({ name: 'Samia Khan', src: photo, gender })
    assert.match(out, /src="https:\/\/example\.com\/someone\.jpg"/)
    assert.doesNotMatch(out, /\/avatars\//)
    assert.doesNotMatch(out, /data-default-avatar/)
  }
})

test('no photo → the gender default file, with the member name as alt text', () => {
  const cases: [string | null | undefined, string][] = [
    ['male', '/avatars/male.svg'],
    ['female', '/avatars/female.svg'],
    ['trans', '/avatars/neutral.svg'],
    ['something-else', '/avatars/neutral.svg'],
    [null, '/avatars/neutral.svg'],
    [undefined, '/avatars/neutral.svg'],
  ]
  for (const [gender, file] of cases) {
    for (const src of [null, undefined, '']) {
      const out = html({ name: 'Samia Khan', src, gender })
      assert.match(out, new RegExp(`<img[^>]*src="${file}"`), `${JSON.stringify(gender)} → ${file}`)
      assert.match(out, /alt="Samia Khan"/)
      assert.match(out, /data-default-avatar/)
    }
  }
  // Beside a written name the avatar is decorative: empty alt, hidden from readers.
  const deco = html({ name: 'Samia Khan', gender: 'female', decorative: true })
  assert.match(deco, /alt=""/)
  assert.match(deco, /aria-hidden="true"/)
})

test('the default keeps the size, round shape and ring of the photo', () => {
  const cls = 'h-[72px] w-[72px] sm:h-[140px] sm:w-[140px]'
  const ring = 'border-2 border-gray-100'
  const withPhoto = html({ name: 'A B', src: 'https://example.com/a.jpg', className: cls, ring, px: 140 })
  const without = html({ name: 'A B', className: cls, ring, px: 140 })
  for (const out of [withPhoto, without]) {
    assert.match(out, /rounded-full/)
    assert.ok(out.includes(cls) && out.includes(ring))
    assert.match(out, /width="140"/)
    assert.match(out, /height="140"/)
  }
})

test('no initials fallback is left: nothing renders letters, no tint class', () => {
  const out = html({ name: 'Samia Khan', gender: null })
  assert.doesNotMatch(out, />SK</)
  assert.doesNotMatch(out, /<span/)
  assert.doesNotMatch(out, /bg-tm-tint-/)
  const avatar = read('components/Avatar.tsx')
  assert.doesNotMatch(avatar, /initialsOf|avatarTint|lib\/brand/)
  // No component draws its own initials disc for a member.
  const offenders: string[] = []
  const walk = (dir: string) => {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f)
      if (statSync(p).isDirectory()) walk(p)
      else if (/\.tsx$/.test(f) && /initialsOf\(/.test(read(p))) offenders.push(p.replace(/\\/g, '/'))
    }
  }
  walk('components')
  walk('app')
  // The one remaining caller is the social banner image (next/og), which is a
  // generated picture for sharing, not a member avatar on the site. (The CV
  // preview and PDF keep their own initials box: a document, not an avatar.)
  assert.deepEqual(offenders, ['app/api/admin/social/image/render.tsx'])
})

test('every member avatar goes through the shared component and passes gender where one exists', () => {
  const passes = [
    'components/TutorCard.tsx',
    'app/(site)/tutor/[slug]/page.tsx',
    'components/tutor/TutorHeaderCard.tsx',
    'components/MemberHeader.tsx',
    'components/messages/ConversationList.tsx',
    'components/messages/InboxShell.tsx',
    'components/messages/MessagesDock.tsx',
    'components/messages/Conversation.tsx',
    'components/admin/OverviewCardGrid.tsx',
    'app/admin/tutors/TutorModerationClient.tsx',
    'app/admin/tutors/[id]/page.tsx',
    'app/admin/jobs/[id]/page.tsx',
    'app/(site)/tutor/dashboard/settings/page.tsx',
  ]
  for (const p of passes) assert.match(read(p), /<Avatar[\s\S]{0,200}?gender=\{/, `${p} passes gender`)
  // The data behind them carries it.
  assert.match(read('lib/browseTutors.ts'), /avatar_url, gender, city/)
  assert.match(read('lib/messaging.ts'), /otherGender: genders\.get\(otherId\) \?\? null/)
  assert.match(read('lib/overviewCards.ts'), /gender: \(t\?\.gender as string \| null\) \?\? null/)
  assert.match(read('components/Navbar.tsx'), /role === 'tutor' \? createClient\(\)\.then\(\(c\) => tutorGender\(c, session\.user\.id\)\)/)
})

test('the three files: static, greyscale, under 2 KB, head-and-shoulders only', () => {
  for (const f of DEFAULT_AVATAR_FILES) {
    const p = `public${f}`
    assert.ok(statSync(p).size < 2048, `${p} under 2 KB`)
    const svg = read(p)
    assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 96 96">/)
    assert.doesNotMatch(svg, /<script|<image|href=|<text/)
    for (const hex of svg.match(/#[0-9a-fA-F]{6}/g) ?? []) {
      assert.ok(['#E5E7EB', '#9CA3AF', '#6B7280'].includes(hex), `${p}: ${hex} is one of the three greys`)
    }
  }
})

test('the default is never an og:image or structured-data image', () => {
  for (const p of ['lib/seo.ts', 'app/(site)/tutor/[slug]/page.tsx', 'app/(site)/tuitions/[city]/[slug]/page.tsx', 'app/(site)/parent/[id]/page.tsx']) {
    const s = read(p)
    assert.doesNotMatch(s, /\/avatars\/|defaultAvatarSrc|DEFAULT_AVATAR_FILES/, `${p} never names a default avatar file`)
  }
})
