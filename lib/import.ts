// lib/import.ts
//
// Bulk tutor import: parsing, validation, and the creation of an imported
// profile.
//
// THE RULE THAT SHAPES THIS FILE: the whole file is validated before anything
// is written. A half-applied import is the worst outcome available here --
// twenty auth accounts created, an error on row twenty-one, and no way to tell
// which of the twenty are real without reading the database by hand. So
// validate() touches nothing, returns a per-row verdict for every row, and the
// caller writes only the rows that passed.
//
// Subjects and levels resolve against taxonomy_master. CLAUDE.md forbids
// free-text subjects anywhere, and a spreadsheet is exactly where they would
// otherwise creep in: "O Level Physics" typed by an admin has to become the
// same master_id a tutor would have picked from the cascade, or it matches
// nothing and the imported tutor is invisible to the search that should find
// them.

import { createAdminClient } from '@/lib/supabase/admin'
import { normalisePkMobile, syntheticEmail } from '@/lib/phone'
import { logActivity } from '@/lib/activityLog'

export const TEMPLATE_HEADERS = [
  'name',
  'mobile',
  'whatsapp',
  'city',
  'area',
  'gender',
  'subjects',
  'levels',
  'experience_years',
  'expected_fee',
] as const

export type ImportRow = {
  /** 1-based, matching what the admin sees in their spreadsheet. */
  line: number
  name: string
  mobile: string
  whatsapp: string
  city: string
  area: string
  gender: string
  subjects: string
  levels: string
  experienceYears: string
  expectedFee: string
}

export type RowVerdict = {
  line: number
  name: string
  mobile: string
  ok: boolean
  errors: string[]
  /** Present only when ok. */
  msisdn?: string
  masterIds?: number[]
}

/**
 * The downloadable template. Ships with one filled example row, because a
 * header-only CSV leaves people guessing how to write a subject list.
 */
export function templateCsv(): string {
  return [
    TEMPLATE_HEADERS.join(','),
    'Ali Raza,0300 1234567,0300 1234567,Lahore,DHA,male,"Physics; Mathematics","O Levels",5,15000',
  ].join('\n')
}

/** RFC-ish CSV: handles quoted fields containing commas and doubled quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false

  const src = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n')

  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"'
          i++
        } else quoted = false
      } else field += c
    } else if (c === '"') quoted = true
    else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else field += c
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field)
    rows.push(row)
  }

  return rows.filter((r) => r.some((c) => c.trim().length > 0))
}

export function rowsFromCsv(text: string): { rows: ImportRow[]; error?: string } {
  const table = parseCsv(text)
  if (table.length === 0) return { rows: [], error: 'That file is empty.' }

  const header = table[0].map((h) => h.trim().toLowerCase())
  const missing = TEMPLATE_HEADERS.filter((h) => !header.includes(h))
  if (missing.length > 0) {
    return { rows: [], error: `The file is missing these columns: ${missing.join(', ')}.` }
  }

  const at = (cols: string[], name: string) => (cols[header.indexOf(name)] ?? '').trim()

  const rows = table.slice(1).map((cols, i) => ({
    line: i + 2, // +2: one for the header, one because spreadsheets start at 1
    name: at(cols, 'name'),
    mobile: at(cols, 'mobile'),
    whatsapp: at(cols, 'whatsapp'),
    city: at(cols, 'city'),
    area: at(cols, 'area'),
    gender: at(cols, 'gender').toLowerCase(),
    subjects: at(cols, 'subjects'),
    levels: at(cols, 'levels'),
    experienceYears: at(cols, 'experience_years'),
    expectedFee: at(cols, 'expected_fee'),
  }))

  return { rows }
}

const splitList = (v: string) =>
  v
    .split(/[;|]/)
    .map((s) => s.trim())
    .filter(Boolean)

/**
 * Validate every row against the file itself and against the database.
 * Writes nothing.
 */
export async function validateRows(rows: ImportRow[]): Promise<RowVerdict[]> {
  const admin = createAdminClient()

  // One lookup for the whole file rather than per row.
  //
  // taxonomy_master stores SLUGS, not names, so the admin's "Physics" has to
  // be resolved through taxonomy_subjects and taxonomy_levels. Loading all
  // three once and joining in memory is cheaper and far easier to read than a
  // query per cell, and the tables are small and static.
  const [{ data: masterRows }, { data: subjectRows }, { data: levelRows }] = admin
    ? await Promise.all([
        admin.from('taxonomy_master').select('id, category_slug, level_slug, subject_slug, leaf_type').limit(2000),
        admin.from('taxonomy_subjects').select('slug, name').limit(2000),
        admin.from('taxonomy_levels').select('slug, name').limit(2000),
      ])
    : [{ data: null }, { data: null }, { data: null }]

  type Master = {
    id: number
    category_slug: string
    level_slug: string
    subject_slug: string | null
    leaf_type: string | null
  }

  const subjectName = new Map(
    ((subjectRows ?? []) as { slug: string; name: string }[]).map((r) => [r.slug, r.name]),
  )
  const levelName = new Map(
    ((levelRows ?? []) as { slug: string; name: string }[]).map((r) => [r.slug, r.name]),
  )

  const master = ((masterRows ?? []) as Master[]).map((m) => ({
    id: m.id,
    leaf_type: m.leaf_type,
    subject_name: m.subject_slug ? (subjectName.get(m.subject_slug) ?? null) : null,
    level_name: levelName.get(m.level_slug) ?? null,
  }))

  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ')

  // Existing mobiles, so a duplicate against the live database is caught
  // before anything is created rather than by a unique-constraint error.
  const existingMobiles = new Set<string>()
  if (admin) {
    const { data: profiles } = await admin.from('profiles').select('phone_number, email').limit(5000)
    for (const p of profiles ?? []) {
      const m = normalisePkMobile(p.phone_number as string)
      if (m) existingMobiles.add(m)
      const email = (p.email as string) ?? ''
      const local = email.split('@')[0]
      if (/^92\d{10}$/.test(local)) existingMobiles.add(local)
    }
  }

  const seenInFile = new Map<string, number>()
  const verdicts: RowVerdict[] = []

  for (const row of rows) {
    const errors: string[] = []

    if (row.name.trim().length < 3) errors.push('Name is missing or too short.')

    const msisdn = normalisePkMobile(row.mobile)
    if (!msisdn) {
      errors.push(`"${row.mobile || '(blank)'}" is not a Pakistani mobile number.`)
    } else {
      const firstSeen = seenInFile.get(msisdn)
      if (firstSeen) errors.push(`Duplicate of the number on row ${firstSeen} of this file.`)
      else seenInFile.set(msisdn, row.line)

      if (existingMobiles.has(msisdn)) errors.push('That mobile number already has an account.')
    }

    if (row.gender && !['male', 'female', 'other'].includes(row.gender)) {
      errors.push(`Gender must be male, female or other — got "${row.gender}".`)
    }
    if (row.experienceYears && !/^\d{1,2}$/.test(row.experienceYears)) {
      errors.push('Experience must be a whole number of years.')
    }
    if (row.expectedFee && !/^\d{1,7}$/.test(row.expectedFee.replace(/[,\s]/g, ''))) {
      errors.push('Expected fee must be a number.')
    }

    // -------------------------------------------------------- taxonomy ---
    const subjects = splitList(row.subjects)
    const levels = splitList(row.levels)
    const masterIds: number[] = []

    if (subjects.length === 0 && levels.length === 0) {
      errors.push('Give at least one subject or level.')
    }

    if (master.length === 0 && (subjects.length > 0 || levels.length > 0)) {
      errors.push('The subject list could not be checked (taxonomy unavailable).')
    } else {
      const levelSet = levels.map(norm)

      for (const subject of subjects) {
        // A subject is only meaningful inside a level. When levels are given,
        // the pair must exist; when they are not, any level teaching that
        // subject is accepted and the tutor narrows it later.
        const matches = master.filter(
          (m) =>
            m.subject_name &&
            norm(m.subject_name) === norm(subject) &&
            (levelSet.length === 0 || (m.level_name && levelSet.includes(norm(m.level_name)))),
        )
        if (matches.length === 0) {
          errors.push(
            levelSet.length > 0
              ? `"${subject}" is not taught at ${levels.join(', ')} in our subject list.`
              : `"${subject}" is not in our subject list.`,
          )
        } else {
          for (const m of matches) masterIds.push(m.id)
        }
      }

      // A level with no subject is selectable in its own right (Test
      // Preparations, Sports & Games, Holy Quran).
      if (subjects.length === 0) {
        for (const level of levels) {
          const matches = master.filter(
            (m) => m.leaf_type === 'level' && m.level_name && norm(m.level_name) === norm(level),
          )
          if (matches.length === 0) {
            errors.push(`"${level}" is not a level that can be taught on its own.`)
          } else {
            for (const m of matches) masterIds.push(m.id)
          }
        }
      }
    }

    verdicts.push({
      line: row.line,
      name: row.name,
      mobile: row.mobile,
      ok: errors.length === 0,
      errors,
      msisdn: msisdn ?? undefined,
      masterIds: Array.from(new Set(masterIds)),
    })
  }

  return verdicts
}

/** A password nobody invents and nobody keeps: replaced at first sign-in. */
export function temporaryPassword(): string {
  return `Tm-${globalThis.crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`
}

/**
 * A provisional address for an imported tutor.
 *
 * NO PHONE DIGITS. This used to append the last four digits of the mobile to
 * keep two tutors of the same name apart. Four digits is not a secret on its
 * own, but it is personal data in a string the import then sends to the tutor
 * over WhatsApp and prints in a results file, and it tells a parent nothing.
 * Collisions break on a hash of the row's own uuid instead, which carries no
 * information about the person.
 *
 * It is provisional because at this moment the row has no subjects yet -- they
 * are inserted a few statements later -- so the canonical form cannot be
 * computed. createImportedTutor() re-derives it through
 * public.tutor_canonical_slug() once the subjects exist, and the profile URL
 * handed to the admin is the final one.
 */
export function slugify(name: string, userId: string): string {
  const base = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 40)
  return `${base || 'tutor'}-tutor-${userId.replace(/-/g, '').slice(0, 4)}`
}

export type ImportOutcome = {
  line: number
  name: string
  username: string
  password: string
  profileUrl: string
  status: string
  userId?: string
}

/**
 * Create ONE imported tutor. Called only for rows that already passed
 * validation, and only after the whole file has been checked.
 */
export async function createImportedTutor(params: {
  row: ImportRow
  verdict: RowVerdict
  actorId: string
  origin: string
}): Promise<ImportOutcome> {
  const { row, verdict } = params
  const admin = createAdminClient()
  const msisdn = verdict.msisdn!
  const email = syntheticEmail(msisdn)
  const password = temporaryPassword()

  const fail = (status: string): ImportOutcome => ({
    line: row.line,
    name: row.name,
    username: msisdn,
    password: '',
    profileUrl: '',
    status,
  })

  if (!admin) return fail('Server not configured')

  const { data: created, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true, // there is no inbox to confirm; the OTP is the real check
    user_metadata: { full_name: row.name },
  })

  if (error || !created?.user) return fail(error?.message ?? 'Could not create the account')

  const userId = created.user.id
  const provisionalSlug = slugify(row.name, userId)

  const { error: profileError } = await admin
    .from('profiles')
    .update({
      full_name: row.name,
      role: 'tutor',
      phone_number: msisdn,
      whatsapp: normalisePkMobile(row.whatsapp) ?? msisdn,
      city: row.city || null,
      must_change_password: true,
    })
    .eq('id', userId)

  if (profileError) {
    // Never leave an auth account behind that has no usable profile: it holds
    // the number hostage and cannot be imported again.
    await admin.auth.admin.deleteUser(userId)
    return fail(profileError.message)
  }

  const { error: tutorError } = await admin.from('tutor_profiles').upsert({
    id: userId,
    slug: provisionalSlug,
    full_name: row.name,
    email,
    phone_number: msisdn,
    city: row.city || null,
    area: row.area || null,
    gender: row.gender || null,
    experience_years: row.experienceYears ? Number(row.experienceYears) : null,
    hourly_rate_pkr: row.expectedFee ? Number(row.expectedFee.replace(/[,\s]/g, '')) : null,
    imported: true,
    imported_at: new Date().toISOString(),
    imported_by: params.actorId,
    claimed_at: null,
    verification_status: 'pending',
  })

  if (tutorError) {
    await admin.auth.admin.deleteUser(userId)
    return fail(tutorError.message)
  }

  if ((verdict.masterIds ?? []).length > 0) {
    await admin
      .from('tutor_subjects')
      .insert(verdict.masterIds!.map((master_id) => ({ tutor_id: userId, master_id })))
  }

  // Now that the subjects exist, the canonical address can be computed --
  // name, main subject, "tutor", city. Done through the database function so
  // the import and the admin Suggest button cannot propose different things
  // for the same tutor, and through set_tutor_slug so the provisional address
  // is retired into slug_history rather than vanishing.
  let slug = provisionalSlug
  const { data: canonical } = await admin.rpc('tutor_canonical_slug', { p_tutor: userId })
  if (typeof canonical === 'string' && canonical && canonical !== provisionalSlug) {
    const { data: applied } = await admin.rpc('set_tutor_slug', {
      p_tutor: userId,
      p_slug: canonical,
    })
    if (typeof applied === 'string' && applied) slug = applied
  }

  // Logged here rather than by the caller: this is the only place that knows
  // the new user's id, and an activity row keyed by anything else would be
  // useless on the member timeline.
  await logActivity({
    userId,
    event: 'imported',
    targetType: 'tutor_profile',
    targetId: userId,
    meta: { line: row.line, slug, importedBy: params.actorId },
  })

  return {
    line: row.line,
    name: row.name,
    username: msisdn,
    password,
    profileUrl: `${params.origin}/tutor/${slug}`,
    status: 'Created',
    userId,
  }
}
