/**
 * scripts/report-social-picker.ts — READ-ONLY.
 * How many tutors the Social posts picker lists (lib/social/eligibilityCore — the
 * same rule the page and the render route use), why listed tutors are left out
 * (counts only), and, with a folder argument, sample PNGs of the "I'm a Verified
 * Tutor" template for one verified tutor with a photo and one shown with the
 * hidden-photo silhouette.
 *   npx tsx --env-file=.env.local scripts/report-social-picker.ts [samples-folder]
 */
// @ts-expect-error pg ships no bundled types
import pg from 'pg'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import QRCode from 'qrcode'

import { PROFILE_COLS, socialEligible, socialIneligibleReason, toFacts } from '../lib/social/eligibilityCore'
import { socialPortraitSrc } from '../lib/social/avatars'
import { renderSocialBanner } from '../app/api/admin/social/image/render'
import { formatName } from '../lib/formatName'
import { levelLabel } from '../lib/display'

async function main() {
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  const cols = PROFILE_COLS.split(',').map((s) => `p.${s.trim()}`).join(', ')
  const { rows } = await c.query(`
    select ${cols}, p.full_name, p.city, tp.verified_fee_paid_at::text as verified_fee_paid_at, tp.gender, tp.show_avatar,
           tp.slug, tp.avatar_url, (d.id is not null) as listed
    from profiles p
    left join tutor_profiles tp on tp.id = p.id
    left join tutor_directory d on d.id = p.id
    where p.role = 'tutor'`)
  const { rows: subjects } = await c.query(`
    select ts.tutor_id, coalesce(s.name, l.name) as subject, l.name as level
    from tutor_subjects ts join taxonomy_master m on m.id = ts.master_id
    join taxonomy_levels l on l.slug = m.level_slug left join taxonomy_subjects s on s.slug = m.subject_slug`)
  await c.end()
  for (const r of rows) for (const k of Object.keys(r)) if (r[k] instanceof Date) r[k] = r[k].toISOString()

  const eligible = rows.filter((r: Record<string, unknown>) => socialEligible(toFacts(r as never, r)))
  const listedOut: Record<string, number> = {}
  for (const r of rows) {
    if (!r.listed) continue
    const why = socialIneligibleReason(toFacts(r as never, r))
    if (why) listedOut[why] = (listedOut[why] ?? 0) + 1
  }
  console.log(`Tutor accounts: ${rows.length}`)
  console.log(`In the Social posts picker now: ${eligible.length}`)
  console.log(`Listed in Browse but left out of the picker, by first reason:`, listedOut)
  console.log(`Of the picker, photo hidden from parents: ${eligible.filter((r: Record<string, unknown>) => r.show_avatar === false).length}`)
  const ahad = rows.filter((r: Record<string, unknown>) => /abdul\s+ahad/i.test(String(r.full_name ?? '')))
  for (const r of ahad) {
    console.log(`"Abdul Ahad" (${r.city ?? '-'}): in picker = ${socialEligible(toFacts(r as never, r))} (${socialIneligibleReason(toFacts(r as never, r)) ?? 'eligible'})`)
  }

  const out = process.argv[2]
  if (!out) return
  mkdirSync(out, { recursive: true })
  const mono = readFileSync(path.join(__dirname, '..', 'public/brand/tutormint-monogram.png'))
  const logoDataUri = `data:image/png;base64,${mono.toString('base64')}`
  const withPhoto = eligible.find((r: Record<string, unknown>) => r.avatar_url && r.show_avatar !== false && r.city)
  const hidden = eligible.find((r: Record<string, unknown>) => r.show_avatar === false) ?? eligible.find((r: Record<string, unknown>) => r !== withPhoto)
  for (const [label, r, hide] of [
    ['photo', withPhoto, false],
    ['hidden-photo', hidden, true],
  ] as const) {
    if (!r) continue
    const subs = [...new Set(subjects.filter((s: { tutor_id: string }) => s.tutor_id === r.id).map((s: { subject: string; level: string }) => `${levelLabel(s.level)} ${s.subject}`))].slice(0, 3) as string[]
    const profileUrl = `https://www.tutormint.org/tutor/${r.slug}`
    const qrDataUri = await QRCode.toDataURL(profileUrl, { margin: 1 })
    for (const format of ['square', 'story', 'wide'] as const) {
      const res = renderSocialBanner({
        tutor: {
          id: r.id,
          slug: r.slug,
          full_name: formatName(r.full_name) || 'Tutor',
          headline: null,
          city: r.city,
          area: null,
          rating_avg: 0,
          rating_count: 0,
          avatar_url: socialPortraitSrc(r.avatar_url, hide, r.gender),
          gender: r.gender,
        },
        badges: ['Verified'],
        subjects: subs,
        format,
        template: 'verified',
        qrDataUri,
        profileUrl,
        logoDataUri,
      })
      const file = path.join(out, `real-${label}-${format}.png`)
      writeFileSync(file, Buffer.from(await res.arrayBuffer()))
      console.log(file)
    }
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
