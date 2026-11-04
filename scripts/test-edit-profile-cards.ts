/**
 * scripts/test-edit-profile-cards.ts — part of npm run test:editprofile
 *
 * Hotfix (owner, 4 Nov 2026): every card on the tutor's Edit Profile page must be
 * editable and savable at any time, approval or not — except Mobile, CNIC and
 * Email, which stay locked. Experience was a read-only line with no Save.
 *
 * Without a browser DOM in this repo, each card is "opened" by rendering its
 * card and editor as a tutor would see them (invented data only), and "saved"
 * by running the page's own save call for that card against a stubbed fetch,
 * then checking the server would accept every column it writes (the route's
 * allowlist, and the database's member locks). Nothing touches a database.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import ExperienceEditor from '../components/tutor/ExperienceEditor'
import TaglineAboutEditor from '../components/tutor/TaglineAboutEditor'
import ChangePasswordCard from '../components/account/ChangePasswordCard'
import HidePhotoToggle from '../components/tutor/HidePhotoToggle'
import TimeSlotGrid from '../components/forms/TimeSlotGrid'
import CredentialEditor from '../components/tutor/CredentialEditor'
import { StatusCard } from '../components/tutor/SettingsPieces'
import {
  EXPERIENCE_CHOICES,
  experienceAnswered,
  experienceSummary,
} from '../lib/experienceEditCore'
import {
  postProfileSave,
  experienceSavePayload,
  jobTypesPayload,
  feePayload,
  subjectsPayload,
  locationPayload,
} from '../lib/editProfileSave'
import { PROFILE_FIELDS, TUTOR_FIELDS } from '../lib/profileSaveFields'

const src = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n')
const PAGE = 'app/(site)/tutor/dashboard/settings/page.tsx'
const page = src(PAGE)

// ------------------------------------------------------------ the cards --
// Every card on the page, and what makes it editable. The three locked ones
// have no editor once their value is verified / approved / set.
const LOCKED = ['mobile', 'cnic', 'email'] as const
const EDITORS: Record<string, RegExp> = {
  profilePic: /<FileUpload[\s\S]*onFile=\{handleProfileImageChange\}[\s\S]*<HidePhotoToggle/,
  selfie: /<LiveSelfieCapture[\s\S]*onCapture=/,
  subjects: /<SubjectLevelEditor[\s\S]*<SaveBar onSave=\{saveSubjects\}/,
  location: /<TutorCitiesEditor[\s\S]*<SaveBar onSave=\{saveLocation\}/,
  about: /<TaglineAboutEditor/,
  jobType: /<SaveBar onSave=\{saveJobTypes\}/,
  availability: /<TimeSlotGrid[\s\S]*<SaveBar onSave=\{saveAvailability\}/,
  degrees: /<CredentialEditor[\s\S]*<SaveBar onSave=\{saveDegrees\}/,
  certifications: /<CredentialEditor[\s\S]*<SaveBar onSave=\{saveCertifications\}/,
  experience: /<ExperienceEditor[\s\S]*onSave=\{\(y\) => postProfileSave\(experienceSavePayload\(y\)\)\}/,
  monthlyFee: /<SaveBar onSave=\{saveFee\}/,
  details: /<SaveBar onSave=\{saveDetails\}/,
  password: /<ChangePasswordCard \/>/,
  pause: /<PauseAccountCard \/>/,
  delete: /<DeleteAccountCard \/>/,
}

function cardBlocks(): Map<string, string> {
  const out = new Map<string, string>()
  const re = /\n\s{6}key: '([a-zA-Z]+)',/g
  const hits = [...page.matchAll(re)]
  for (let i = 0; i < hits.length; i++) {
    const start = hits[i].index!
    const next = hits[i + 1]?.index ?? page.indexOf('const step1Done')
    const end = Math.min(next, page.indexOf('\n  ];', start) === -1 ? next : page.indexOf('\n  ];', start) < next ? page.indexOf('\n  ];', start) : next)
    out.set(hits[i][1], page.slice(start, end))
  }
  return out
}

test('the page has exactly the expected cards', () => {
  const keys = [...cardBlocks().keys()].sort()
  assert.deepEqual(keys, [...LOCKED, ...Object.keys(EDITORS)].sort())
})

test('only Mobile, CNIC and Email can lock; every other card has an editor and a save', () => {
  for (const [key, block] of cardBlocks()) {
    const locked = (LOCKED as readonly string[]).includes(key)
    assert.equal(/\n\s+locked:/.test(block), locked, `${key}: locked flag`)
    assert.doesNotMatch(block, /approvedLock:\s*true/, `${key}: no approved lock`)
    if (!locked) assert.match(block, EDITORS[key], `${key}: no editor or save`)
  }
  assert.doesNotMatch(page, /ReadonlyLine/, 'no read-only status line is left')
})

test('every collapsible card can be opened with Edit', () => {
  for (const [key, block] of cardBlocks()) {
    if (!/collapsible: true/.test(block)) continue
    assert.match(block, /summary:/, `${key}: summary`)
    const html = renderToStaticMarkup(
      createElement(StatusCard, { cardKey: key, status: 'completed', summary: 'Invented value', open: false, onEdit: () => {}, children: null }),
    )
    assert.match(html, />Edit</, `${key}: Edit button`)
    assert.doesNotMatch(html, /contact our support/i, `${key}: not locked`)
  }
  // Experience is now one of them.
  assert.match(cardBlocks().get('experience')!, /collapsible: true/)
})

// --------------------------------------------------------- experience --
test('Experience offers the onboarding choices and saves a change', async () => {
  assert.deepEqual(EXPERIENCE_CHOICES.map((c) => c.label), ['New to teaching', '1–3 years', '3–5 years', '5–10 years', '10+ years'])
  const html = renderToStaticMarkup(createElement(ExperienceEditor, { initialYears: 5, onSave: async () => {} }))
  for (const c of EXPERIENCE_CHOICES) assert.ok(html.includes(`>${c.label}<`), c.label)
  assert.match(html, /aria-pressed="true"[^>]*>5–10 years</)
  assert.ok(html.includes('> Save</button>'), 'Save button')
  // The Save button's own opening tag.
  const saveTag = (h: string) => h.slice(h.lastIndexOf('<button', h.indexOf('> Save</button>'))).split('>')[0]
  assert.doesNotMatch(saveTag(html), /\sdisabled=""/, 'Save is usable with a value')
  const empty = renderToStaticMarkup(createElement(ExperienceEditor, { initialYears: null, onSave: async () => {} }))
  assert.match(saveTag(empty), /disabled=""/, 'Save waits until a choice is made')
  assert.equal(experienceSummary(5), '5–10 years')
  assert.equal(experienceSummary(0), 'New to teaching')
  assert.equal(experienceAnswered(0), true)
  assert.equal(experienceAnswered(null), false)
  assert.throws(() => experienceSavePayload(7), /Choose your years of experience/)
})

// --------------------------------------------- saving through the route --
type Sent = { url: string; body: Record<string, unknown> }
function stub(status = 200, reply: unknown = { success: true }) {
  const sent: Sent[] = []
  const fetchImpl = async (url: string, init?: RequestInit) => {
    sent.push({ url, body: JSON.parse(String(init?.body)) })
    assert.equal(init?.method, 'POST')
    return new Response(JSON.stringify(reply), { status })
  }
  return { sent, fetchImpl }
}

function assertWritable(body: Record<string, unknown>, card: string) {
  for (const k of Object.keys((body.tutorProfile as object) ?? {})) assert.ok(TUTOR_FIELDS.has(k), `${card}: tutor_profiles.${k} not writable`)
  for (const k of Object.keys((body.profile as object) ?? {})) assert.ok(k === 'city' || PROFILE_FIELDS.has(k), `${card}: profiles.${k} not writable`)
}

test('each route-saved card sends a change the server accepts', async () => {
  const cards: [string, Record<string, unknown>][] = [
    ['experience', experienceSavePayload(3)],
    ['jobType', jobTypesPayload(['Home Tutor', 'Online Tutor'])],
    ['monthlyFee', feePayload(8000, 15000)],
    ['subjects', subjectsPayload([101, 202])],
    ['location', locationPayload('Lahore', { Lahore: ['Johar Town'] })],
  ]
  for (const [card, payload] of cards) {
    const s = stub()
    await postProfileSave(payload, s.fetchImpl)
    assert.equal(s.sent.length, 1, card)
    assert.equal(s.sent[0].url, '/api/profile/save')
    assert.deepEqual(s.sent[0].body, payload)
    assertWritable(payload, card)
  }
  // A refusal shows the server's own words.
  const bad = stub(400, { error: 'Invented refusal.' })
  await assert.rejects(postProfileSave(experienceSavePayload(1), bad.fetchImpl), /Invented refusal\./)
  // Every save rebuilds the cached public profile.
  const route = src('app/api/profile/save/route.ts')
  assert.match(route, /event: 'profile_updated'/)
  assert.match(src('lib/activityLog.ts'), /revalidateTutorProfile\(params\.userId\)/)
})

test('the cards that write directly are not refused by the database member locks', () => {
  // The latest member locks (migration 222): profiles guards only the verified
  // mobile and the approved CNIC number; tutor_profiles guards nothing.
  const m = src('supabase/migrations/222_member_edit_rules.sql')
  const prof = m.slice(m.indexOf('function public.lock_profile_fields'), m.indexOf('function public.lock_tutor_profile_fields'))
  const guarded = [...prof.matchAll(/NEW\.([a-z_]+) IS DISTINCT FROM/g)].map((x) => x[1]).sort()
  assert.deepEqual(guarded, ['cnic_number', 'phone_number'])
  const tut = m.slice(m.indexOf('function public.lock_tutor_profile_fields'), m.indexOf('-- 3 —'))
  assert.doesNotMatch(tut, /raise exception/i)
  for (const fn of ['saveDetails', 'saveAvailability', 'saveDegrees', 'saveCertifications', 'saveShowAvatar']) {
    const at = page.indexOf(`const ${fn} =`)
    assert.ok(at > 0, fn)
    const body = page.slice(at, page.indexOf('\n  };', at) > 0 ? page.indexOf('\n  const ', at + 10) : at + 600)
    for (const col of guarded) assert.doesNotMatch(body, new RegExp(`\\b${col}\\b`), `${fn} writes ${col}`)
  }
})

// --------------------------------------- the other editors, as a tutor --
test('the other self-contained editors open with a usable save', () => {
  const noop = () => {}
  const about = renderToStaticMarkup(createElement(TaglineAboutEditor, { initialHeadline: 'Invented headline', initialBio: 'Invented about text.', onSaved: noop }))
  assert.match(about, /Invented headline/)
  assert.match(about, /Save/)
  assert.match(renderToStaticMarkup(createElement(ChangePasswordCard)), /type="password"/)
  assert.doesNotMatch(renderToStaticMarkup(createElement(HidePhotoToggle, { hidden: false, onChange: noop })), /disabled=""/)
  assert.doesNotMatch(renderToStaticMarkup(createElement(TimeSlotGrid, { value: [], onChange: noop })), /disabled=""/)
  const cred = renderToStaticMarkup(
    createElement(CredentialEditor, {
      items: [], onChange: noop, uploadFile: async () => null as never, noun: 'degree',
      titlePlaceholder: 'Degree', field2Key: 'institute', field2Placeholder: 'Institute', addLabel: 'Add degree',
    }),
  )
  assert.match(cred, /Add degree/)
})
