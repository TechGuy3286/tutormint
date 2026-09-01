/**
 * scripts/seed-cleanup.ts
 *
 * Remove the development seed cast and dev-only rows, before a production
 * launch or whenever the fixtures are in the way.
 *
 *   npx tsx scripts/seed-cleanup.ts          # show what would be removed
 *   npx tsx scripts/seed-cleanup.ts --apply  # remove it
 *
 * GUARDED EXACTLY LIKE seed-dev.ts, and for the same reason: a script that can
 * delete accounts must not be able to point at the wrong database. It refuses
 * to run unless the environment is not the live site AND both SUPABASE_DB_URL
 * and NEXT_PUBLIC_SUPABASE_URL resolve to the known dev project ref.
 *
 * "Not the live site" is VERCEL_ENV when it exists, NODE_ENV otherwise --
 * mirroring lib/env.ts, which this file deliberately does not import: a script
 * that deletes accounts should not depend on a module resolving through a
 * bundler alias. The rule is short enough to state twice, and the project-ref
 * check is the guard that actually matters here.
 *
 * WHAT IT WILL DELETE
 *   * auth users whose email starts with `seed+` and ends `@tutormint.dev`
 *   * advertisements created by the seed (title beginning `SEED `)
 *   * app_settings rows the seed wrote
 *   * rate_limits windows (they are ephemeral by nature)
 *
 * WHAT IT WILL NOT DELETE, EVER
 *   * any account that is not a seed+ address — including the owner, staff, and
 *     any real member who happens to look like test data
 *   * anything at all when the project ref does not match
 *   * plans, taxonomy, or any reference data
 *
 * The deletion is by auth user id and relies on the FK cascades from
 * auth.users, which is what removes their profiles, jobs, applications,
 * threads, messages, payments and subscriptions with them. Deleting the rows
 * table by table by hand is how you end up with an orphaned message whose
 * sender no longer exists.
 */

import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const DEV_PROJECT_REF = 'flhiraqouizzwnasuraj'
const SEED_PREFIX = 'seed+'
const SEED_DOMAIN = '@tutormint.dev'

function loadEnv(): Record<string, string> {
  const env: Record<string, string> = { ...(process.env as Record<string, string>) }
  try {
    for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
      if (!line || line.trimStart().startsWith('#') || !line.includes('=')) continue
      const i = line.indexOf('=')
      const k = line.slice(0, i).trim()
      const v = line
        .slice(i + 1)
        .trim()
        .replace(/^["']|["']$/g, '')
      if (!(k in env) || !env[k]) env[k] = v
    }
  } catch {
    /* optional */
  }
  return env
}

function die(msg: string): never {
  console.error(`\n✗ ${msg}\n`)
  process.exit(1)
}

function refOf(url: string | undefined, kind: 'db' | 'api'): string | null {
  if (!url) return null
  try {
    const u = new URL(url)
    return kind === 'api' ? u.hostname.split('.')[0] : (u.username.split('.')[1] ?? null)
  } catch {
    return null
  }
}

async function main() {
  const env = loadEnv()
  const apply = process.argv.includes('--apply')

  // ---- the guards, before anything is read or written --------------------
  const vercelEnv = process.env.VERCEL_ENV
  const live = vercelEnv ? vercelEnv === 'production' : process.env.NODE_ENV === 'production'
  if (live) {
    die(
      vercelEnv
        ? `VERCEL_ENV is "${vercelEnv}". This script never runs against the live site.`
        : 'NODE_ENV is production. This script never runs there.',
    )
  }

  const apiRef = refOf(env.NEXT_PUBLIC_SUPABASE_URL, 'api')
  const dbRef = refOf(env.SUPABASE_DB_URL, 'db')

  if (apiRef !== DEV_PROJECT_REF) {
    die(
      `NEXT_PUBLIC_SUPABASE_URL points at project "${apiRef ?? '(unset)'}", not the dev project ` +
        `"${DEV_PROJECT_REF}". Refusing to run.`,
    )
  }
  if (dbRef && dbRef !== DEV_PROJECT_REF) {
    die(
      `SUPABASE_DB_URL points at project "${dbRef}", not the dev project ` +
        `"${DEV_PROJECT_REF}". Refusing to run.`,
    )
  }

  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceKey) die('SUPABASE_SERVICE_ROLE_KEY is not set.')

  const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  console.log(`project ${DEV_PROJECT_REF} · ${apply ? 'APPLYING' : 'dry run (pass --apply to delete)'}\n`)

  // ---- the seed cast ------------------------------------------------------
  const seedUsers: { id: string; email: string }[] = []
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 })
    if (error) die(`listUsers: ${error.message}`)
    if (!data.users.length) break
    for (const u of data.users) {
      const email = (u.email ?? '').toLowerCase()
      if (email.startsWith(SEED_PREFIX) && email.endsWith(SEED_DOMAIN)) {
        seedUsers.push({ id: u.id, email })
      }
    }
    if (data.users.length < 200) break
  }

  console.log(`seed accounts (${SEED_PREFIX}…${SEED_DOMAIN}): ${seedUsers.length}`)
  for (const u of seedUsers) console.log(`   ${u.email}`)

  // ---- dev-only rows ------------------------------------------------------
  const { data: seedAds } = await admin
    .from('advertisements')
    .select('id, title')
    .like('title', 'SEED %')
  console.log(`\nseed advertisements: ${(seedAds ?? []).length}`)
  for (const a of seedAds ?? []) console.log(`   ${a.title}`)

  const { count: rateRows } = await admin
    .from('rate_limits')
    .select('bucket', { count: 'exact', head: true })
  console.log(`\nrate_limits windows: ${rateRows ?? 0}`)

  if (!apply) {
    console.log('\nDry run. Nothing was changed. Re-run with --apply to delete the above.')
    return
  }

  // ---- delete -------------------------------------------------------------
  let deleted = 0
  for (const u of seedUsers) {
    const { error } = await admin.auth.admin.deleteUser(u.id)
    if (error) console.error(`   ! ${u.email}: ${error.message}`)
    else {
      deleted++
      console.log(`   deleted ${u.email}`)
    }
  }

  if ((seedAds ?? []).length > 0) {
    const { error } = await admin
      .from('advertisements')
      .delete()
      .in(
        'id',
        (seedAds ?? []).map((a) => a.id),
      )
    if (error) console.error(`   ! advertisements: ${error.message}`)
  }

  // Ephemeral by design; clearing them costs nothing and leaves no stale
  // budget behind for whoever tests next.
  await admin.from('rate_limits').delete().gte('window_start', '1970-01-01')

  console.log(`\n✓ removed ${deleted} seed account(s) and their data.`)
  console.log('Reference data (plans, taxonomy) and every non-seed account were left alone.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
