/**
 * scripts/test-directory-live.ts
 *
 *   npm run test:directory:live
 *
 * A LIVE test (reads the one production DB over SUPABASE_DB_URL). It guards the
 * one-source rule (owner, 5 Oct 2026, item 8): the tutor_directory VIEW decides
 * who is in Browse, search, the landing pages, the shortlist and the sitemap,
 * and lib/tutorListingStatus `directoryBlockers` is its TypeScript mirror. For
 * every tutor-role profile (and every non-tutor account that carries a
 * tutor_profiles row), the mirror's verdict must equal membership in the view —
 * ANY difference fails. SKIPS when SUPABASE_DB_URL is not configured (never a
 * false green without network).
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

import { directoryBlockers } from '../lib/tutorListingStatus'
import { tutorProfileIndexable } from '../lib/seo/indexable'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')

function dbUrl(): string | null {
  if (process.env.SUPABASE_DB_URL) return process.env.SUPABASE_DB_URL
  try {
    const text = readFileSync(path.join(root, '.env.local'), 'utf8')
    for (const line of text.split(/\r?\n/)) {
      if (line.startsWith('SUPABASE_DB_URL=')) return line.slice('SUPABASE_DB_URL='.length).trim().replace(/^["']|["']$/g, '')
    }
  } catch {
    /* no .env.local */
  }
  return null
}

const url = dbUrl()

test('directoryBlockers agrees with tutor_directory for every account (live)', { skip: !url && 'SUPABASE_DB_URL not configured' }, async () => {
  // @ts-expect-error pg ships no bundled types; dev-only live test.
  const pg = (await import('pg')).default
  const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
  await c.connect()
  try {
    const { rows } = await c.query(`
      select p.id, p.full_name, p.role::text as role,
             coalesce(p.is_banned,false) as is_banned, coalesce(p.is_suspended,false) as is_suspended,
             coalesce(tp.under_review,false) as under_review, tp.verification_status::text as verification_status,
             coalesce(tp.imported,false) as imported, tp.claimed_at,
             coalesce(p.is_seed,false) as is_seed, coalesce(p.is_team_account,false) as is_team_account,
             coalesce(p.hidden_from_public,false) as hidden_from_public,
             coalesce(p.is_test_name,false) as is_test_name,
             (p.paused_by_user_at is not null) as paused_by_user,
             p.verification_state, p.profile_pic_status, p.selfie_status,
             exists (select 1 from public.tutor_directory d where d.id = p.id) as in_view
        from public.profiles p
        join public.tutor_profiles tp on tp.id = p.id
       order by p.created_at`)
    assert.ok(rows.length > 0, 'the sample is not empty')
    const differ: string[] = []
    for (const r of rows) {
      const listed =
        directoryBlockers({
          role: r.role,
          isBanned: r.is_banned,
          isSuspended: r.is_suspended,
          underReview: r.under_review,
          verificationStatus: r.verification_status,
          imported: r.imported,
          claimedAt: r.claimed_at ? String(r.claimed_at) : null,
          isSeed: r.is_seed,
          isTeamAccount: r.is_team_account,
          hiddenFromPublic: r.hidden_from_public,
          isTestName: r.is_test_name,
          pausedByUser: r.paused_by_user,
          cnicRejected: (r.verification_state ?? '').toLowerCase() === 'rejected',
          photoRejected: (r.profile_pic_status ?? '').toLowerCase() === 'rejected',
          selfieRejected: (r.selfie_status ?? '').toLowerCase() === 'rejected',
        }).length === 0
      if (listed !== r.in_view) differ.push(`${r.full_name} (${r.id}): mirror=${listed} view=${r.in_view}`)
    }
    assert.deepEqual(differ, [], `mirror and view disagree for ${differ.length} of ${rows.length} rows`)
    console.log(`checked ${rows.length} accounts against tutor_directory — all agree`)
  } finally {
    await c.end()
  }
})

// The TUTOR INDEX RULE (owner, 5 Oct 2026): a profile is in the sitemap —
// listed_tutor_slugs() — exactly when it is in tutor_directory AND
// tutorProfileIndexable (fee paid + CNIC/photo/selfie approved, never seed /
// under review). The SQL (migration 139) and the TS rule must agree for every
// account; 100% completion must NOT be part of either.
test('tutorProfileIndexable agrees with listed_tutor_slugs() for every tutor (live)', { skip: !url && 'SUPABASE_DB_URL not configured' }, async () => {
  // @ts-expect-error pg ships no bundled types; dev-only live test.
  const pg = (await import('pg')).default
  const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
  await c.connect()
  try {
    const { rows } = await c.query(`
      select p.id, p.full_name, tp.slug, coalesce(p.profile_completion,0) as completion,
             tp.verified_fee_paid_at is not null as fee_paid,
             ((p.cnic_verified_at is not null or lower(coalesce(p.verification_state,'')) = 'approved')
               and coalesce(btrim(p.cnic_number),'') <> '' and coalesce(btrim(p.cnic_image_path),'') <> '') as cnic_approved,
             p.profile_pic_status = 'approved' as pic_approved, p.selfie_status = 'approved' as selfie_approved,
             coalesce(p.is_seed,false) as is_seed, coalesce(tp.under_review,false) as under_review,
             exists (select 1 from public.tutor_directory d where d.id = p.id) as in_view,
             exists (select 1 from public.listed_tutor_slugs() l where l.slug = tp.slug) as in_sitemap
        from public.profiles p join public.tutor_profiles tp on tp.id = p.id
       where tp.slug is not null`)
    const differ: string[] = []
    let underHundred = 0
    for (const r of rows) {
      const expected = r.in_view && tutorProfileIndexable({
        feePaid: r.fee_paid, cnicApproved: r.cnic_approved, profilePicApproved: r.pic_approved,
        selfieApproved: r.selfie_approved, isSeed: r.is_seed, underReview: r.under_review,
      })
      if (expected !== r.in_sitemap) differ.push(`${r.full_name} (${r.id}): rule=${expected} sitemap=${r.in_sitemap}`)
      if (r.in_sitemap && r.completion < 100) underHundred++
    }
    assert.deepEqual(differ, [], `index rule and listed_tutor_slugs disagree for ${differ.length} of ${rows.length} tutors`)
    console.log(`checked ${rows.length} tutors against listed_tutor_slugs — all agree (${underHundred} in the sitemap below 100%)`)
  } finally {
    await c.end()
  }
})
