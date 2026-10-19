/**
 * scripts/test-tidy-card.ts — npm run test:tidycard
 * Tidy tutor cards, one name per subject, no "Pay later" (owner, 17 Oct 2026).
 * Pure rules plus source scans; no browser, no database.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { cardSummary, CARD_MAX_ROLES, CARD_MAX_SUBJECTS } from '../lib/tutorCardCore'
import { dedupeSubjects, subjectDisplayName, notMasterSubjects, NOT_A_MASTER_SUBJECT } from '../lib/subjectDisplay'

const read = (p: string) => readFileSync(p, 'utf8')

const ROLES_15 = [
  'Home Tutor', 'Online Tutor', 'Early Years Teacher', 'Middle School Teacher', 'High School Teacher',
  'A Levels Teacher', 'O Levels Teacher', 'College Lecturer', 'Visiting Teacher', 'Vice Principal',
  'Principal', 'Co-ordinator / Section Head', 'Admission In-charge', 'Admin', 'Primary Teacher',
]
const base = {
  job_types: ROLES_15,
  subject_labels: null,
  city: 'Faisalabad',
  cities: null,
  experience_years: 3,
  hourly_rate_pkr: null,
  fee_min_pkr: 8000,
  fee_max_pkr: 15000,
}

test('the card shows at most 2 roles, then "+N"', () => {
  const s = cardSummary({ ...base, subject_links: [] })
  assert.equal(CARD_MAX_ROLES, 2)
  assert.deepEqual(s.roles, ['Home Tutor', 'Online Tutor'])
  assert.equal(s.rolesExtra, 13)
  assert.equal(cardSummary({ ...base, job_types: ['Home Tutor'] }).rolesExtra, 0)
  assert.equal(cardSummary({ ...base, job_types: null }).roles.length, 0)
})

test('the card shows at most 4 subjects, each once, then "+N more"', () => {
  const labels = [
    'English', 'Islamic Studies', 'Islamiyat / Islamic Studies', 'Islamiat / Islamic Studies', 'Physics',
    'Translation of Quran', 'Translation of the Holy Quran', 'Chemistry', 'Biology', 'Urdu',
  ]
  const s = cardSummary({ ...base, subject_links: labels.map((label, i) => ({ label, masterId: i + 1, href: `/x/${i}` })) })
  assert.equal(CARD_MAX_SUBJECTS, 4)
  // 10 labels → 7 distinct subjects → 4 shown + 3 more.
  assert.deepEqual(s.subjects.map((x) => x.label), ['English', 'Islamiat / Islamic Studies', 'Physics', 'Translation of the Holy Quran'])
  assert.equal(s.subjectsExtra, 3)
  // Links survive the merge (the first entry's id and link).
  assert.equal(s.subjects[1].masterId, 2)
  assert.equal(s.subjects[1].href, '/x/1')
  assert.equal(cardSummary({ ...base, subject_links: [{ label: 'Maths', masterId: 9 }] }).subjectsExtra, 0)
})

test('one info line: city · experience · fee as the tutor set it', () => {
  const s = cardSummary({ ...base, subject_links: [] })
  assert.equal(s.city, 'Faisalabad')
  assert.equal(s.experience, '3–5 years')
  assert.equal(s.fee, 'Rs 8,000 – 15,000/month')
  assert.equal(cardSummary({ ...base, fee_min_pkr: null, fee_max_pkr: null }).fee, null)
  assert.equal(cardSummary({ ...base, cities: ['Lahore', 'Karachi'] }).city, 'Lahore')
})

test('subject de-duplication: the agreed merges, nothing else', () => {
  for (const n of ['Islamiat / Islamic Studies', 'Islamic Studies', 'Islamiyat', 'Islamiyat / Islamic Studies']) {
    assert.equal(subjectDisplayName(n), 'Islamiat / Islamic Studies')
  }
  for (const n of ['Translation of the Holy Quran', 'Translation of Quran']) {
    assert.equal(subjectDisplayName(n), 'Translation of the Holy Quran')
  }
  assert.deepEqual(dedupeSubjects(['Islamic Studies', 'Islamiyat', 'English', 'english ']), ['Islamiat / Islamic Studies', 'English'])
  // Different subjects stay apart.
  assert.deepEqual(dedupeSubjects(['English', 'English Literature', 'Urdu', 'Urdu Literature']).length, 4)
})

test('a non-master subject is refused on profile save (and by staff edits)', () => {
  assert.deepEqual(notMasterSubjects([1, 2, 3], [1, 2, 3]), [])
  assert.deepEqual(notMasterSubjects([1, 99999], [1, 2]), [99999])
  const save = read('app/api/profile/save/route.ts')
  const check = save.indexOf('unknownNewMasterIds(supabase, ids, savedIds)')
  const firstWrite = save.indexOf(".from('tutor_subjects').delete()")
  assert.ok(check > 0 && firstWrite > check, 'checked before the subject set is replaced')
  assert.ok(save.indexOf('unknownNewMasterIds(supabase, ids, savedIds)') < save.indexOf('.update('), 'checked before any write')
  assert.match(save, /error: NOT_A_MASTER_SUBJECT \}, \{ status: 400 \}/)
  assert.match(read('app/api/admin/tutors/edit/route.ts'), /unknownNewMasterIds\(admin, ids, oldIds\)/)
  assert.match(NOT_A_MASTER_SUBJECT, /subject list/)
})

test('school names are not shown as subjects (card and profile)', () => {
  assert.match(read('lib/browseTutors.ts'), /schoolCats\.has\(m\.category_slug/)
  assert.match(read('app/(site)/tutor/[slug]/page.tsx'), /if \(s\.subject && !s\.school\)/)
})

test('the 4 card buttons are unchanged: labels, colours, actions, order', () => {
  const card = read('components/TutorCard.tsx')
  assert.match(card, /key: 'message',\s*label: 'Message',/)
  assert.match(card, /className: 'bg-tm-navy text-white hover:bg-tm-navy-hover',\s*onClick: onMessage/)
  assert.match(card, /label: viewer\.role === 'parent' \? 'Demo lesson' : 'Demo'/)
  assert.match(card, /className: 'bg-tm-red text-white hover:bg-tm-red-hover',\s*onClick: requestDemo/)
  assert.match(card, /label: saved \? 'Shortlisted' : 'Shortlist'/)
  assert.match(card, /key: 'profile',\s*label: 'View Profile',[\s\S]*?href: profileHref/)
  assert.match(card, /const profileHref = tutor\.slug \? `\/tutor\/\$\{tutor\.slug\}` : '#'/)
  for (const api of ["'/api/messages/thread'", "'/api/demo/request'", "'/api/shortlist'"]) assert.ok(card.includes(api), api)
  const m = card.indexOf("key: 'message'"), d = card.indexOf("key: 'demo'"), s = card.indexOf("key: 'shortlist'"), v = card.indexOf('                  viewProfile,')
  assert.ok(m < d && d < s && s < v, 'order: Message, Demo, Shortlist, View Profile')
})

test('the card has no areas, no big roles pill, and fixed-height rows', () => {
  const card = read('components/TutorCard.tsx')
  assert.doesNotMatch(card, /JobTypesChip|distinctAreaLabels|label="Experience"/)
  assert.match(card, /cardSummary\(tutor\)/)
  assert.match(card, /<span className="truncate">\{tutor\.full_name\}<\/span>/)
  assert.match(card, /line-clamp-2 min-h-\[2lh\]/)
  // The profile page keeps the full roles chip.
  assert.match(read('app/(site)/tutor/[slug]/page.tsx'), /<JobTypesChip types=\{tutor\.job_types\}/)
})

test('"Pay later" is absent on /pay/choose; Back stays', () => {
  const page = read('app/(site)/pay/choose/page.tsx')
  assert.match(page, /<OrderPageNav dashboard=\{dashboard\} payLater=\{false\} \/>/)
  assert.doesNotMatch(page, /payLater=\{settings/)
  assert.doesNotMatch(read('app/(site)/pay/choose/PayChoice.tsx'), /Pay later/)
  const nav = read('app/(site)/pay/manual/[ref]/OrderPageNav.tsx')
  assert.match(nav, /\{payLater && \(/)
  assert.ok(nav.includes('Back') && nav.includes('flex-1'), 'Back is full width when alone')
})
