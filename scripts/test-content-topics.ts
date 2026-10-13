// npm run test:contenttopics — the "Start from a suggested title" queue rules
// (owner, 13 Oct 2026): grouping, clean names, already-covered, the mix.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  careerShare,
  chooseQueue,
  cityGuideCandidate,
  coveredByPost,
  groupTopics,
  hasRawLabel,
  levelGroup,
  subjectTitleName,
  topicCandidate,
  topicName,
  urduCandidates,
  type TopicSignal,
} from '../lib/contentQueue/topics'
import { careerCandidates } from '../lib/contentQueue/careerTopics'
import type { Candidate } from '../lib/contentQueue/core'

test('grades are grouped into the ranges people say', () => {
  for (const l of ['Pre Nursery / Play Group / KG I', 'Nursery / KG II', 'Prep / KG III']) assert.equal(levelGroup(l).label, 'Play Group and KG', l)
  for (const l of ['Grade 1', 'Grade 4', 'Grade 5']) assert.equal(levelGroup(l).label, 'Primary', l)
  for (const l of ['Grade 6', 'Grade 8']) assert.equal(levelGroup(l).label, 'Middle', l)
  for (const l of ['Grade 9 - Science', 'Grade 10 - Arts']) assert.equal(levelGroup(l).label, 'Matric', l)
  assert.equal(levelGroup('FSC ( Part I & Part II)').label, 'FSc')
  assert.equal(levelGroup('FA ( Part I & Part II)').label, 'FA')
  assert.equal(levelGroup('ICS ( Part I & Part II)').label, 'ICS')
  assert.equal(levelGroup('I Com ( Part I & Part II)').label, 'I.Com')
  assert.equal(levelGroup('O Levels').label, 'O Level')
  assert.equal(levelGroup('AS & A Levels').label, 'A Level')
  assert.equal(levelGroup('IGCSE Core').label, 'IGCSE')
  assert.equal(levelGroup('Semester 1 - 8').label, 'BS')
  // A staff title name wins.
  assert.equal(levelGroup('Semester 1 - 8', 'University').label, 'University')
})

test('titles use clean names: no slashes, brackets or codes', () => {
  assert.equal(topicName(levelGroup('FA ( Part I & Part II)'), subjectTitleName('Mathematics')), 'FA Maths')
  assert.equal(topicName(levelGroup('Semester 1 - 8'), subjectTitleName('Computer Science')), 'BS Computer Science')
  assert.equal(topicName(levelGroup('Pre Nursery / Play Group / KG I'), subjectTitleName('English')), 'Play Group and KG English')
  assert.equal(subjectTitleName('Islamiyat / Islamic Studies'), 'Islamiat')
  assert.equal(subjectTitleName('Mathematics', 'Math'), 'Math')
  assert.equal(hasRawLabel('FA ( Part I & Part II) Mathematics tutors in Lahore'), true)
  assert.equal(hasRawLabel('Semester 1 - 8 Computer Science tutors in Lahore'), true)
  assert.equal(hasRawLabel('Pre Nursery / Play Group / KG I English tutors in Lahore'), true)
})

const sig = (level: string, subject: string, city: string, searches = 0, tutors = 5): TopicSignal => ({ level, subject, city, searches, tutors })

test('one topic per subject group and city — never one per grade, never two per pair', () => {
  const topics = groupTopics([
    sig('Pre Nursery / Play Group / KG I', 'English', 'Lahore', 2),
    sig('Nursery / KG II', 'English', 'Lahore', 1),
    sig('Prep / KG III', 'English', 'Lahore'),
    sig('Grade 4', 'English', 'Lahore', 3),
    sig('Grade 5', 'English', 'Lahore'),
    sig('Grade 4', 'English', 'Karachi'),
  ])
  assert.equal(topics.length, 3)
  const kg = topics.find((t) => t.group.key === 'kg' && t.city === 'Lahore')!
  assert.equal(kg.searches, 3, 'searches add up across the grades of a group')
  const titles = topics.map((t) => topicCandidate(t))
  assert.equal(new Set(titles.map((c) => c.fingerprint)).size, 3)
  for (const c of titles) assert.equal(hasRawLabel(c.title), false, c.title)
  // The same topic always gets the same title (a stable fingerprint and wording).
  assert.equal(topicCandidate(kg).title, topicCandidate(kg).title)
})

test('real search demand ranks first; listed tutors only break a tie', () => {
  const [searched, listed, busier] = groupTopics([
    sig('Grade 4', 'Mathematics', 'Karachi', 2, 3),
    sig('Grade 4', 'English', 'Karachi', 0, 80),
    sig('Grade 4', 'Urdu', 'Karachi', 0, 90),
  ]).map(topicCandidate)
  const p = (c: Candidate) => c.components.demand * c.components.rankProximity
  assert.ok(p(searched) > p(listed), 'two searches beat eighty listed tutors')
  assert.ok(p(busier) > p(listed), 'more tutors breaks the tie')
})

test('a topic an existing post already covers is not suggested (published, scheduled or draft)', () => {
  const posts = [
    { title: 'How to become a home tutor in Pakistan: a step-by-step start', status: 'published', cluster: 'tutor-career' },
    { title: 'How to write a tutor profile that parents in Pakistan trust', status: 'draft', cluster: 'tutor-career' },
    { title: 'Grade 9 & 10 - Science English tutors in Lahore: fees and how to choose', status: 'scheduled', cluster: 'cost-hiring', city: 'Lahore', subject: 'Matric English' },
  ]
  const career = careerCandidates()
  const become = career.find((c) => c.title === 'How to become a home tutor in Pakistan: a step-by-step start')
  assert.ok(become, 'the career list still has the published title')
  assert.ok(coveredByPost(become!, posts), 'a published post')
  assert.ok(coveredByPost({ title: 'Writing a tutor profile that parents actually read', cluster: 'tutor-career' }, posts), 'a near-duplicate of a draft')
  // The same subject group in the same city, whatever the wording.
  const topic = topicCandidate(groupTopics([sig('Grade 9 - Science', 'English', 'Lahore', 4)])[0])
  assert.ok(coveredByPost(topic, posts), 'the same subject and city')
  // A different city or subject is a different topic.
  assert.equal(coveredByPost(topicCandidate(groupTopics([sig('Grade 9 - Science', 'English', 'Karachi', 4)])[0]), posts), null)
  assert.equal(coveredByPost(topicCandidate(groupTopics([sig('Grade 9 - Science', 'Physics', 'Lahore', 4)])[0]), posts), null)
  // Different topics that share only everyday words are not "covered".
  assert.equal(coveredByPost({ title: 'How to become an online tutor in Pakistan', cluster: 'tutor-career' }, [{ title: 'How to become a school teacher in Lahore', status: 'published' }]), null)
  // An unpublished post covers nothing.
  assert.equal(coveredByPost(become!, [{ ...posts[0], status: 'unpublished' }]), null)
})

test('the visible queue: 30 topics, tutor career at most 40%, cities spread, City guides and Urdu kept', () => {
  const cities = ['Lahore', 'Karachi', 'Islamabad', 'Rawalpindi']
  const subjects = ['Mathematics', 'English', 'Physics', 'Chemistry', 'Biology', 'Urdu', 'Computer Science']
  const signals: TopicSignal[] = []
  // Lahore has far more demand than the others.
  for (const s of subjects) for (const l of ['Grade 4', 'Grade 7', 'Grade 9 - Science']) signals.push(sig(l, s, 'Lahore', 20))
  for (const c of cities.slice(1)) for (const s of subjects.slice(0, 3)) signals.push(sig('Grade 4', s, c, 2))
  const all: Candidate[] = [
    ...groupTopics(signals).map(topicCandidate),
    ...careerCandidates(),
    ...cities.map((c) => cityGuideCandidate(c, 50, 10)),
    ...urduCandidates(),
  ]
  const q = chooseQueue(all, { size: 30, emptyClusters: ['city-guides', 'urdu'] })
  assert.equal(q.length, 30, 'refilled to 30')
  assert.ok(careerShare(q) <= 0.4, `career ${careerShare(q)}`)
  assert.equal(q.filter((c) => c.cluster === 'tutor-career').length, 12)
  assert.ok(q.some((c) => c.cluster === 'city-guides'), 'a City guides topic')
  assert.ok(q.some((c) => c.cluster === 'urdu' && c.language === 'ur'), 'an Urdu topic')
  const cityCount = (c: string) => q.filter((x) => String(x.evidenceKey.city ?? '') === c && x.cluster !== 'city-guides').length
  for (const c of cities.slice(1)) assert.ok(cityCount(c) >= 3, `${c} has its topics (${cityCount(c)})`)
  assert.ok(cityCount('Lahore') < 12, 'Lahore does not fill the queue')
  assert.equal(new Set(q.map((c) => c.fingerprint)).size, q.length)
  for (const c of q) assert.equal(hasRawLabel(c.title), false, c.title)
})

test('career never passes 40% even when there is little else', () => {
  const few = [...groupTopics([sig('Grade 4', 'Mathematics', 'Lahore', 3), sig('Grade 4', 'English', 'Karachi', 3), sig('Grade 7', 'Physics', 'Lahore', 3)]).map(topicCandidate), ...careerCandidates()]
  const q = chooseQueue(few, { size: 30 })
  assert.ok(careerShare(q) <= 0.4, String(careerShare(q)))
  assert.equal(q.filter((c) => c.cluster !== 'tutor-career').length, 3)
})

test('the rebuild dismisses instead of deleting, and says why', () => {
  const src = readFileSync('lib/contentQueue/build.ts', 'utf8')
  assert.ok(!src.includes("from('content_suggestions').delete()"), 'no row is deleted')
  assert.ok(src.includes('already covered') && src.includes("status: 'dismissed'"))
  assert.ok(src.includes('chooseQueue(open'))
})
