/**
 * scripts/test-pr22.ts — npm run test:pr22
 *
 * PR-22 (owner, 24 Nov 2026): poster numbers read by the AI (images only),
 * Insights fixes (default Today, date boxes, visitors, funnels, devices), the
 * zero-result search check (failed ≠ zero, online tuitions city-agnostic on
 * Browse), and Admin → Growth → Search words.
 *
 * Pure rules and source checks, plus the image pipeline with the AI and OCR
 * mocked (invented number 0300 1234567). Reads nothing from production and
 * writes nothing anywhere.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { EXTRACT_SYSTEM, IMAGE_EXTRACT_SYSTEM, runExtraction, stripNumbers, type AiLists } from '../lib/aiTuitionExtractCore'
import { hasNumberLeft } from '../lib/postRedactCore'
import { NOTE_AI_ONLY, NOTE_BOTH, NOTE_DISAGREE, NOTE_NONE, NOTE_URDU, aiMobile, localPhone, pickImageNumber } from '../lib/imageNumberCore'
import { ocrMobiles } from '../lib/imageMaskCore'
import { cohortFunnel, funnelSteps, stepChange } from '../lib/signupFunnelCore'
import { DEVICE_KINDS, OS_KINDS, TUTOR_FUNNEL, PARENT_FUNNEL, deviceOf, emptyDay, mergePeriod, resolvePeriod, INSIGHTS_DAY_VERSION } from '../lib/insightsCore'
import { HUMAN_VISIBLE_MS, isAutomated } from '../lib/humanSignalCore'
import { cleanTerm, filterTerms, mergeTerms, suggestPages, termHref, termKey, wantedLine, SUGGEST_MIN_SEARCHES, type ComboLike } from '../lib/searchTermsCore'
import { modeAliasWords, parseQuery, type Dict } from '../lib/smartSearchCore'
import { SCREEN_ACCESS } from '../lib/adminAccessCore'
import { OVERVIEW_ITEMS } from '../lib/overviewItemsCore'

const INVENTED = '923001234567'
let failures = 0
const tests: { name: string; fn: () => void | Promise<void> }[] = []
const test = (name: string, fn: () => void | Promise<void>) => tests.push({ name, fn })
const src = (p: string) => readFileSync(p, 'utf8')

const LISTS: AiLists = {
  jobTitles: ['Home Tutor', 'Online Tutor', 'High School Teacher'],
  cities: ['Karachi', 'Lahore'],
  tree: { School: { 'Grade 9': ['Geography', 'History'] } },
}
const POSTER = '{"jobType":"High School Teacher","city":"Lahore","area":"Township","levels":["Grade 9"],"subjectsByLevel":{"Grade 9":["Geography","History"]},"description":"A school in Township needs a teacher. WhatsApp 0349-1234567.","contactPhone":"0300-1234567"}'

// ─────────────────────────────────── Part A — images vs pasted text ──

test('A.1 the number the image gives: both readers agree → used; disagree → the AI\'s, "Check this number"', () => {
  const both = pickImageNumber([{ msisdn: INVENTED, urdu: false }], '0300 1234567', false)
  assert.deepEqual([both.phone, both.source, both.note], ['03001234567', 'both', NOTE_BOTH])
  const differ = pickImageNumber([{ msisdn: '923001234568', urdu: false }], '0300 1234567', false)
  assert.deepEqual([differ.msisdn, differ.source, differ.note], [INVENTED, 'ai', NOTE_DISAGREE], 'the AI\'s number is filled when they disagree')
  const aiOnly = pickImageNumber(null, '+92 300 1234567', false)
  assert.deepEqual([aiOnly.msisdn, aiOnly.note], [INVENTED, NOTE_AI_ONLY], 'OCR failed: the AI\'s number alone')
  const ocrOnly = pickImageNumber([{ msisdn: INVENTED, urdu: false }], null, false)
  assert.deepEqual([ocrOnly.msisdn, ocrOnly.source], [INVENTED, 'ocr'])
  const none = pickImageNumber([], 'call us', false)
  assert.deepEqual([none.phone, none.note], [null, NOTE_NONE])
  assert.equal(localPhone(INVENTED), '03001234567', 'normalised to 03XXXXXXXXX')
  assert.equal(aiMobile('0300-123'), null, 'half a number is no number')
  for (const n of [both, differ, aiOnly, ocrOnly]) assert.match(n.note, /^Check this number/, 'always highlighted for staff')
})

test('A.4 a number in Urdu digits is always "Check this number" (either reader says so)', () => {
  assert.equal(pickImageNumber([], '۰۳۰۰۱۲۳۴۵۶۷', false).note, NOTE_URDU)
  assert.equal(pickImageNumber([], '03001234567', true).note, NOTE_URDU)
  assert.equal(pickImageNumber([{ msisdn: INVENTED, urdu: true }], '03001234567', false).note, NOTE_URDU)
  const w = (text: string, x: number) => ({ text, box: { x0: x, y0: 0, x1: x + 50, y1: 20 } })
  assert.deepEqual(ocrMobiles([{ words: [w('۰۳۰۰', 0), w('۱۲۳۴۵۶۷', 60)], urduDigits: true }]), [{ msisdn: INVENTED, urdu: true }], 'OCR\'s Urdu-digit number, marked Urdu')
  assert.deepEqual(ocrMobiles([{ words: [w('WhatsApp', 0), w('0300', 60), w('1234567', 120)] }]), [{ msisdn: INVENTED, urdu: false }])
})

test('A.1 Read from image: the AI gets the image unmasked, OCR runs beside it, the number comes back', async () => {
  const { extractTuitionFromImage, IMAGE_SYSTEM } = await import('../lib/imageRead')
  const upright = Buffer.from('UPRIGHT')
  let sent = ''
  let system = ''
  const r = await extractTuitionFromImage(Buffer.from('x'), {
    configured: () => true,
    prepare: async () => ({ ok: true, img: Buffer.from('PNG'), jpeg: upright }),
    ocr: async () => ({ ok: false, kind: 'timeout', reason: 'test' }),
    lists: async () => LISTS,
    complete: async (a) => {
      sent = a.image.base64
      system = a.system
      return { ok: true, text: POSTER }
    },
  })
  assert.ok(r.ok, 'an OCR timeout never stops the fill')
  if (r.ok) {
    assert.deepEqual(r.mobiles, [INVENTED])
    assert.equal(r.number.note, NOTE_AI_ONLY)
    assert.ok(!hasNumberLeft(r.fill.description) && !/1234567/.test(r.fill.description), 'no number in the public description')
    assert.match(r.fill.description, /Township/)
  }
  assert.equal(sent, upright.toString('base64'), 'the upright image, not a masked one')
  assert.equal(system, IMAGE_SYSTEM)
  assert.match(IMAGE_SYSTEM, /contactPhone/)
  assert.match(IMAGE_SYSTEM, /03XXXXXXXXX/)
  assert.ok(!/Phone numbers have been removed/.test(IMAGE_EXTRACT_SYSTEM))
  assert.equal(stripNumbers('Call 0300 1234567 or a@b.example.com now'), 'Call or now')
})

test('A.2 pasted text keeps the strict rule: numbers (English and Urdu digits) never reach the AI', async () => {
  assert.match(EXTRACT_SYSTEM, /Phone numbers have been removed/)
  let prompt = ''
  const r = await runExtraction('Home tutor Lahore Township, call 0300-1234567 or ۰۳۰۰۱۲۳۴۵۶۷', LISTS, async (a) => {
    prompt = a.prompt
    return { ok: true, text: '{"jobType":"Home Tutor","city":"Lahore","area":"Township"}' }
  })
  assert.ok(r.ok)
  assert.ok(!hasNumberLeft(prompt) && !/1234567/.test(prompt))
  const route = src('app/api/admin/jobs/ai-extract/route.ts')
  assert.ok(!/imageRead|contactPhone/.test(route), 'the text route never reads numbers')
  const box = src('components/forms/PastePostBox.tsx')
  assert.match(box, /redactForAi\(text\)/, 'the browser redacts pasted text first')
})

test('A.3 the filled number goes through every contact check before Post; always highlighted; never stored', () => {
  const form = src('components/forms/PostTuitionForm.tsx')
  assert.match(form, /mobile && !imageNumber \? \[\] : \(\['contactPhone'\]/, 'an image number is always marked')
  assert.match(form, /<CheckNote k="contactPhone" \/>/)
  assert.match(form, /\/api\/admin\/jobs\/contact-check/, 'the live contact check (withdrawn, erased, repeats) on the form number')
  assert.match(form, /autoCheck=\{gate\.key > 0 && !gate\.note\}/, 'an image number is not checked before staff look at it')
  assert.match(form, /checkNote=\{gate\.note\}/)
  const gate = src('components/forms/NumberFirstGate.tsx')
  assert.match(gate, /\/api\/admin\/jobs\/number-check/, 'Number first: Do not use / erased / on hold refused, Owner override logged')
  assert.match(gate, /checkNote && phone === initialPhone/)
  for (const f of ['lib/imageRead.ts', 'app/api/admin/jobs/ai-extract-image/route.ts']) {
    const s = src(f)
    assert.ok(!/\.storage\b|writeFile|createWriteStream/.test(s), `${f} stores nothing`)
    for (const m of s.matchAll(/console\.(?:log|warn|error)\(([^\n]*)/g)) assert.ok(!/mobiles|jpeg|base64|bytes|number\.|phone/.test(m[1]), `${f} logs content: ${m[1]}`)
  }
})

// ─────────────────────────────────── Part B — Insights ──

test('B.1/B.2 default period Today; the date boxes follow the chips; editing a box deselects them', () => {
  const NOW = Date.parse('2026-11-24T10:00:00+05:00')
  assert.deepEqual(resolvePeriod({}, NOW), { key: 'today', from: '2026-11-24', to: '2026-11-24', label: 'Today' })
  assert.deepEqual([resolvePeriod({ period: '30d' }, NOW).from, resolvePeriod({ period: '30d' }, NOW).to], ['2026-10-26', '2026-11-24'])
  assert.equal(resolvePeriod({ period: '7d' }, NOW).from, '2026-11-18')
  const page = src('app/admin/insights/page.tsx')
  assert.match(page, /<PeriodPicker key=\{`\$\{p\.key\}:\$\{p\.from\}:\$\{p\.to\}`\}/, 're-mounted per period, so From/To show the chip\'s dates')
  const picker = src('app/admin/insights/PeriodPicker.tsx')
  assert.match(picker, /const shown: PeriodKey = edited \? 'custom' : active/)
  assert.equal((picker.match(/setEdited\(true\)/g) ?? []).length, 2, 'both boxes')
})

test('B.3 one visitor rule: page visits = the Overview counter; real people only (human signal, not automation)', () => {
  const day = { ...emptyDay('2026-11-24', '2026-11-24T00:00:00Z'), pageVisits: 176, visitors: 75 }
  const p = mergePeriod('2026-11-24', '2026-11-24', [day])
  assert.equal(p.totals.pageVisits, 176)
  assert.equal(p.totals.visitorDays, 75)
  assert.equal(INSIGHTS_DAY_VERSION, 3, 'older stored days are rebuilt')
  assert.match(src('lib/insights.ts'), /from\('site_visit_counts'\)\.select\('count'\)\.eq\('day', day\)\.eq\('kind', 'public_page'\)/, 'the Overview funnel\'s own counter')
  const page = src('app/admin/insights/page.tsx')
  assert.match(page, /Page visits \(signed out\)/)
  assert.match(page, /Unique visitors \(signed out\)/)
  assert.match(src('scripts/check-counts.ts'), /Page visits \(signed out\)/, 'check:counts compares them')
  for (const f of ['components/VisitBeacon.tsx', 'components/search/SearchBeacon.tsx']) assert.match(src(f), /return whenHuman\(/, `${f} waits for a real person`)
  assert.ok(isAutomated({ webdriver: true }) && !isAutomated({ webdriver: false }) && !isAutomated(undefined))
  assert.ok(HUMAN_VISIBLE_MS >= 5000)
  const visit = src('app/api/visit/route.ts')
  assert.ok(visit.indexOf('bumpSiteVisit') < visit.indexOf('recordInsightVisit'), 'one post writes both counters')
})

test('B.4 funnels: each step a subset of the one before; never "−0%" when a number goes up', () => {
  const people = [
    [true, true, true, true, false, false, false],
    [true, false, true, true, true, true, true], // documents without mobile → stops at step 2
    [true, true, false, true, false, false, false], // onboarding without documents → stops at step 3
    [true, true, true, false, true, false, false],
  ]
  const n = cohortFunnel(people, 7)
  assert.deepEqual(n, [4, 3, 2, 1, 0, 0, 0])
  for (let i = 1; i < n.length; i++) assert.ok(n[i] <= n[i - 1])
  const parents = cohortFunnel([[true, false, false, true], [true, true, true, true]], 4)
  assert.deepEqual(parents, [2, 1, 1, 1], 'contacted a tutor only of those who received applications')
  assert.deepEqual(TUTOR_FUNNEL.map((s) => s.key), ['signed_up', 'mobile', 'documents', 'profile', 'approved', 'pay_page', 'paid'], 'the order of the flow')
  assert.equal(PARENT_FUNNEL.length, 4)
  const steps = funnelSteps([{ key: 'a', label: 'A', count: 246 }, { key: 'b', label: 'B', count: 300 }, { key: 'c', label: 'C', count: 300 }, { key: 'd', label: 'D', count: 150 }])
  assert.deepEqual(stepChange(steps[1]), { text: '+54', tone: 'gained' }, 'a rise is never a loss')
  assert.deepEqual(stepChange(steps[2]), { text: 'No drop', tone: 'none' })
  assert.deepEqual(stepChange(steps[3]), { text: '−150 (50%)', tone: 'lost' })
  assert.equal(stepChange(steps[0]), null)
  for (const s of steps) assert.ok(!/−0%/.test(stepChange(s)?.text ?? ''))
  for (const f of ['app/admin/insights/page.tsx', 'app/admin/page.tsx']) assert.match(src(f), /stepChange\(s\)/, f)
  assert.match(src('lib/insights.ts'), /cohortFunnel\(/)
})

test('B.5 devices: Mobile / Tablet / Desktop, and Android / iPhone-iPad / Windows / Mac / Other', () => {
  assert.deepEqual(deviceOf('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36'), { device: 'desktop', os: 'windows' })
  assert.deepEqual(deviceOf('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_1) AppleWebKit/605.1.15 Safari/605.1.15'), { device: 'desktop', os: 'mac' })
  assert.deepEqual(deviceOf('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) Mobile/15E148'), { device: 'tablet', os: 'iphone' })
  assert.deepEqual(deviceOf('Mozilla/5.0 (Linux; Android 14; SM-A145F) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36'), { device: 'mobile', os: 'android' })
  assert.deepEqual(deviceOf('Mozilla/5.0 (X11; Linux x86_64) Firefox/120'), { device: 'desktop', os: 'other' })
  assert.deepEqual(DEVICE_KINDS, ['mobile', 'tablet', 'desktop'])
  assert.deepEqual(OS_KINDS, ['android', 'iphone', 'windows', 'mac', 'other'])
  const mig = src('supabase/migrations/247_pr22_search_words_insights.sql')
  assert.match(mig, /insight_visitor_days_os_check\s+check \(os in \('android', 'iphone', 'windows', 'mac', 'other'\)\)/)
  const page = src('app/admin/insights/page.tsx')
  for (const l of ['Device type', 'System', 'Windows', 'Mac', 'iPhone / iPad']) assert.ok(page.includes(l), l)
  assert.match(src('app/api/visit/route.ts'), /countsAsVisit\(ua\)/, 'bots excluded before anything is counted')
})

// ─────────────────────────────────── Part C — failed vs zero ──

test('C failed searches are "failed", never zero results; Online + a city finds every online tuition on Browse', () => {
  const day = emptyDay('2026-11-22', '2026-11-22T00:00:00Z')
  day.searches = [
    { surface: 'tuitions', city: null, area: null, masterId: null, mode: 'Online Tutor', gender: null, n: 3, zero: 1, failed: 2 },
    { surface: 'tuitions', city: null, area: null, masterId: null, mode: null, gender: null, n: 2, zero: 0, failed: 2 },
  ]
  const p = mergePeriod('2026-11-22', '2026-11-22', [day])
  assert.equal(p.zeroSearches.length, 1, 'a failed-only search is not in the zero list')
  assert.equal(p.zeroSearches[0].zero, 1)
  assert.equal(p.totals.failedSearches, 4)
  const feed = src('lib/jobFeed.ts')
  assert.match(feed, /const \{ data, count, error \} = await q[\s\S]{0,300}failed: true/, 'a failed query says so')
  assert.match(feed, /const online = !!filters\.onlineAnyCity && \(filters\.mode \?\? smartMode\) === ONLINE_JOB_TITLE/)
  assert.match(feed, /if \(filters\.city && !online\)/)
  assert.match(src('app/(site)/browse/tuitions/BrowseTuitionsView.tsx'), /onlineAnyCity: true/)
  assert.match(src('app/api/browse/tuitions/route.ts'), /onlineAnyCity: get\('anyCity'\) === '1'/, 'Load more uses the same rule')
  assert.ok(!/onlineAnyCity/.test(src('components/tuitionJobs/CityJobsView.tsx')), 'city landing pages unchanged')
  const beacon = src('lib/searchBeacon.ts')
  assert.match(beacon, /failed: p\.e === true/)
  assert.match(beacon, /if \(p\.u && p\.e !== true\)/, 'a failed search is not an unmet search')
  assert.match(src('lib/insights.ts'), /zero: !failed && results === 0 \? 1 : 0/)
})

// ─────────────────────────────────── Part D — Search words ──

const DICT: Dict = {
  builtin: false,
  cities: ['Lahore', 'Karachi'],
  levels: [{ slug: 'grade-9', name: 'Grade 9', category: 'School' }],
  subjects: [{ slug: 'mathematics', name: 'Mathematics' }, { slug: 'nazra-quran', name: 'Nazra Quran' }],
  aliases: [],
}

test('D.2 "Means the same as…" is read by the one smart search (subject, city, online)', () => {
  assert.equal(parseQuery('nazra lahore', DICT).subject, null, 'before: not understood')
  const withAliases: Dict = {
    ...DICT,
    aliases: [
      { kind: 'subject', slug: 'nazra-quran', alias: 'nazra' },
      { kind: 'city', slug: 'Lahore', alias: 'lhr' },
      { kind: 'mode', slug: 'Online Tutor', alias: 'zoom class' },
    ],
  }
  const p = parseQuery('nazra lhr', withAliases)
  assert.equal(p.subject?.name, 'Nazra Quran')
  assert.equal(p.city, 'Lahore')
  assert.equal(parseQuery('maths zoom class', withAliases).mode, 'Online Tutor', 'a staff word for online')
  assert.equal(modeAliasWords(withAliases).size, 1)
  assert.equal(modeAliasWords({ aliases: [{ kind: 'mode', slug: 'Not a job type', alias: 'x' }] }).size, 0)
  assert.match(src('lib/smartSearch.ts'), /a\.kind === 'mode'/, 'the server dictionary loads mode words')
  const lib = src('lib/searchTerms.ts')
  assert.match(lib, /from\('taxonomy_aliases'\)\.insert/)
  assert.match(lib, /from\('location_area_aliases'\)[\s\S]{0,120}\.insert/)
  assert.match(lib, /invalidateMemoTag\(SMART_SEARCH_TAG\)/, 'every search bar reads it at once')
  assert.match(lib, /update\(\{ removed_at:/, 'an area alias is stamped removed on Undo, never deleted')
})

test('D.1/D.5 search words: text and counts only — no user identifier; phone / email never kept', () => {
  assert.equal(cleanTerm('  Maths   Lahore '), 'Maths Lahore')
  assert.equal(termKey('MATHS lahore!'), 'maths lahore')
  assert.equal(cleanTerm('tutor 0300 1234567'), null)
  assert.equal(cleanTerm('me@example.com'), null)
  assert.equal(cleanTerm('a'), null)
  const rows = mergeTerms([
    { day: '2026-11-23', surface: 'tutors', term_key: 'nazra', term: 'Nazra', searches: 3, zero: 3, failed: 0, last_at: '2026-11-23T10:00:00Z' },
    { day: '2026-11-24', surface: 'tuitions', term_key: 'nazra', term: 'nazra', searches: 2, zero: 0, failed: 0, last_at: '2026-11-24T10:00:00Z' },
    { day: '2026-11-24', surface: 'tutors', term_key: 'physics', term: 'Physics', searches: 4, zero: 0, failed: 4, last_at: '2026-11-24T09:00:00Z' },
  ])
  assert.deepEqual(rows.map((r) => [r.key, r.searches, r.zero, r.surfaces.length]), [['nazra', 5, 3, 2], ['physics', 4, 0, 1]])
  assert.equal(rows[0].term, 'nazra', 'the latest spelling')
  assert.deepEqual(filterTerms(rows, 'zero').map((r) => r.key), ['nazra'], 'failed is never zero')
  const mig = src('supabase/migrations/247_pr22_search_words_insights.sql')
  const table = mig.slice(mig.indexOf('create table if not exists public.search_terms'), mig.indexOf('create index if not exists search_terms_key_idx'))
  assert.ok(!/user|session|visitor|ip\b|device/i.test(table.replace(/--.*$/gm, '')), 'no identifier column')
  assert.match(mig, /revoke all on public\.search_terms from anon, authenticated/)
  assert.match(src('lib/searchBeacon.ts'), /bumpSearchTerm\(p\.s, p\.w,/)
})

test('D.3 "Real demand" → the Overview to-do "Wanted: <term> (N searches)", linking to the term', () => {
  assert.equal(wantedLine('Physics Sahiwal', 14), 'Wanted: Physics Sahiwal (14 searches)')
  assert.equal(wantedLine('Nazra', 1), 'Wanted: Nazra (1 search)')
  assert.equal(termHref('physics sahiwal'), '/admin/search-words?term=physics%20sahiwal')
  assert.equal(OVERVIEW_ITEMS['todo-wanted'].screen, 'searchWords')
  assert.match(src('app/admin/page.tsx'), /'todo-wanted',/)
  assert.match(src('lib/overviewItems.ts'), /case 'todo-wanted'[\s\S]{0,400}wantedLine\(w\.term, w\.searches\)[\s\S]{0,80}href: termHref\(w\.key\)/)
})

test('D.4 suggested pages: 10+ searches a month AND an indexable page — suggestion only', () => {
  const combo = (kind: 'tutors' | 'tuitions', count: number, verified = count): ComboLike => ({ kind, city: 'Lahore', citySlug: 'lahore', subjectSlug: 'o-levels-physics', subjectName: 'O Levels Physics', subjectOnly: 'Physics', count, verified })
  const indexable = (c: ComboLike) => (c.kind === 'tutors' ? (c.verified ?? 0) >= 3 : c.count >= 3)
  assert.equal(SUGGEST_MIN_SEARCHES, 10)
  assert.equal(suggestPages([{ city: 'Lahore', subject: 'Physics', searches: 9 }], [combo('tutors', 5)], indexable).length, 0, '9 searches: not yet')
  const s = suggestPages([{ city: 'Lahore', subject: 'Physics', searches: 6 }, { city: 'lahore', subject: 'physics', searches: 4 }], [combo('tutors', 5), combo('tuitions', 2)], indexable)
  assert.equal(s.length, 1, 'the tuitions page has too little to be indexable')
  assert.deepEqual([s[0].searches, s[0].page.kind], [10, 'tutors'])
  assert.equal(suggestPages([{ city: 'Lahore', subject: 'Physics', searches: 20 }], [combo('tutors', 5, 2)], indexable).length, 0, 'unverified supply is not enough')
  const page = src('app/admin/search-words/page.tsx')
  assert.match(page, /A suggestion only/)
  assert.ok(!/insert|upsert/.test(src('lib/searchTermsCore.ts')))
})

test('D access: Owner, Project Managers and the Insights grant act; Backend Support reads; route refuses others', () => {
  assert.deepEqual(SCREEN_ACCESS.searchWords, ['partner', 'backend_support'])
  const route = src('app/api/admin/search-words/route.ts')
  assert.match(route, /checkAdminRole\(\.\.\.SCREEN_ACCESS\.searchWords\)/)
  assert.ok(route.indexOf('mayEditSearchWords') < route.indexOf('parseBody'), 'the edit right is checked first')
  assert.match(src('lib/staffAllRows.ts'), /export async function mayEditSearchWords[\s\S]{0,120}seesInsights\(actor\)/)
  assert.match(src('lib/adminNav.ts'), /href: '\/admin\/search-words', label: 'Search words', icon: 'search', screen: 'searchWords'/)
  const lib = src('lib/searchTerms.ts')
  for (const a of ['search_words.alias', 'search_words.demand', 'search_words.alias_undo', 'search_words.demand_undo']) assert.ok(lib.includes(a) || lib.includes(a.replace(/_undo$/, '')), a)
  assert.match(src('lib/timelineLabelsCore.ts'), /'search_words\.demand_undo'/)
})

test('CLAUDE.md carries the new image rule', () => {
  assert.ok(src('CLAUDE.md').includes('The AI may read phone numbers printed on public poster/screenshot images in Read from image; never in pasted text or anywhere else.'))
})

async function main() {
  for (const t of tests) {
    try {
      await t.fn()
      console.log(`✓ ${t.name}`)
    } catch (e) {
      failures++
      console.error(`✗ ${t.name}\n  ${e instanceof Error ? e.message : e}`)
    }
  }
  console.log(failures === 0 ? `\nAll ${tests.length} PR-22 checks passed.` : `\n${failures} of ${tests.length} failed.`)
  process.exit(failures === 0 ? 0 : 1)
}
main()
