/**
 * scripts/test-applicant-forwards.ts — npm run test:applicantforwards
 * Owner, 10 Oct 2026:
 *   Marketplace → Applicants to forward
 *     - only PAID tutors appear; one card per tuition
 *     - "Applied" and "Viewed number" both count
 *     - the prefilled message fills every placeholder and has no phone numbers
 *     - forward → new applicant → back to To forward, only the new tutors pre-selected
 *     - the 3-day "Check with parent" tag
 *     - the Partner (view-only) cannot act
 *   The fee is the "Verification Fee": no old name left in source or templates
 *   Profile-photo rotation: saved as a setting and applied, the file unchanged
 *   The viewer's backdrop covers the page; every picture fits its stage
 * Pure rules + renders + source scans. No browser, no network.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import {
  APPLICANTS_FORWARD_DEFAULT,
  buildForwardMessage,
  buildForwardStates,
  forwardCounts,
  forwardWaLink,
  forwardedLine,
  tutorListLines,
  validForwardTutorIds,
  withoutPhoneNumbers,
  type ForwardRow,
  type InterestEvent,
  type OutcomeRow,
} from '../lib/applicantForwardCore'
import { currentAvatarState, parsePublicStorageUrl, planAvatarRotation, rotatedCopyPath } from '../lib/avatarRotationCore'
import { SCREEN_ACCESS, roleSatisfies } from '../lib/adminAccessCore'
import { FEE_LABEL } from '../lib/display'
import { ViewerFrame } from '../components/admin/DocumentViewer'

const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n')
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const NOW = Date.parse('2026-10-10T12:00:00Z')
const day = (n: number) => new Date(NOW - n * 86_400_000).toISOString()

const JOB_A = 'job-a'
const JOB_B = 'job-b'
const paid = new Set(['t-paid-1', 't-paid-2', 't-paid-3'])
const ev = (jobId: string, tutorId: string, kind: 'applied' | 'viewed', at: string): InterestEvent => ({ jobId, tutorId, kind, at })
const states = (events: InterestEvent[], forwards: ForwardRow[] = [], outcomes: OutcomeRow[] = []) =>
  buildForwardStates({ events, paid, forwards, outcomes, nowMs: NOW })

// ------------------------------------------------- applicants to forward ----

test('only paid tutors appear, and there is one card per tuition', () => {
  const events = [
    ev(JOB_A, 't-paid-1', 'applied', day(1)),
    ev(JOB_A, 't-paid-2', 'applied', day(2)),
    ev(JOB_A, 't-unpaid', 'applied', day(0)),
    ev(JOB_B, 't-unpaid', 'applied', day(0)), // only an unpaid tutor: no card at all
  ]
  const out = states(events)
  assert.equal(out.length, 1, 'one card for the one tuition with a paid tutor')
  assert.equal(out[0].jobId, JOB_A)
  assert.deepEqual(out[0].tutors.map((t) => t.tutorId), ['t-paid-1', 't-paid-2'], 'newest first, the unpaid tutor left out')
  assert.equal(out[0].tab, 'to_forward')
  assert.equal(out[0].newApplicant, false)
  // The same tutor on the same tuition is one line, not two.
  const twice = states([ev(JOB_A, 't-paid-1', 'viewed', day(3)), ev(JOB_A, 't-paid-1', 'applied', day(1))])
  assert.equal(twice[0].tutors.length, 1)
  const c = forwardCounts(out, events, paid)
  assert.deepEqual([c.toForward, c.paidTutors, c.applications, c.views], [1, 2, 2, 0], 'unpaid activity is not counted')
})

test('applied and viewed-number both count; applied wins when a tutor did both', () => {
  const events = [
    ev(JOB_A, 't-paid-1', 'viewed', day(2)),
    ev(JOB_B, 't-paid-2', 'applied', day(1)),
    ev(JOB_B, 't-paid-3', 'viewed', day(4)),
    ev(JOB_B, 't-paid-3', 'applied', day(3)),
  ]
  const out = states(events)
  assert.equal(out.length, 2)
  const a = out.find((s) => s.jobId === JOB_A)!
  const b = out.find((s) => s.jobId === JOB_B)!
  assert.deepEqual(a.tutors.map((t) => [t.tutorId, t.kind]), [['t-paid-1', 'viewed']], 'a view alone makes a card')
  assert.deepEqual(b.tutors.map((t) => [t.tutorId, t.kind]), [['t-paid-2', 'applied'], ['t-paid-3', 'applied']])
  assert.equal(b.tutors[1].at, day(3), 'the newest action is the time shown')
  const c = forwardCounts(out, events, paid)
  assert.deepEqual([c.applications, c.views], [2, 2])
})

test('the prefilled message fills every placeholder and never carries a phone number', () => {
  const msg = buildForwardMessage({
    template: APPLICANTS_FORWARD_DEFAULT,
    parentName: 'Mrs Ahmed',
    tuitionTitle: 'Home Tutor Required | Grade 5 | DHA | Lahore',
    area: 'DHA, Lahore',
    tutors: [
      { name: 'Sara Khan 0300 1234567', profileUrl: 'https://www.tutormint.org/tutor/sara-khan-tutor' },
      { name: 'Ali Raza', profileUrl: 'https://www.tutormint.org/tutor/ali-raza-tutor' },
      { name: 'No Page Tutor +92 321 5551234', profileUrl: null },
    ],
  })
  assert.doesNotMatch(msg, /\{[a-z_]+\}/, 'no placeholder left unfilled')
  assert.match(msg, /^Assalam o Alaikum Mrs Ahmed, this is TutorMint about your tuition: Home Tutor Required \| Grade 5 \| DHA \| Lahore \(DHA, Lahore\)\./)
  assert.match(msg, /These verified tutors are interested:\nSara Khan: https:\/\/www\.tutormint\.org\/tutor\/sara-khan-tutor\nAli Raza: https:\/\/www\.tutormint\.org\/tutor\/ali-raza-tutor\nNo Page Tutor\n/)
  assert.match(msg, /Reply here if you'd like a demo lesson with any of them\.$/)
  assert.doesNotMatch(msg, /\d{7,}/, 'no run of digits long enough to be a number')
  assert.doesNotMatch(msg, /0300|1234567|5551234|\+92/)
  // One line per tutor: name and public profile link only.
  assert.equal(tutorListLines([{ name: 'A B', profileUrl: 'https://x/tutor/a-b' }, { name: 'C D', profileUrl: null }]), 'A B: https://x/tutor/a-b\nC D')
  assert.equal(withoutPhoneNumbers('Call 0321-5872222 now'), 'Call now')
  // An empty value is removed cleanly, never left as "{area}" or "()".
  const bare = buildForwardMessage({ template: null, parentName: null, tuitionTitle: 'Maths tutor', area: null, tutors: [{ name: 'A B', profileUrl: null }] })
  assert.doesNotMatch(bare, /\{|\(\)| ,/)
  assert.match(bare, /^Assalam o Alaikum, this is TutorMint about your tuition: Maths tutor\./)
  // An edited template keeps working, and an unknown placeholder is dropped.
  assert.equal(buildForwardMessage({ template: 'Hi {parent_name} — {tutor_list} {mystery}', parentName: 'Z', tuitionTitle: 't', area: 'a', tutors: [{ name: 'A', profileUrl: null }] }), 'Hi Z — A')
  // The wa.me link carries the text; no number, no link.
  assert.equal(forwardWaLink(null, msg), null)
  assert.match(forwardWaLink('923001234567', 'Hi there')!, /^https:\/\/wa\.me\/923001234567\?text=Hi%20there$/)
  // The seeded template is the same text as the default.
  const seed = read('supabase/migrations/161_applicant_forwards_avatar_rotation.sql')
  assert.match(seed, /'applicants_forward'/)
  for (const ph of ['{parent_name}', '{tuition_title}', '{area}', '{tutor_list}']) {
    assert.ok(seed.includes(ph) && APPLICANTS_FORWARD_DEFAULT.includes(ph), `${ph} is in the template`)
  }
})

test('forward → new applicant → back to To forward, with only the new tutors pre-selected', () => {
  const events = [ev(JOB_A, 't-paid-1', 'applied', day(6)), ev(JOB_A, 't-paid-2', 'viewed', day(5))]
  const forward: ForwardRow = { jobId: JOB_A, tutorIds: ['t-paid-1', 't-paid-2'], at: day(4), staffName: 'Aqsa', channel: 'whatsapp' }
  // After the forward: everyone sent, the card sits in Forwarded.
  const sent = states(events, [forward])[0]
  assert.equal(sent.tab, 'forwarded')
  assert.deepEqual(sent.newTutorIds, [])
  assert.ok(sent.tutors.every((t) => t.alreadySent))
  assert.equal(forwardedLine(forward, NOW), 'Forwarded 4 days ago by Aqsa (2 tutors)')
  assert.equal(forwardedLine({ ...forward, tutorIds: ['x'], at: day(0) }, NOW), 'Forwarded today by Aqsa (1 tutor)')

  // A new paid applicant arrives: back to To forward, tagged, only they are new.
  const again = states([...events, ev(JOB_A, 't-paid-3', 'applied', day(1))], [forward])[0]
  assert.equal(again.tab, 'to_forward')
  assert.equal(again.newApplicant, true)
  assert.deepEqual(again.newTutorIds, ['t-paid-3'], 'only the new tutor is pre-selected')
  assert.deepEqual(again.tutors.map((t) => [t.tutorId, t.alreadySent]), [['t-paid-3', false], ['t-paid-2', true], ['t-paid-1', true]])
  // An unpaid newcomer changes nothing.
  assert.equal(states([...events, ev(JOB_A, 't-unpaid', 'applied', day(0))], [forward])[0].tab, 'forwarded')

  // An outcome moves it to Outcome; a later new applicant brings it back again.
  const outcome: OutcomeRow = { jobId: JOB_A, outcome: 'demo', tutorId: 't-paid-1', note: null, at: day(3), staffName: 'Aqsa' }
  assert.equal(states(events, [forward], [outcome])[0].tab, 'outcome')
  assert.equal(states([...events, ev(JOB_A, 't-paid-3', 'applied', day(1))], [forward], [outcome])[0].tab, 'to_forward')

  // What a forward may record: only tutors on the card, each once.
  assert.deepEqual(validForwardTutorIds(again, ['t-paid-3', 't-paid-3', 't-unpaid', 'someone-else']), ['t-paid-3'])
  assert.deepEqual(validForwardTutorIds(null, ['t-paid-3']), [])
})

test('the "Check with parent" tag appears 3 days after a forward with no outcome', () => {
  const events = [ev(JOB_A, 't-paid-1', 'applied', day(9))]
  const fwd = (daysAgo: number): ForwardRow => ({ jobId: JOB_A, tutorIds: ['t-paid-1'], at: day(daysAgo), staffName: 'Aqsa', channel: 'call' })
  assert.equal(states(events, [fwd(2)])[0].checkWithParent, false)
  assert.equal(states(events, [fwd(2.9)])[0].checkWithParent, false)
  assert.equal(states(events, [fwd(3)])[0].checkWithParent, true)
  assert.equal(states(events, [fwd(8)])[0].checkWithParent, true)
  // An outcome clears it; so does a card that went back to To forward.
  const outcome: OutcomeRow = { jobId: JOB_A, outcome: 'no_answer', tutorId: null, note: null, at: day(1), staffName: null }
  assert.equal(states(events, [fwd(8)], [outcome])[0].checkWithParent, false)
  assert.equal(states([...events, ev(JOB_A, 't-paid-2', 'applied', day(0))], [fwd(8)])[0].checkWithParent, false)
})

test('who can act: owner, admin, operations and tuitions staff; the Partner cannot', () => {
  assert.deepEqual([...SCREEN_ACCESS.applicantForwards].sort(), ['admin', 'operations', 'tuitions_staff'])
  for (const role of ['owner', 'admin', 'operations', 'tuitions_staff'] as const) {
    assert.ok(roleSatisfies(role, SCREEN_ACCESS.applicantForwards), `${role} may act`)
  }
  // Both writes are POST routes behind checkAdminRole, which refuses a Partner on every write.
  for (const p of ['app/api/admin/applicant-forwards/forward/route.ts', 'app/api/admin/applicant-forwards/outcome/route.ts']) {
    const s = code(p)
    assert.match(s, /export async function POST/)
    assert.doesNotMatch(s, /export async function GET/)
    assert.match(s, /checkAdminRole\(\.\.\.SCREEN_ACCESS\.applicantForwards\)/)
  }
  assert.match(code('lib/adminAuth.ts'), /Partner accounts are view-only|PARTNER_VIEW_ONLY/)
  // The UI offers a Partner no action: buttons, tick boxes and the outcome form sit behind !readOnly.
  const ui = code('app/admin/jobs/applicants/ApplicantsClient.tsx')
  assert.match(ui, /\{!readOnly && \(\s*<div className="mt-auto space-y-2">/)
  assert.match(ui, /canSelect=\{!readOnly\}/)
  const actions = ui.slice(ui.indexOf('{!readOnly && ('))
  for (const label of ['WhatsApp parent', 'Call parent', 'Mark as forwarded', 'Save outcome']) assert.ok(actions.includes(label), `${label} is inside the write-only block`)
  // Every action is audited on the tuition, so it shows in the tuition's admin page history.
  const lib = code('lib/applicantForwards.ts')
  assert.match(lib, /action: 'applicants\.forward',\s*targetType: 'job'/)
  assert.match(lib, /action: 'applicants\.outcome',\s*targetType: 'job'/)
  assert.match(code('app/admin/jobs/[id]/page.tsx'), /\.eq\('target_type', 'job'\)/)
  // Nothing about it reaches a member: no notify, no member timeline, no email.
  assert.doesNotMatch(lib, /notify\(|logActivity\(|deliverEmail\(/)
  // The sidebar item sits under Marketplace, and its badge is the To-forward count.
  const nav = read('lib/adminNav.ts')
  assert.match(nav, /href: '\/admin\/jobs\/applicants', label: 'Applicants to forward', icon: '\w+', screen: 'applicantForwards'/)
  assert.ok(nav.indexOf("'/admin/jobs/applicants'") > nav.indexOf("title: 'Marketplace'") && nav.indexOf("'/admin/jobs/applicants'") < nav.indexOf("title: 'Trust'"))
  assert.match(read('app/admin/layout.tsx'), /'\/admin\/jobs\/applicants': toForward/)
  // Unpaid, paused, banned and test tutors are dropped where the paid set is built.
  assert.match(lib, /!!t\.verified_fee_paid_at && !blocked\.has\(t\.id\)/)
})

// ------------------------------------------------------------- fee name ----

test('the fee is the "Verification Fee": no old name left in source or templates', () => {
  assert.equal(FEE_LABEL, 'Verification Fee')
  // Files that must keep the old words: the blog checker (which flags it as a
  // WRONG name), the one-time scripts that find and replace it, and this test.
  const ALLOWED = new Set([
    'lib/ai/platformFacts.ts',
    'scripts/test-blog-facts.ts',
    'scripts/test-applicant-forwards.ts',
    'scripts/dataop-fix-published-posts.ts',
    'scripts/dataop-rename-fee.ts',
    'scripts/report-fee-name.ts',
  ])
  const OLD = /spam[\s-]*free(?:\s+platform)?\s+fee|اسپام فری/i
  const hits: string[] = []
  const walk = (dir: string) => {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f).replace(/\\/g, '/')
      if (statSync(p).isDirectory()) walk(p)
      else if (/\.(ts|tsx|css|json|md)$/.test(f) && !ALLOWED.has(p) && OLD.test(readFileSync(p, 'utf8'))) hits.push(p)
    }
  }
  for (const root of ['app', 'components', 'lib', 'scripts']) walk(root)
  assert.deepEqual(hits, [], 'no file still names the old fee')
  // The default message templates (seeded by migrations) never held it.
  const seeded = readdirSync('supabase/migrations')
    .filter((f) => /\.sql$/.test(f))
    .filter((f) => /admin_message_templates/.test(read(`supabase/migrations/${f}`)) && OLD.test(read(`supabase/migrations/${f}`)))
  assert.deepEqual(seeded, [], 'no seeded message template names the old fee')
  // The blog checker now treats the old name as wrong and suggests the new one.
  assert.match(read('lib/ai/platformFacts.ts'), /spam\[- \]free\\s\+platform\|platform/)
  // The Urdu label moved with it.
  assert.match(read('lib/tutorSettingsCopy.ts'), /title: \{ en: 'Verification Fee', ur: 'تصدیقی فیس' \}/)
  // Our own screens still do not put the amount beside the name on the verify step.
  assert.doesNotMatch(read('components/tutor/VerifyBenefitsDialog.tsx'), /Rs\.?\s?199|199/)
})

// --------------------------------------------------- profile photo rotate ----

const ORIGIN = 'https://abcd1234.supabase.co'
const ORIGINAL = `${ORIGIN}/storage/v1/object/public/avatars/11111111-1111-1111-1111-111111111111/photo.jpg`
const COPY = `${ORIGIN}/storage/v1/object/public/avatars/11111111-1111-1111-1111-111111111111/rotated-1-r90.jpg`

test('a profile-photo rotation is a saved setting made from the uploaded original', () => {
  // First turn: nothing saved yet, so the original is what is shown.
  const first = planAvatarRotation(ORIGINAL, null, 90)
  assert.deepEqual(first, { previous: 0, rotation: 90, originalUrl: ORIGINAL, makeCopy: true, restoreUrl: null })
  // Turned again from the saved state: still made from the ORIGINAL, not the copy.
  const saved = { rotation: 90, original_url: ORIGINAL, rotated_url: COPY }
  assert.deepEqual(currentAvatarState(COPY, saved), { originalUrl: ORIGINAL, rotation: 90 })
  const second = planAvatarRotation(COPY, saved, 90)
  assert.deepEqual([second.previous, second.rotation, second.originalUrl, second.makeCopy], [90, 180, ORIGINAL, true])
  // "Rotate left" from 90 comes back to 0: no copy, the original is restored.
  const back = planAvatarRotation(COPY, saved, 270)
  assert.deepEqual(back, { previous: 90, rotation: 0, originalUrl: ORIGINAL, makeCopy: false, restoreUrl: ORIGINAL })
  // The member uploaded a NEW photo since: the saved row no longer applies.
  const NEW_PHOTO = `${ORIGIN}/storage/v1/object/public/avatars/11111111-1111-1111-1111-111111111111/new.jpg`
  assert.deepEqual(currentAvatarState(NEW_PHOTO, saved), { originalUrl: NEW_PHOTO, rotation: 0 })
  assert.equal(planAvatarRotation(NEW_PHOTO, saved, 90).originalUrl, NEW_PHOTO)

  // The copy is a NEW object beside the original — never the original's own path.
  const path = rotatedCopyPath('uid/photo.jpg', 90, 1700000000000)
  assert.equal(path, 'uid/rotated-1700000000000-r90.jpg')
  assert.notEqual(path, 'uid/photo.jpg')
  // Only our own public avatar buckets are ever copied from.
  assert.deepEqual(parsePublicStorageUrl(ORIGINAL, ORIGIN), { bucket: 'avatars', path: '11111111-1111-1111-1111-111111111111/photo.jpg' })
  assert.equal(parsePublicStorageUrl('https://evil.example/storage/v1/object/public/avatars/a.jpg', ORIGIN), null)
  assert.equal(parsePublicStorageUrl(`${ORIGIN}/storage/v1/object/public/identity-docs/uid/cnic.jpg`, ORIGIN), null)
  assert.equal(parsePublicStorageUrl('data:image/png;base64,AAAA', ORIGIN), null)
  assert.equal(parsePublicStorageUrl(`${ORIGIN}/storage/v1/object/public/avatars/../identity-docs/x`, ORIGIN), null)
})

test('the uploaded photo file is never changed, and the saved rotation reaches every screen', () => {
  const save = code('lib/avatarRotation.ts')
  // No call that overwrites, moves or removes a stored file.
  assert.doesNotMatch(save, /\.remove\(|\.move\(|\.update\(\s*source\.path|upsert: true/)
  assert.equal((save.match(/\.upload\(/g) ?? []).length, 1)
  assert.match(save, /\.upload\(copyPath, copy, \{ contentType: 'image\/jpeg', upsert: false \}\)/)
  assert.match(save, /rotatedCopyPath\(source\.path, plan\.rotation, Date\.now\(\)\)/)
  // Saved as a setting, audited with the old and new value.
  assert.match(save, /\.from\('avatar_rotations'\)\s*\.upsert\(/)
  assert.match(save, /action: 'profile_photo\.rotate'/)
  assert.match(save, /oldRotation: plan\.previous, newRotation: plan\.rotation/)
  // Applied everywhere: every surface reads avatar_url, which now names the turned copy.
  assert.match(save, /\.from\('profiles'\)\.update\(\{ avatar_url: newUrl \}\)/)
  for (const reader of ['components/Avatar.tsx', 'lib/seo.ts']) assert.ok(read(reader).length > 0)
  assert.match(read('app/(site)/tutor/[slug]/page.tsx'), /avatar_url/)
  // Same access as documents; the Partner is refused (a POST behind checkAdminRole).
  const route = code('app/api/admin/profile-photo/rotate/route.ts')
  assert.match(route, /export async function POST/)
  assert.match(route, /checkAdminRole\(\.\.\.SCREEN_ACCESS\.documentRotate\)/)
  assert.deepEqual([...SCREEN_ACCESS.documentRotate].sort(), ['admin', 'operations'])
  const migration = read('supabase/migrations/161_applicant_forwards_avatar_rotation.sql')
  assert.match(migration, /create table if not exists public\.avatar_rotations/)
  assert.match(migration, /rotation\s+smallint not null default 0 check \(rotation in \(0, 90, 180, 270\)\)/)
  // The viewer offers rotate for the profile picture on the review card.
  assert.match(read('components/admin/TutorDocumentReview.tsx'), /alt: 'Profile picture', profileId: tutorId/)
  assert.match(code('components/admin/DocumentViewer.tsx'), /const canRotate = \(!!img\.documentId \|\| !!img\.profileId\) && !readOnly/)
})

// ----------------------------------------------------------------- viewer ----

const noop = () => {}
const frame = (over: Partial<Parameters<typeof ViewerFrame>[0]> = {}) =>
  renderToStaticMarkup(
    createElement(ViewerFrame, {
      image: { src: 'https://x/p.jpg', alt: 'Profile picture', profileId: 'p1' },
      position: null,
      zoom: 1,
      pan: { x: 0, y: 0 },
      turns: 0,
      canRotate: true,
      saving: false,
      onZoom: noop,
      onPan: noop,
      onTurn: noop,
      onSave: noop,
      onStep: noop,
      onClose: noop,
      ...over,
    }),
  )

test('the viewer backdrop covers the whole page and nothing behind it shows or can be clicked', () => {
  const out = frame()
  const root = /<div class="([^"]+)" role="dialog"/.exec(out)?.[1] ?? ''
  for (const cls of ['fixed', 'inset-0', 'h-dvh', 'w-screen', 'bg-tm-black']) assert.ok(root.split(' ').includes(cls), `backdrop has ${cls}`)
  // Opaque: no translucent black anywhere in the viewer's own surface.
  assert.doesNotMatch(root, /bg-tm-black\/\d+/)
  assert.doesNotMatch(root, /pointer-events-none/)
  assert.match(out, /aria-modal="true"/)
  // The rotate bar has its own solid ground too.
  assert.match(out, /<div class="[^"]*shrink-0[^"]*bg-tm-black[^"]*">\s*<button[^>]*>.*?Rotate left/)
  // Drawn in <body> through a portal, above the page and below toasts.
  const src = code('components/admin/DocumentViewer.tsx')
  assert.match(src, /createPortal\(/)
  assert.match(root, /z-\[99\]/)
})

test('every picture fits its stage, with the bars never over it, before and after a quarter turn', () => {
  const upright = frame()
  // The stage is the space between the bars, and the picture is sized from IT.
  assert.match(upright, /data-viewer-stage=""/)
  assert.match(upright, /container-type:size/)
  assert.match(upright, /width:calc\(100cqw - 16px\);height:calc\(100cqh - 16px\)/)
  assert.match(upright, /object-contain/)
  const turned = frame({ turns: 90 })
  assert.match(turned, /width:calc\(100cqh - 16px\);height:calc\(100cqw - 16px\)/)
  assert.match(turned, /rotate\(90deg\)/)
  assert.match(frame({ turns: 180 }), /width:calc\(100cqw - 16px\);height:calc\(100cqh - 16px\)/)
  // No viewport guess for the bars is left, and nothing measures in script.
  const src = code('components/admin/DocumentViewer.tsx')
  assert.doesNotMatch(src, /100dvh - |CHROME_PX|ResizeObserver|getBoundingClientRect|onLoad/)
  // The bars are flex siblings of the stage (shrink-0), so they take room, not overlap.
  assert.match(upright, /class="flex shrink-0 items-center justify-between/)
  assert.match(upright, /class="relative min-h-0 flex-1 touch-none overflow-hidden"/)
})

test('the rotate buttons use the admin icon set, not text glyphs', () => {
  const out = frame()
  assert.doesNotMatch(out, /[⟲⟳↺↻]/)
  assert.match(out, /lucide-rotate-ccw/)
  assert.match(out, /lucide-rotate-cw/)
  assert.match(out, />\s*Rotate left\s*</)
  assert.match(out, />\s*Rotate right\s*</)
  assert.match(out, /Save rotation/)
  assert.doesNotMatch(frame({ canRotate: false }), /Rotate left|Save rotation/)
})
