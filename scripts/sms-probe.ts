/**
 * scripts/sms-probe.ts  —  npm run sms:probe -- <number> "<message>"
 *
 * PART 7 STAGE 1: a one-shot probe of the SMS Point provider, to DISCOVER its
 * response contract. It is NOT wired into anything — no route imports it,
 * sendOtp() is untouched, the BRIDGE_OTP stopgap is unchanged. Running this
 * changes no production behaviour; it only makes one HTTP request and prints
 * exactly what comes back.
 *
 *   GET https://smspoint.pk/api/sendsms/
 *     ?username=&password=&clientid=&msg=&to=&mask=&Language=English
 *
 * ONE MESSAGE PER RUN. No retries, no loops — each send costs Re 1 from a
 * 100-message test balance, so a stray loop is real money. Pass --dry-run to
 * build everything and print the (password-masked) URL WITHOUT sending.
 *
 * CREDENTIALS FROM ENV ONLY (SMSPOINT_USERNAME / _PASSWORD / _CLIENTID / _MASK),
 * never a literal in code. They are never printed, logged, or put in an error
 * message: the only URL echoed back is a display copy with every credential
 * value masked. If any is missing the script exits and sends nothing.
 *
 * The destination is normalised through lib/phone.ts to the canonical
 * 923001234567 form — the same function the whole platform uses. No msisdn is
 * ever built any other way.
 */

import { readFileSync } from 'node:fs'
import { normalisePkMobile } from '../lib/phone'

const ENDPOINT = 'https://smspoint.pk/api/sendsms/'
const CRED_KEYS = ['SMSPOINT_USERNAME', 'SMSPOINT_PASSWORD', 'SMSPOINT_CLIENTID', 'SMSPOINT_MASK'] as const

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
    /* .env.local is optional */
  }
  return env
}

function die(msg: string): never {
  console.error(`\n✗ ${msg}\n`)
  process.exit(1)
}

async function main() {
  const env = loadEnv()

  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')
  const positional = args.filter((a) => !a.startsWith('--'))
  const rawNumber = positional[0]
  const message = positional[1]

  if (!rawNumber || !message) {
    die('Usage: npm run sms:probe -- <number> "<message>"  [--dry-run]')
  }

  // Credentials: env only, presence-checked before anything is built or sent.
  const missing = CRED_KEYS.filter((k) => !env[k] || !env[k].trim())
  if (missing.length > 0) {
    die(`Missing environment variable(s): ${missing.join(', ')}. Set them in .env.local. Nothing was sent.`)
  }

  const to = normalisePkMobile(rawNumber)
  if (!to) {
    die(`"${rawNumber}" is not a valid Pakistani mobile number. Nothing was sent.`)
  }

  // The real query, with real credentials, used only for the request.
  const real = new URLSearchParams({
    username: env.SMSPOINT_USERNAME,
    password: env.SMSPOINT_PASSWORD,
    clientid: env.SMSPOINT_CLIENTID,
    msg: message,
    to,
    mask: env.SMSPOINT_MASK,
    Language: 'English',
  })

  // A display copy with EVERY credential value masked — the only URL printed.
  const shown = new URLSearchParams(real)
  for (const k of ['username', 'password', 'clientid', 'mask']) shown.set(k, '***')
  const displayUrl = `${ENDPOINT}?${shown.toString()}`

  console.log('SMS Point probe')
  console.log('  to (normalised):', to)
  console.log('  message:        ', JSON.stringify(message))
  console.log('  URL (masked):   ', displayUrl)

  if (dryRun) {
    console.log('\n--dry-run: nothing was sent. Remove --dry-run to send one real message.\n')
    return
  }

  // ONE request. No retry, no loop.
  console.log('\nSending one message…\n')
  let res: Response
  try {
    res = await fetch(`${ENDPOINT}?${real.toString()}`, { method: 'GET' })
  } catch (e) {
    // An error must not leak the URL (it carries the credentials).
    die(`Request failed before a response: ${e instanceof Error ? e.message : String(e)}`)
  }

  const body = await res.text()

  console.log('=== RAW RESPONSE (verbatim, unparsed) ===')
  console.log('HTTP status:', res.status, res.statusText)
  console.log('--- headers ---')
  for (const [k, v] of res.headers.entries()) console.log(`${k}: ${v}`)
  console.log('--- body ---')
  console.log(body)
  console.log('=== END ===')
}

main().catch((e) => die(e instanceof Error ? e.message : String(e)))
