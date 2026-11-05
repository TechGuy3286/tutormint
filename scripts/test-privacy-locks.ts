/**
 * scripts/test-privacy-locks.ts — npm run test:privacylocks
 * CNIC number for the Owner only, "Hide my photo from parents", approved
 * documents locked, five more subject merges, the "AI assistants" source
 * (owner, 17 Oct 2026). Pure rules, the reveal at the API level with its I/O
 * injected, and source scans; no browser, no database. Never prints a CNIC.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { revealCnic, mayRevealCnic, adminCnicDisplay, CNIC_REVEAL_REFUSED } from '../lib/cnicRevealCore'
import { publicPhoto, initialsOf } from '../lib/photoPrivacyCore'
import { tutorProfileJsonLd, socialMeta } from '../lib/seo'
import {
  uploadDecision,
  photoUploadDecision,
  photoLockView,
  lockedWhatsappHref,
  LOCKED_ERROR,
  LOCKED_TITLE,
  LOCKED_LINE,
} from '../lib/docLockCore'
import { dedupeSubjects, subjectDisplayName } from '../lib/subjectDisplay'
import { aiAssistantSite, sourceGroup, describeSource, countSources, AI_ASSISTANTS } from '../lib/signupSourceCore'
import Avatar from '../components/Avatar'

const read = (p: string) => readFileSync(p, 'utf8')
const FAKE_CNIC = '42101-1234567-1' // the documented example number, never a member's

// --------------------------------------------------------------- Part A ----

test('the full CNIC is returned to the Owner only (API level), and every Show is logged first', async () => {
  for (const role of ['partner', 'admin', 'operations', 'tuitions_staff', null, undefined, '']) {
    let read = 0
    let logged = 0
    const r = await revealCnic({ adminRole: role }, 'm1', {
      loadNumber: async () => {
        read += 1
        return FAKE_CNIC
      },
      log: async () => {
        logged += 1
      },
    })
    assert.equal(r.status, 403, `role ${String(role)} must be refused`)
    assert.deepEqual(r.body, { error: CNIC_REVEAL_REFUSED })
    assert.equal(read, 0, 'nothing is read for a non-Owner')
    assert.equal(logged, 0)
    assert.equal(JSON.stringify(r.body).includes('1234567'), false)
  }
  const order: string[] = []
  const ok = await revealCnic({ adminRole: 'owner' }, 'm1', {
    loadNumber: async (id) => {
      order.push(`load:${id}`)
      return '4210112345671'
    },
    log: async ({ memberId }) => {
      order.push(`log:${memberId}`)
    },
  })
  assert.equal(ok.status, 200)
  assert.deepEqual(ok.body, { cnicNumber: FAKE_CNIC })
  assert.deepEqual(order, ['load:m1', 'log:m1'])
  assert.equal(mayRevealCnic('owner'), true)
  assert.equal(mayRevealCnic('partner'), false)
})

test('every admin loader sends the masked number, never the full one', () => {
  assert.equal(adminCnicDisplay(FAKE_CNIC), 'XXXXX-XXXXXXX-1')
  assert.equal(adminCnicDisplay('42101'), 'Incomplete number on file')
  assert.equal(adminCnicDisplay(null), null)
  const route = read('app/api/admin/tutors/cnic-reveal/route.ts')
  assert.match(route, /revealCnic\(gate\.actor, memberId/)
  assert.match(route, /action: 'cnic\.reveal'/)
  // Parent docs (member page) and the parent queue.
  assert.match(read('lib/parentDocuments.ts'), /cnicNumber: adminCnicDisplay\(p\.cnic_number/)
  assert.doesNotMatch(read('lib/parentDocuments.ts'), /cnicNumber: \(p\.cnic_number as string/)
  assert.match(read('lib/adminQueues.ts'), /cnicNumber: adminCnicDisplay\(p\.cnic_number/)
  assert.doesNotMatch(read('lib/adminQueues.ts'), /cnicNumber: \(p\.cnic_number as string\) \?\? null/)
  // A number read from the photo is the number: Owner only.
  assert.match(read('app/api/admin/documents/read-cnic/route.ts'), /number: mayRevealCnic\(gate\.actor\.adminRole\) \? c\.number : null/)
  // The tutor queue's Show button is the Owner's only.
  assert.match(read('app/admin/tutors/videos/page.tsx'), /canRevealCnic=\{mayRevealCnic\(actor\.adminRole\)\}/)
  // The Show button: Owner only, hidden again on leave.
  const show = read('components/admin/CnicShow.tsx')
  assert.match(show, /useCanApprove\(\)/)
  assert.match(show, /pagehide/)
})

test('public surfaces never carry the CNIC number — only a "CNIC verified" chip', () => {
  for (const f of ['components/TutorCard.tsx', 'app/(site)/tutor/[slug]/profile.tsx', 'components/CnicVerifiedChip.tsx']) {
    const src = read(f)
    assert.doesNotMatch(src, /maskCnic|formatCnic|cnicNumber\b/, `${f} must not show a CNIC number`)
  }
  assert.match(read('components/CnicVerifiedChip.tsx'), /CNIC verified/)
  assert.match(read('components/TutorCard.tsx'), /tutor\.cnic_verified && <CnicVerifiedChip \/>/)
  assert.match(read('app/(site)/tutor/[slug]/profile.tsx'), /cnicApproved && <CnicVerifiedChip \/>/)
})

// --------------------------------------------------------------- Part B ----

const PHOTO = 'https://example.supabase.co/storage/v1/object/public/avatars/u/photo-1-crop.jpg'

test('a hidden photo never reaches the card, profile, OG or JSON-LD output', () => {
  assert.equal(publicPhoto(PHOTO, { hidden: true }), null)
  assert.equal(publicPhoto(PHOTO, { rejected: true }), null)
  assert.equal(publicPhoto(PHOTO, {}), PHOTO)
  assert.equal(initialsOf('Ali Raza'), 'AR')
  assert.equal(initialsOf('sana'), 'S')

  // JSON-LD: no image.
  const ld = tutorProfileJsonLd({ slug: 's', name: 'Ali Raza', avatarUrl: publicPhoto(PHOTO, { hidden: true }), city: 'Lahore', areas: [], subjects: [], levels: [] })
  assert.equal(JSON.stringify(ld).includes(PHOTO), false)
  assert.equal(JSON.stringify(ld).includes('"image"'), false)

  // Open Graph / Twitter: the branded default, never the photo.
  const meta = socialMeta({ title: 't', description: 'd', path: '/tutor/s', image: publicPhoto(PHOTO, { hidden: true }), type: 'profile' })
  assert.equal(JSON.stringify(meta).includes(PHOTO), false)

  // A hidden photo draws the gender default and never the photo (5 Nov 2026).
  const html = renderToStaticMarkup(createElement(Avatar, { name: 'Ali Raza', src: PHOTO, gender: 'male', photoHidden: true }))
  assert.equal(html.includes(PHOTO), false)
  assert.match(html, /default-male-/)

  // The wiring: card producers, card, profile (body, preview, OG, JSON-LD).
  const browse = read('lib/browseTutors.ts')
  assert.match(browse, /avatar_url: publicPhoto\(avatarUrl, \{ hidden \}\)/)
  assert.equal((browse.match(/trustFields\(|withTrust\(t, trust\)/g) ?? []).length >= 3, true)
  assert.match(read('components/TutorCard.tsx'), /src=\{tutor\.photo_hidden \? null : tutor\.avatar_url\}/)
  const page = read('app/(site)/tutor/[slug]/profile.tsx')
  // The og:image is the generated share card (PR C3, 21 Oct 2026): its version
  // knows whether the photo is shown, and the card itself draws the silhouette
  // for a hidden photo — the real URL is never read then.
  assert.match(page, /photoShown: !!publicPhoto\(tutor\.avatar_url, \{ hidden: flags\.photoHidden \}\)/)
  assert.match(page, /image: shareImagePath\(/)
  assert.match(read('lib/social/postTutor.ts'), /socialPortraitSrc\(tp\.avatar_url as string \| null, !photoShown, facts\?\.gender \?\? null\)/)
  assert.match(read('lib/social/postTutor.ts'), /const photoShown = !!facts && !facts\.photoHidden && \(await avatarShown\(admin, id\)\)/)
  assert.match(read('app/og/tutor/[slug]/route.tsx'), /loadPostTutor\(admin, slug\)/)
  assert.match(page, /avatarUrl: publicPhoto\(tutor\.avatar_url, \{ hidden: photoHidden \}\)/)
  assert.match(page, /photoHidden=\{photoHidden\}/)
  assert.match(page, /show_avatar === false \}\),/)
  // The public views have gated the photo on show_avatar since PR70.
  assert.match(read('supabase/migrations/115_show_avatar.sql'), /CASE WHEN COALESCE\(tp\.show_avatar, true\) THEN tp\.avatar_url ELSE NULL END AS avatar_url/)
})

test('the toggle is on the onboarding photo step and in Settings, and is never locked', () => {
  assert.match(read('components/tutor/NewOnboardingFlow.tsx'), /<HidePhotoToggle \/>/)
  assert.match(read('app/(site)/tutor/dashboard/settings/page.tsx'), /<HidePhotoToggle hidden=\{!showAvatar\}/)
  const t = read('components/tutor/HidePhotoToggle.tsx')
  assert.match(t, /show_avatar: !next/)
  const m = read('supabase/migrations/186_photo_lock.sql')
  assert.doesNotMatch(m, /show_avatar is distinct/i, 'hiding is never locked')
})

// --------------------------------------------------------------- Part C ----

// Superseded on 4 Nov 2026 (lib/memberLocksCore, migration 222): only the
// CNIC stays locked; an approved photo or selfie is replaced into review, and
// the database holds a replaced photo instead of refusing it.
test('an approved CNIC is refused without an unlock; the photo and selfie are not', () => {
  assert.deepEqual(uploadDecision({ kind: 'cnic', part: 'front', approved: true, partOnRecord: true, unlock: null }), { allow: false, status: 403, error: LOCKED_ERROR })
  assert.equal(uploadDecision({ kind: 'cnic', part: 'front', approved: true, partOnRecord: true, unlock: { id: 'u', usedSides: [] } }).allow, true)
  assert.equal(uploadDecision({ kind: 'cnic', part: 'front', approved: false, partOnRecord: true, unlock: null }).allow, true)
  assert.deepEqual(uploadDecision({ kind: 'selfie', part: 'selfie', approved: true, partOnRecord: true, unlock: null }), { allow: true, mode: 'review', consumeUnlock: false })
  assert.deepEqual(photoUploadDecision({ approved: true, onRecord: true, unlockOpen: false }), { allow: true })
  assert.equal(photoLockView({ approved: true, onRecord: true, rereviewPending: false, unlockOpen: false }), 'open')
  assert.equal(photoLockView({ approved: true, onRecord: true, rereviewPending: true, unlockOpen: false }), 'waiting')
  const route = read('app/api/profile/photo/route.ts')
  assert.doesNotMatch(route, /decidePhotoUpload/)
  const m = read('supabase/migrations/222_member_edit_rules.sql')
  assert.match(m, /AND NEW\.cnic_number IS DISTINCT FROM OLD\.cnic_number THEN/)
  assert.match(m, /create trigger tutor_profiles_hold_member_photo/)
  assert.match(read('app/api/admin/documents/unlock/route.ts'), /refuseUnlessOwnerApproval/)
})

test('the locked notice is the CNIC support line, English only', () => {
  assert.equal(LOCKED_TITLE, 'Approved')
  assert.equal(LOCKED_LINE, 'To change your CNIC, please contact our support.')
  assert.match(decodeURIComponent(lockedWhatsappHref('cnic')), /update my CNIC\.$/)
})

// --------------------------------------------------------------- Part D ----

test('five more subject pairs show once; the different subjects stay apart', () => {
  const pairs: [string, string, string][] = [
    ['Business', 'Business Studies', 'Business Studies'],
    ['Design & Technology', 'Design Technology', 'Design & Technology'],
    ['Robotics & Engineering', 'Robotics Engineering', 'Robotics & Engineering'],
    ['French', 'French Language', 'French'],
    ['German', 'German Language', 'German'],
  ]
  for (const [a, b, shown] of pairs) {
    assert.equal(subjectDisplayName(a), shown)
    assert.equal(subjectDisplayName(b), shown)
    assert.deepEqual(dedupeSubjects([a, b]), [shown])
  }
  const apart = ['English', 'English Literature', 'English Language & Literature', 'Urdu', 'Urdu Literature', 'English Language A', 'English Language A: Language & Literature', 'French Language & Literature']
  assert.equal(dedupeSubjects(apart).length, apart.length)
  assert.equal(dedupeSubjects(['French Language & Literature', 'French']).length, 2)
})

// --------------------------------------------------------------- Part E ----

test('AI-assistant sign-ups are one source, with the exact site kept', () => {
  for (const [raw, site] of [
    ['chatgpt.com', 'chatgpt.com'],
    ['https://chat.openai.com/', 'chat.openai.com'],
    ['gemini.google.com', 'gemini.google.com'],
    ['www.perplexity.ai', 'perplexity.ai'],
    ['copilot.microsoft.com', 'copilot.microsoft.com'],
    ['claude.ai', 'claude.ai'],
    ['ChatGPT', 'chatgpt.com'],
  ] as const) {
    assert.equal(aiAssistantSite(raw), site, raw)
    assert.equal(sourceGroup(raw), 'ai')
  }
  for (const raw of ['google_jobs_apply', 'facebook', 'google.com', 'notchatgpt.com']) assert.equal(aiAssistantSite(raw), null, raw)
  assert.equal(sourceGroup(null), 'direct')
  assert.equal(sourceGroup('facebook'), 'campaign')
  assert.equal(describeSource({ utm_source: 'chatgpt.com' }, 'chatgpt.com'), 'AI assistant · chatgpt.com')
  assert.equal(describeSource({ utm_source: 'facebook', utm_medium: 'cpc' }, 'facebook · cpc'), 'facebook · cpc')

  const day = 86_400_000
  const now = Date.UTC(2026, 9, 17, 12)
  const w = { today: { fromMs: now - day / 2, toMs: now }, yesterday: { fromMs: now - 1.5 * day, toMs: now - day / 2 }, last7: { fromMs: now - 6.5 * day, toMs: now }, month: { fromMs: now - 16 * day, toMs: now } }
  const rows = countSources(
    [
      { createdAtMs: now - 1000, utmSource: 'chatgpt.com' },
      { createdAtMs: now - day, utmSource: 'chatgpt.com' },
      { createdAtMs: now - 3 * day, utmSource: 'gemini.google.com' },
      { createdAtMs: now - 10 * day, utmSource: 'google_jobs_apply' },
      { createdAtMs: now - 2000, utmSource: null },
    ],
    w,
  )
  const ai = rows.find((r) => r.group === 'ai')!
  assert.equal(ai.label, AI_ASSISTANTS)
  assert.deepEqual(ai.counts, { today: 1, yesterday: 1, last7: 3, month: 3 })
  assert.deepEqual(ai.sites?.map((s) => [s.site, s.counts.month]), [['chatgpt.com', 2], ['gemini.google.com', 1]])
  assert.deepEqual(rows.find((r) => r.group === 'campaign')!.counts, { today: 0, yesterday: 0, last7: 0, month: 1 })
  assert.deepEqual(rows.find((r) => r.group === 'direct')!.counts, { today: 1, yesterday: 0, last7: 1, month: 1 })
  // No new Overview card: the sources are a table under the daily funnel.
  const overview = read('app/admin/page.tsx')
  assert.match(overview, /<SignupSources rows=\{sources\} ai=\{aiTotals\} \/>/)
  assert.match(read('app/admin/users/[id]/page.tsx'), /describeSource\(/)
})
