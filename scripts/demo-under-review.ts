/**
 * scripts/demo-under-review.ts
 *
 *   npx tsx scripts/demo-under-review.ts               # report state, write nothing
 *   npx tsx scripts/demo-under-review.ts --on   [key]  # flip a seed tutor under review
 *   npx tsx scripts/demo-under-review.ts --off  [key]  # clear it
 *
 * An OPT-IN demo of the under-review state (owner, Part 5). It flips
 * tutor_profiles.under_review on a NAMED seed tutor so the amber notice and the
 * delist-from-search behaviour can be seen, then --off restores it.
 *
 * DELIBERATELY SEPARATE FROM seed-dev / reset-seed-cast. under_review is not
 * part of the asserted seed cast (scripts/seedCast.ts), and reset-seed-cast does
 * not touch it — so flipping it here does not drift the cast, and `npm run
 * reset:seedcast` will not silently undo or fight this script. Restore with
 * --off when you are done; the script asserts the flip landed either way.
 *
 * Default target: seed+verified-usman (a listed Verified tutor), so the demo
 * shows a tutor who IS in the directory dropping out of search while their
 * public URL keeps rendering the amber notice.
 */

import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { guardWrites, die } from './target'

function loadEnv(): Record<string, string> {
  const env: Record<string, string> = { ...(process.env as Record<string, string>) }
  try {
    for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
      if (!line || line.trimStart().startsWith('#') || !line.includes('=')) continue
      const i = line.indexOf('=')
      const k = line.slice(0, i).trim()
      const v = line.slice(i + 1).trim().replace(/^["']|["']$/g, '')
      if (!(k in env) || !env[k]) env[k] = v
    }
  } catch {
    /* optional */
  }
  return env
}

async function main() {
  const env = loadEnv()
  const on = process.argv.includes('--on')
  const off = process.argv.includes('--off')
  if (on && off) die('Pass either --on or --off, not both.')
  const write = on || off

  const key = process.argv.find((a) => !a.startsWith('-') && a.includes('-') && !a.endsWith('.ts'))
    ?? 'verified-usman'
  const email = `seed+${key}@tutormint.dev`

  await guardWrites({
    scriptName: 'demo-under-review -- flip under_review on a named seed tutor',
    env,
    action: write
      ? `Sets tutor_profiles.under_review = ${on} on ${email}.`
      : 'Dry run only: reports the current under_review state, writes nothing.',
    dryRun: !write,
  })

  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceKey) die('SUPABASE_SERVICE_ROLE_KEY is not set.')
  const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data: profile } = await admin.from('profiles').select('id').eq('email', email).maybeSingle()
  if (!profile) die(`No account for ${email}.`)
  const id = profile.id as string

  const { data: before } = await admin
    .from('tutor_profiles')
    .select('under_review, slug')
    .eq('id', id)
    .maybeSingle()
  if (!before) die(`${email} is not a tutor (no tutor_profiles row).`)

  console.log(`${email} (${before.slug}): under_review = ${before.under_review}`)

  if (!write) {
    console.log('Dry run: pass --on to flip under review, --off to clear.')
    return
  }

  const target = on
  await admin
    .from('tutor_profiles')
    .update({ under_review: target, review_reason: target ? 'Demo: under review' : null })
    .eq('id', id)

  // Assert the flip landed, and that the two views behave as designed.
  const { data: after } = await admin
    .from('tutor_profiles')
    .select('under_review')
    .eq('id', id)
    .maybeSingle()
  if (!!after?.under_review !== target) die('The flip did not land — under_review is unchanged.')

  const [{ data: inDir }, { data: page }] = await Promise.all([
    admin.from('tutor_directory').select('id').eq('id', id).maybeSingle(),
    admin.rpc('tutor_public_page', { p_slug: before.slug }),
  ])
  const listed = !!inDir
  const renders = Array.isArray(page) && page.length > 0

  console.log(`under_review is now ${target}.`)
  console.log(`  in tutor_directory (browse/search/sitemap): ${listed}  (expected ${!target})`)
  console.log(`  public URL renders (tutor_public_page):     ${renders}  (expected true)`)
  if (target && listed) die('Assertion failed: under-review tutor is still in tutor_directory.')
  if (!renders) die('Assertion failed: the public profile URL stopped rendering.')
  console.log(target ? 'Under review — delisted from search, URL still renders.' : 'Restored.')
}

main().catch((e) => die(e instanceof Error ? e.message : String(e)))
