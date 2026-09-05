// scripts/migration/copy-auth-config.mjs
//
//   ALLOW_REGION_MIGRATION=1 node scripts/migration/copy-auth-config.mjs \
//     --from=<sydney ref> --to=<mumbai ref>
//
// Reads Sydney's GoTrue (Auth) configuration through the Management API and
// writes the copyable parts into Mumbai, then reads Mumbai back and diffs — the
// only field that may remain different is smtp_pass, which the API REDACTS on
// read and therefore cannot be copied (the owner sets the Resend key by hand).
// Nothing is written to Sydney.

import { guard, writeGuard, mgmt } from './_lib.mjs'

// Fields the API will not accept back on write, or must not be copied:
//   - *_secret / smtp_pass are write-only credentials, redacted on read;
//   - the whole smtp_* block AND rate_limit_email_sent are refused by the API
//     unless smtp_pass is supplied ("Custom SMTP required … Missing SMTP_PASS"),
//     and smtp_pass is unreadable — so the entire custom-SMTP block is an
//     owner-by-hand step in the Mumbai dashboard.
const UNWRITABLE = (k) => /_secret$|^smtp_/i.test(k) || k === 'rate_limit_email_sent'

// Server-managed / plan-derived fields that are not owner-settable and do not
// affect this app. custom_oauth_max_providers is a cap on CUSTOM OAUTH, which is
// disabled on both projects (custom_oauth_enabled=false); Mumbai reports the
// permissive default (32767) vs Sydney's stale 3 — inert, no action.
const SERVER_MANAGED = new Set(['custom_oauth_max_providers'])

async function main() {
  const { from, to, env } = guard()

  const syd = await mgmt(env, 'GET', `/v1/projects/${from}/config/auth`)
  const mumBefore = await mgmt(env, 'GET', `/v1/projects/${to}/config/auth`)

  // Build the write body from every field where Sydney differs from Mumbai,
  // excluding the unwritable credentials.
  const body = {}
  const skipped = []
  for (const k of Object.keys(syd)) {
    if (JSON.stringify(syd[k]) === JSON.stringify(mumBefore[k])) continue
    if (UNWRITABLE(k)) {
      skipped.push(k)
      continue
    }
    body[k] = syd[k]
  }

  console.log(`Auth config: ${Object.keys(body).length} fields to copy, ${skipped.length} skipped (uncopyable): ${skipped.join(', ') || 'none'}`)

  writeGuard(from, to)
  await mgmt(env, 'PATCH', `/v1/projects/${to}/config/auth`, body)

  // Read Mumbai back and diff against Sydney.
  const mumAfter = await mgmt(env, 'GET', `/v1/projects/${to}/config/auth`)
  const remaining = []
  for (const k of new Set([...Object.keys(syd), ...Object.keys(mumAfter)])) {
    if (JSON.stringify(syd[k]) !== JSON.stringify(mumAfter[k])) remaining.push(k)
  }

  console.log(`\nAfter copy, fields still differing from Sydney: ${remaining.length}`)
  for (const k of remaining) console.log('  - ' + k)

  const onlyExpected = remaining.every((k) => UNWRITABLE(k) || SERVER_MANAGED.has(k))
  if (remaining.length === 0) {
    console.log('\n✓ Mumbai auth config is IDENTICAL to Sydney.')
  } else if (onlyExpected) {
    console.log('\n✓ Mumbai auth config matches Sydney except for API-redacted credentials the owner must set by hand:')
    const smtp = remaining.filter((k) => /^smtp_/.test(k) || k === 'rate_limit_email_sent')
    for (const k of remaining) {
      if (SERVER_MANAGED.has(k)) console.log(`    ${k} — server-managed, disabled feature, no action (Sydney ${syd[k]} vs Mumbai ${mumAfter[k]}).`)
      else if (!smtp.includes(k)) console.log(`    ${k} — set by hand.`)
    }
    if (smtp.length) {
      console.log('    Custom SMTP block (owner, in Mumbai dashboard → Auth → SMTP Settings):')
      console.log('      host smtp.resend.com · port 465 · user resend · sender "TutorMint"')
      console.log('      admin noreply@tutormint.org · password = the Resend API key (smtp_pass, unreadable via API)')
      console.log('      then set rate_limit_email_sent = 30 (blocked until custom SMTP is on).')
    }
  } else {
    console.error('\n✗ MISMATCH: fields differ that are NOT redacted credentials. Stopping — do not fix forward.')
    process.exit(2)
  }
}

main().catch((e) => {
  console.error('\n✗ ' + e.message)
  process.exit(1)
})
