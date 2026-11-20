/**
 * scripts/test-pr11.ts — PR-11 (owner, 20 Nov 2026). INVENTED data only — no
 * database, no production read.
 *   1. erase fingerprints are keyed (HMAC), normalised, never the number;
 *   2. a sign-up with an erased mobile or CNIC is blocked, sends no OTP, and
 *      alerts the Owner; Allow unblocks it and Undo re-blocks it;
 *   3. grey "Deleted user" rows show no personal data;
 *   4. /browse/tutors and the city tutor pages render numbered page links that
 *      reach every indexable tutor;
 *   5. tuition → tutor links and similar-tutor links;
 *   6. the tutor sitemap lists only indexable tutors (lastmod = last real change);
 *   7. the inbox speed-up returns identical results.
 *
 *   npm run test:pr11
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash, createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import {
  accountFingerprints,
  applyAllow,
  applyUndoAllow,
  blockedMessage,
  fingerprint,
  FINGERPRINT_ENV,
  lastTwo,
  maskedLastTwo,
  normaliseForFingerprint,
  runBlockCheck,
  siblingIds,
  todoCount,
  type BlockStore,
  type FingerprintKind,
  type FingerprintRow,
} from '../lib/eraseFingerprintCore'
import { DELETED_ROW_STRIP, deletedUserLine, shownMember, stripDeleted } from '../lib/deletedUserCore'
import {
  CITY_TUTORS_PAGE_SIZE,
  cityTutorPageIndexable,
  cityTutorPath,
  femaleTutorPageIndexable,
  pageCount,
  similarTutors,
  tutorCities,
  tutorsForTuition,
  type CrawlTutor,
} from '../lib/tutorCrawlCore'
import { pageHref, pageLinkNumbers } from '../lib/crawlLinksCore'
import { queryTwinPath } from '../lib/queryTwinCore'
import { hubSitemapEntries, tutorSitemapEntries } from '../lib/sitemapCore'
import { pageAllIn } from '../lib/pageAll'
import { INBOX_SNAPSHOT_MAX_AGE_MS, pkDayKeyOf, storedInboxUsable } from '../lib/interestInboxCore'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = (p: string) => readFileSync(join(ROOT, p), 'utf8')

// Invented values only.
const SECRET = 'test-secret-not-a-real-key-0123456789'
const MOBILE = '0300 1234567'
const CNIC = '35202-1234567-1'

// ------------------------------------------------------------------ 1 ---

test('fingerprints are HMAC-SHA256 with the secret, not a plain hash', () => {
  const fp = fingerprint('mobile', MOBILE, SECRET)!
  assert.match(fp, /^[0-9a-f]{64}$/)
  assert.equal(fp, createHmac('sha256', SECRET).update('mobile:923001234567').digest('hex'))
  assert.notEqual(fp, createHash('sha256').update('923001234567').digest('hex'), 'not an unkeyed hash')
  assert.notEqual(fp, fingerprint('mobile', MOBILE, SECRET + 'x'), 'another key, another fingerprint')
  assert.equal(fingerprint('mobile', MOBILE, null), null, 'no key → nothing (the erase skips it)')
  assert.equal(fingerprint('mobile', MOBILE, 'short'), null, 'a too-short key counts as missing')
})

test('fingerprints are normalised: every way of writing one number is one fingerprint', () => {
  const a = fingerprint('mobile', '03001234567', SECRET)
  for (const v of ['0300-1234567', '+92 300 1234567', '923001234567', '0092 300 1234567']) assert.equal(fingerprint('mobile', v, SECRET), a, v)
  assert.equal(normaliseForFingerprint('mobile', '0300 1234567'), '923001234567')
  assert.equal(normaliseForFingerprint('cnic', CNIC), '3520212345671')
  assert.equal(fingerprint('cnic', '3520212345671', SECRET), fingerprint('cnic', CNIC, SECRET))
  assert.equal(normaliseForFingerprint('cnic', '12345'), null, 'not a CNIC → no fingerprint')
  // A mobile and a CNIC can never collide (the kind is part of the message).
  assert.notEqual(fingerprint('mobile', MOBILE, SECRET), fingerprint('cnic', MOBILE, SECRET))
})

test('an account gives one fingerprint per distinct number; none carries the digits', () => {
  const fps = accountFingerprints({ mobiles: [MOBILE, '+923001234567', '03211234567', null, ''], cnic: CNIC }, SECRET)
  assert.equal(fps.length, 3, 'two distinct mobiles + one CNIC')
  for (const f of fps) {
    assert.ok(!f.fingerprint.includes('3001234567') && !f.fingerprint.includes('1234567'), 'no digits of the number')
    assert.match(f.fingerprint, /^[0-9a-f]{64}$/)
  }
  assert.equal(lastTwo('mobile', MOBILE), '67')
  assert.equal(lastTwo('cnic', CNIC), '71')
  assert.equal(maskedLastTwo('67'), '••••••67')
})

test('nothing stores or logs a number: tables, logs and the erase', () => {
  const mig = src('supabase/migrations/239_erase_fingerprints_and_crawl.sql')
  assert.match(mig, /check \(fingerprint ~ '\^\[0-9a-f\]\{64\}\$'\)/, 'only a 64-hex digest fits the column')
  assert.match(mig, /check \(last2 ~ '\^\[0-9\]\{2\}\$'\)/, 'attempts keep two digits only')
  assert.ok(!/phone|cnic_number|mobile_number/i.test(mig.split('-- ---------------------------------------------------------------------- 3 ---')[0].replace(/--[^\n]*/g, '')), 'no number column')
  const io = src('lib/eraseFingerprint.ts')
  for (const line of io.split('\n').filter((l) => /console\./.test(l))) {
    assert.ok(!/raw|mobile|cnic|fp\b|fingerprint\)/i.test(line.replace(/re-sign-up block[^'`]*/g, '')), `log line names no number: ${line.trim()}`)
  }
  const erase = src('lib/accountErase.ts')
  const fpAt = erase.indexOf('recordErasedFingerprints(admin')
  const clearAt = erase.indexOf("must('profile', admin.from('profiles').update(profileErasePatch")
  assert.ok(fpAt > 0 && clearAt > fpAt, 'fingerprints are stored BEFORE the numbers are cleared')
  assert.match(erase, /mobiles: \[prof\.phone_number, prof\.whatsapp, prof\.secondary_phone, t\.phone_number, t\.whatsapp_number\]/)
  assert.match(io, new RegExp(`${FINGERPRINT_ENV}|FINGERPRINT_ENV`), 'the missing key is named')
  assert.match(io, /not stored|skippedNote/, 'a missing key never fails the erase')
})

// ------------------------------------------------------------------ 2 ---

/** An in-memory store: the same interface the database store implements. */
function memoryStore(rows: FingerprintRow[]) {
  const state = { rows, attempts: [] as { fingerprintId: string; last2: string; at: number }[], bells: [] as string[], now: Date.parse('2026-11-20T10:00:00Z') }
  const store: BlockStore = {
    async findBlocked(kind, fp) {
      const r = state.rows.filter((x) => x.kind === kind && x.fingerprint === fp && !x.allowedAt).sort((a, b) => b.erasedAt.localeCompare(a.erasedAt))[0]
      return r ? { id: r.id, erasedAt: r.erasedAt } : null
    },
    async recentAttempts(id, since) {
      return state.attempts.filter((a) => a.fingerprintId === id && a.at >= Date.parse(since)).length
    },
    async addAttempt(a) {
      state.attempts.push({ fingerprintId: a.fingerprintId, last2: a.last2, at: state.now })
    },
    async bellOwner(n) {
      state.bells.push(n.title)
    },
    async supportWhatsapp() {
      return '0300 0000000'
    },
  }
  return { store, state }
}

function erasedRows(): FingerprintRow[] {
  return accountFingerprints({ mobiles: [MOBILE], cnic: CNIC }, SECRET).map((f, i) => ({
    id: `fp-${i}`,
    kind: f.kind,
    fingerprint: f.fingerprint,
    memberId: 'erased-member',
    erasedAt: '2026-11-01T00:00:00Z',
    allowedAt: null,
  }))
}

/** What a sign-up route does: the check first; a code only when not blocked. */
async function signUp(store: BlockStore, kind: FingerprintKind, raw: string, now: number, sent: string[]) {
  const r = await runBlockCheck(store, { kind, raw, step: kind === 'cnic' ? 'cnic' : 'signup', secret: SECRET, nowMs: now })
  if (r.blocked) return { status: 403, error: r.message }
  sent.push(raw)
  return { status: 200 }
}

test('a sign-up with an erased mobile is blocked, sends no OTP, and bells the Owner', async () => {
  const { store, state } = memoryStore(erasedRows())
  const sent: string[] = []
  const r = await signUp(store, 'mobile', '+92 300 1234567', state.now, sent)
  assert.equal(r.status, 403)
  assert.equal(r.error, 'This number belongs to a closed TutorMint account. Please contact support on WhatsApp 0300 0000000.')
  assert.equal(sent.length, 0, 'no OTP sent')
  assert.equal(state.bells.length, 1, 'the Owner is alerted')
  assert.equal(state.attempts[0].last2, '67', 'only the last two digits are kept')
  // A second try within the hour: blocked again, no second bell.
  await signUp(store, 'mobile', MOBILE, state.now, sent)
  assert.equal(state.bells.length, 1)
  assert.equal(state.attempts.length, 2)
  // Another number is not touched.
  assert.equal((await signUp(store, 'mobile', '0333 7654321', state.now, sent)).status, 200)
  assert.deepEqual(sent, ['0333 7654321'])
})

test('a CNIC of an erased account is blocked at the CNIC step', async () => {
  const { store, state } = memoryStore(erasedRows())
  const sent: string[] = []
  assert.equal((await signUp(store, 'cnic', '3520212345671', state.now, sent)).status, 403)
  assert.equal(state.bells.length, 1)
})

test('Allow unblocks the number; Undo blocks it again', async () => {
  let rows = erasedRows()
  const mobileRow = rows.find((r) => r.kind === 'mobile')!
  const ids = siblingIds(rows, mobileRow.id)
  rows = applyAllow(rows, ids, '2026-11-20T11:00:00Z')
  let mem = memoryStore(rows)
  assert.equal((await signUp(mem.store, 'mobile', MOBILE, mem.state.now, [])).status, 200, 'allowed → can sign up')
  assert.equal((await signUp(mem.store, 'cnic', CNIC, mem.state.now, [])).status, 403, 'the CNIC stays blocked')
  rows = applyUndoAllow(rows, ids)
  mem = memoryStore(rows)
  assert.equal((await signUp(mem.store, 'mobile', MOBILE, mem.state.now, [])).status, 403, 'Undo → blocked again')
  assert.equal(todoCount([{ reviewedAt: null, allowed: false }, { reviewedAt: null, allowed: true }, { reviewedAt: 'x', allowed: false }]), 1)
})

test('no key → never blocked (fails open), and the routes check before any code or save', async () => {
  const { store, state } = memoryStore(erasedRows())
  assert.deepEqual(await runBlockCheck(store, { kind: 'mobile', raw: MOBILE, step: 'signup', secret: undefined, nowMs: state.now }), { blocked: false })
  const reg = src('app/api/auth/register/route.ts')
  assert.ok(reg.indexOf("checkErasedBlock('mobile', mobile, 'signup')") > 0 && reg.indexOf("checkErasedBlock('mobile', mobile, 'signup')") < reg.indexOf('startPendingSignup({'), 'register: before the SMS')
  const otp = src('app/api/auth/otp/route.ts')
  assert.ok(otp.indexOf("checkErasedBlock('mobile', phone, 'verify')") < otp.indexOf("sendOtp({ phone, purpose: 'verify'"), 'otp: before the SMS')
  const id = src('app/api/identity/route.ts')
  assert.ok(id.indexOf("checkErasedBlock('cnic', cnicNumber, 'cnic')") < id.indexOf('.update({ cnic_number: formatCnic(cnicNumber) })'), 'CNIC: before the save')
  assert.match(blockedMessage('0321 5872222'), /^This number belongs to a closed TutorMint account\. Please contact support on WhatsApp 0321 5872222\.$/)
  const route = src('app/api/admin/blocked-signups/route.ts')
  assert.match(route, /refuseUnlessOwnerApproval/, 'Allow / Undo are Owner only')
  assert.match(route, /reason: text\(\{ min: 3/, 'Allow needs a reason')
  assert.match(src('lib/eraseFingerprint.ts'), /signup_block\.allow/, 'logged')
  assert.match(src('lib/overviewItemsCore.ts'), /'todo-blocked-signups': \{ title: 'Blocked re-sign-ups'/, 'Overview to-do')
})

// ------------------------------------------------------------------ 3 ---

test('grey Deleted user rows carry no personal data', () => {
  assert.equal(deletedUserLine('2026-11-20T03:00:00Z'), 'Deleted user · erased 20 Nov 2026')
  assert.equal(deletedUserLine(null), 'Deleted user')
  const row = { name: 'Invented Person', email: 'someone@example.test', phone: '03001234567', avatar: 'x.jpg', city: 'Lahore', amount: 199, erasedAt: '2026-11-19T20:00:00Z' }
  const shown = stripDeleted(shownMember(row))
  assert.equal(shown.name, 'Deleted user · erased 20 Nov 2026', 'PKT date')
  assert.equal(shown.amount, 199, 'amounts stay')
  for (const k of DELETED_ROW_STRIP) if (k in shown) assert.equal((shown as Record<string, unknown>)[k], null, k)
  assert.ok(!JSON.stringify(shown).includes('Invented') && !JSON.stringify(shown).includes('0300') && !JSON.stringify(shown).includes('@'))
  const live = shownMember({ name: 'Invented Person', erasedAt: null })
  assert.equal(live.name, 'Invented Person')
  assert.equal(live.deleted, false)
})

test('every listed screen renders the grey row and drops contact and action buttons', () => {
  const q = src('lib/adminQueues.ts')
  assert.match(q, /name: member\?\.erasedAt \? deletedUserLine\(member\.erasedAt\)/, 'Payments: no name')
  assert.match(q, /email: member\?\.erasedAt \? '—'/, 'Payments: no email')
  assert.match(q, /r\.avatar = r\.userId && !r\.erasedAt/, 'Payments: no photo')
  const pq = src('app/admin/payments/PaymentQueue.tsx')
  assert.match(pq, /<DeletedUserName erasedAt=\{p\.erasedAt\} \/>/)
  assert.match(pq, /canApprove && awaitingApproval\(p\) && !p\.erasedAt/, 'no receipt decision')
  assert.match(pq, /<RefundControl/, 'the Owner money action (refund) stays')
  assert.match(src('app/admin/finance/statement/StatementClient.tsx'), /if \(erased\?\.\[id\]\) return <MemberNameLink/, 'statement matches')
  assert.match(src('app/admin/finance/settlement/SettlementTab.tsx'), /loadErasedAt\(page\.rows/, 'Finance lists')
  const apps = src('app/admin/applications/ApplicationsClient.tsx')
  assert.match(apps, /const editable = mayEditStage\(actor, r\.ownerId\) && !r\.unavailable && !gone/, 'Applications: read only')
  assert.match(apps, /\{!gone && \(/, 'Applications: no buttons')
  assert.match(src('lib/applicationTracking.ts'), /tutorPhone: phone && !p\?\.erased_at/, 'Applications: no phone')
  assert.match(src('app/admin/users/PeopleTabs.tsx'), /if \(erased\[id\]\) \{\n\s+return \{ id, title: 'Deleted user'.*member: null, erasedAt/, 'People → Deleted')
  assert.match(src('app/admin/users/[id]/Timeline.tsx'), /deleted=\{!!erasedAt\}/, 'timeline')
  const link = src('components/admin/MemberNameLink.tsx')
  assert.match(link, /if \(erasedAt\) return <DeletedUserName/, 'no link to a deleted user')
  const comp = src('components/admin/DeletedUserName.tsx')
  assert.match(comp, /<Avatar name=\{DELETED_USER\} src=\{null\} gender=\{null\}/, 'the neutral default avatar')
})

// ------------------------------------------------------------------ 4 ---

function invented(n: number, city: string, female = 0): CrawlTutor[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `${city}-${i}`,
    slug: `tutor-${city.toLowerCase()}-${i}`,
    name: `Tutor ${i}`,
    city,
    citySlug: city.toLowerCase(),
    gender: i < female ? ('female' as const) : ('male' as const),
    masters: [100 + (i % 3)],
    subjects: [['mathematics', 'physics', 'english'][i % 3]],
    levels: [['o levels', 'matric', 'a levels'][i % 3]],
  }))
}

/** Every page a crawler reaches from page 1 by following the numbered links. */
function crawl(path: string, pages: number): Set<number> {
  const seen = new Set<number>([1])
  const queue = [1]
  while (queue.length) {
    const p = queue.shift()!
    for (const n of pageLinkNumbers(p, pages)) {
      if (n === null || seen.has(n)) continue
      assert.ok(pageHref(path, n).startsWith(path), 'a real link on the same path')
      seen.add(n)
      queue.push(n)
    }
  }
  return seen
}

test('numbered page links reach every page — so every indexable tutor — on /browse/tutors and city pages', () => {
  for (const total of [1, 12, 13, 150, 401]) {
    const pages = pageCount(total)
    assert.equal(pages, Math.max(1, Math.ceil(total / CITY_TUTORS_PAGE_SIZE)))
    for (const path of ['/browse/tutors', '/tutors/lahore', '/tutors/lahore/female']) {
      assert.equal(crawl(path, pages).size, pages, `${path}: all ${pages} pages reachable`)
    }
    // Every tutor sits on exactly one page.
    const list = Array.from({ length: total }, (_, i) => i)
    const covered = new Set<number>()
    for (let p = 1; p <= pages; p++) for (const t of list.slice((p - 1) * CITY_TUTORS_PAGE_SIZE, p * CITY_TUTORS_PAGE_SIZE)) covered.add(t)
    assert.equal(covered.size, total)
  }
  assert.equal(pageHref('/browse/tutors', 2), '/browse/tutors?page=2')
  assert.equal(queryTwinPath('/tutors/lahore', new URLSearchParams('page=2')), '/qs/tutors/lahore', '?page= goes live')
  assert.equal(queryTwinPath('/tutors/lahore/female', new URLSearchParams('page=3')), '/qs/tutors/lahore/female')
  assert.equal(queryTwinPath('/tutors/lahore', new URLSearchParams('')), null, 'the clean page stays cached')
  assert.equal(queryTwinPath('/tutors/lahore/o-levels-mathematics', new URLSearchParams('page=2')), null, 'subject pages untouched')
  const browse = src('app/(site)/browse/tutors/BrowseTutorsView.tsx')
  assert.match(browse, /<PageLinks\s+path="\/browse\/tutors"/, '/browse/tutors renders numbered links')
  assert.match(browse, /<CityTutorLinks \/>/, '/browse/tutors links the city pages')
  const view = src('components/landing/CityTutorsView.tsx')
  assert.match(view, /<PageLinks path=\{path\} page=\{page\} pages=\{pages\}/, 'city pages render numbered links')
  assert.match(view, /<Breadcrumbs/, 'breadcrumbs')
  assert.match(src('components/home/HomeLinks.tsx'), /<CityTutorLinks heading="Tutors by city"/, 'homepage city area links them')
  assert.ok(!/\{c\.(indexable|female)\}/.test(src('components/seo/CityTutorLinks.tsx')), 'no counts in the city links')
})

test('a city tutor page is indexable from 3 indexable tutors; the female variant from 3 women', () => {
  const cities = tutorCities([...invented(5, 'Lahore', 3), ...invented(2, 'Multan', 2), ...invented(3, 'Karachi', 0)])
  const by = new Map(cities.map((c) => [c.citySlug, c]))
  assert.deepEqual(cities.map((c) => c.citySlug), ['lahore', 'karachi', 'multan'], 'busiest first')
  assert.ok(cityTutorPageIndexable(by.get('lahore')) && femaleTutorPageIndexable(by.get('lahore')))
  assert.ok(cityTutorPageIndexable(by.get('karachi')) && !femaleTutorPageIndexable(by.get('karachi')))
  assert.ok(!cityTutorPageIndexable(by.get('multan')), 'below 3 → noindex')
  assert.equal(cityTutorPath('lahore', true), '/tutors/lahore/female')
  const shared = src('app/(site)/tutors/[city]/shared.ts')
  assert.match(shared, /cityTutorsIndexable\(city, female\) \? \{\} : \{ robots: \{ index: false, follow: true \} \}/)
  assert.match(shared, /knownCityBySlug/, 'a known city never 404s')
})

// ------------------------------------------------------------------ 5 ---

test('an open tuition links up to 6 matching indexable tutors: city, then subject/level, then gender rule', () => {
  const tutors = [...invented(10, 'Lahore', 4), ...invented(5, 'Karachi', 5)]
  const job = { id: 'job-1', city: 'Lahore', masters: [100], subjects: ['mathematics'], levels: ['o levels'], genderPref: null }
  const out = tutorsForTuition(tutors, job)
  assert.equal(out.length, 6)
  assert.ok(out.every((t) => t.citySlug === 'lahore'), 'same city only')
  const firstMiss = out.findIndex((t) => !t.masters.includes(100))
  assert.ok(out.slice(0, firstMiss === -1 ? out.length : firstMiss).every((t) => t.masters.includes(100)), 'exact subject × level first')
  assert.deepEqual(tutorsForTuition(tutors, job).map((t) => t.id), out.map((t) => t.id), 'stable')
  const fem = tutorsForTuition(tutors, { ...job, genderPref: 'female' })
  assert.ok(fem.length > 0 && fem.every((t) => t.gender === 'female'), 'gender preference respected')
  assert.equal(tutorsForTuition(tutors, { ...job, city: 'Quetta' }).length, 0, 'no tutors elsewhere')
  assert.equal(tutorsForTuition(tutors, { ...job, city: null }).length, 0)
  const page = src('app/(site)/tuitions/[city]/[slug]/page.tsx')
  assert.match(page, /const tutorLinks = state\.isOpen\s*\n?\s*\? await tutorLinksForTuition/, 'open tuitions only')
  assert.match(page, /<RelatedTutorLinks\s+tutors=\{tutorLinks\}/)
})

test('an indexable profile links up to 6 similar indexable tutors: same city and subject, never itself', () => {
  const tutors = invented(20, 'Lahore')
  const self = tutors[0]
  const out = similarTutors(tutors, self)
  assert.ok(out.length > 0 && out.length <= 6)
  assert.ok(out.every((t) => t.id !== self.id && t.citySlug === self.citySlug && t.subjects.some((s) => self.subjects.includes(s))))
  assert.equal(similarTutors([...invented(3, 'Karachi')], { ...self }).length, 0, 'another city → none')
  const prof = src('app/(site)/tutor/[slug]/profile.tsx')
  assert.match(prof, /indexable && !preview \? await similarTutorLinks\(tutor\.id\)/, 'only on indexable profiles')
})

// ------------------------------------------------------------------ 6 ---

test('the tutor sitemap lists only indexable tutors, lastmod = last real change', () => {
  const base = 'https://example.test'
  const entries = tutorSitemapEntries(base, [
    { path: '/tutor/a', feePaid: true, cnicApproved: true, profilePicApproved: true, lastmod: '2026-11-10T00:00:00Z' },
    { path: '/tutor/b', feePaid: false, cnicApproved: true, profilePicApproved: true },
    { path: '/tutor/c', feePaid: true, cnicApproved: false, profilePicApproved: true },
    { path: '/tutor/d', feePaid: true, cnicApproved: true, profilePicApproved: false },
    { path: '/tutor/e', feePaid: true, cnicApproved: true, profilePicApproved: true, isSeed: true },
    { path: '/tutor/f', feePaid: true, cnicApproved: true, profilePicApproved: true, underReview: true },
  ])
  assert.deepEqual(entries.map((e) => e.url), [`${base}/tutor/a`])
  assert.ok(String(entries[0].lastmod).startsWith('2026-11-10'))
  assert.match(src('lib/sitemaps.ts'), /db\.rpc\('listed_tutor_slugs'\)/, 'from the SQL mirror of the index rule')
  const mig = src('supabase/migrations/239_erase_fingerprints_and_crawl.sql')
  assert.match(mig, /greatest\(d\.created_at, coalesce\(tp\.content_updated_at, tp\.updated_at, d\.created_at\)\)/, 'lastmod = content_updated_at')
  assert.match(mig, /'whatsapp_updates'\n\s+\];/, 'bookkeeping columns do not move it')
  // City tutor hubs in the pages sitemap only at the threshold.
  const hubs = hubSitemapEntries(base, [
    { path: '/tutors/lahore', count: 5, threshold: 3 },
    { path: '/tutors/multan', count: 2, threshold: 3 },
  ])
  assert.deepEqual(hubs.map((h) => h.url), [`${base}/tutors/lahore`])
  assert.ok(!/indexing|URL_UPDATED/i.test(src('lib/tutorCrawl.ts')), 'the Indexing API is never used for profiles')
})

// ------------------------------------------------------------------ 7 ---

test('parallel chunk reads return exactly the rows, in the order, of one-by-one reads', async () => {
  const ids = Array.from({ length: 537 }, (_, i) => `id-${i}`)
  const fetchChunk = (part: string[], from: number, to: number) =>
    new Promise<{ data: { id: string }[]; error: null }>((resolve) =>
      setTimeout(() => resolve({ data: part.slice(from, to + 1).map((id) => ({ id })), error: null }), Math.floor(Math.random() * 15)),
    )
  const one = await pageAllIn(ids, fetchChunk, 100, 1)
  const eight = await pageAllIn(ids, fetchChunk, 100, 8)
  assert.deepEqual(eight, one)
  assert.deepEqual(one.map((r) => r.id), ids)
  assert.deepEqual(await pageAllIn([], fetchChunk, 100, 8), [])
})

test('the stored inbox is the built inbox: identical after a round trip, used only while current', () => {
  // An invented inbox: the stored JSON must give back the same object.
  const inbox = {
    rows: [
      { tutorId: 't1', name: 'Tutor One', city: 'Lahore', paid: true, assigneeId: 'o', assigneeName: 'Owner', tab: 'to_send', wait: null, summary: { hottest: 'demo', counts: { demo: 1, message: 0, shortlist: 2, view: 0 }, parents: 2, newestAt: '2026-11-20T08:00:00Z' }, summaryText: 'x', message: 'm', pendingKinds: ['demo'], weekCount: 0, last: null, parents: [{ parentId: 'p1', name: 'P', maskedPhone: null, place: 'Lahore', actions: [{ kind: 'demo', at: '2026-11-20T08:00:00Z', blocked: false }] }] },
      { tutorId: 't2', name: 'Tutor Two', city: null, paid: false, assigneeId: 'o', assigneeName: 'Owner', tab: 'sent', wait: 'daily_cap', summary: { hottest: 'view', counts: { demo: 0, message: 0, shortlist: 0, view: 1 }, parents: 1, newestAt: '2026-11-19T08:00:00Z' }, summaryText: 'y', message: '', pendingKinds: [], weekCount: 1, last: { id: 's', at: '2026-11-19T09:00:00Z', by: 'Staff', staffId: 's1', from: 'inbox', recent: true }, parents: [] },
    ],
    counts: { byTab: { to_send: 1, sent: 1, new_since_sent: 0 } },
    excluded: { notEligible: 0, optedOut: 0, noNumber: 0 },
    staff: [{ id: 'o', name: 'Owner' }],
    cities: ['Lahore'],
    unpaidCap: 50,
  }
  assert.deepEqual(JSON.parse(JSON.stringify({ builtAt: 'x', pkDay: 'y', inbox })).inbox, inbox, 'no field lost or reordered')
  const now = Date.parse('2026-11-20T10:00:00Z')
  const stored = { builtAt: new Date(now - 30_000).toISOString(), pkDay: pkDayKeyOf(now) }
  assert.equal(storedInboxUsable(stored, now, '2026-11-20T09:00:00Z'), true, 'young, nothing newer → used')
  assert.equal(storedInboxUsable(stored, now, new Date(now - 1000).toISOString()), false, 'an event after the build → rebuilt')
  assert.equal(storedInboxUsable({ ...stored, builtAt: new Date(now - INBOX_SNAPSHOT_MAX_AGE_MS - 1).toISOString() }, now, null), false, 'too old → rebuilt')
  assert.equal(storedInboxUsable({ ...stored, pkDay: '2026-11-19' }, now, null), false, 'another Pakistan day → rebuilt (caps reset)')
  assert.equal(storedInboxUsable(null, now, null), false)
  assert.equal(pkDayKeyOf(Date.parse('2026-11-20T19:30:00Z')), '2026-11-21', 'PKT midnight is 19:00 UTC')
  const io = src('lib/interestInbox.ts')
  assert.match(io, /const inbox = await loadInterestInboxFresh\(nowMs\)/, 'the stored copy IS buildInbox output')
  assert.match(io, /export async function recordInterestSend[\s\S]*const b = await buildInbox\(admin, nowMs\)/, 'Send still re-checks fresh data')
  assert.match(src('app/api/cron/admin-summary/route.ts'), /refreshInterestInboxSnapshot\(\)/, 'refreshed by the 1-minute cron')
})
