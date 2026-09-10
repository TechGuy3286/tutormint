/**
 * scripts/sendpk-probe.ts  —  npm run sendpk:probe -- --to=<msisdn> [--send]
 *
 * A ONE-OFF DISCOVERY PROBE of the SendPK provider (https://sendpk.com/api.php,
 * contract read 10 Sep 2026). It is NOT wired into anything: lib/sms is
 * untouched, no adapter is added, no route imports this, sendOtp() is unchanged.
 * Running it changes no production behaviour — it makes a few HTTP requests and
 * prints exactly what comes back.
 *
 * WHY IT EXISTS. SMS Point's fatal flaw was that its response body looked
 * IDENTICAL for a delivered message and for a number that does not exist — so
 * an OTP could never be trusted to have arrived. This probe answers, from
 * observed output only, whether SendPK is any better: does a bad key look
 * different from a good one, is an invalid recipient rejected or falsely
 * accepted, and does its delivery report actually change over time.
 *
 * SPENDS NOTHING WITHOUT --send. Steps 1–3 (templates, balance, bad key) only
 * read. --send arms the paid steps (4–7): one invalid-number send, one real
 * send to --to, a delivery poll, and one more real send in JSON mode. Each real
 * send costs credit, so there are no loops and no retries.
 *
 * CREDENTIAL: SENDPK_API_KEY from .env.local (or the environment), never a
 * literal. The key is NEVER printed — only its last 4 chars — and it is redacted
 * out of every request URL shown and out of every raw response body printed, in
 * case the API ever echoes it.
 *
 * The --to destination is normalised through lib/phone.ts to 923001234567 form,
 * the same function the platform uses. The sender defaults to the 8584 short
 * code; pass --sender=<mask> to try a brand mask instead.
 */

import { readFileSync } from 'node:fs'
import { normalisePkMobile } from '../lib/phone'

const BASE = 'https://sendpk.com'
const EP = {
  templates: `${BASE}/apps/fetch_all_fixed_templates.php`,
  balance: `${BASE}/api/balance.php`,
  send: `${BASE}/api/sms.php`,
  delivery: `${BASE}/api/delivery.php`,
}

// SendPK error codes, from the contract — printed beside a bare-code body so the
// reader does not have to look them up.
const CODES: Record<string, string> = {
  '1': 'invalid/expired key or disabled account',
  '2': 'empty key',
  '4': 'empty sender',
  '5': 'empty recipient',
  '6': 'empty message',
  '7': 'INVALID RECIPIENT',
  '8': 'insufficient credit',
  '9': 'rejected',
}

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

function last4(k: string): string {
  return k.length >= 4 ? `…${k.slice(-4)}` : '****'
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** The real key, so it can be scrubbed from anything we print. Set in main(). */
let REAL_KEY = ''
function redact(s: string): string {
  return REAL_KEY ? s.split(REAL_KEY).join('***') : s
}

type Raw = { status: number; statusText: string; body: string }

/**
 * One GET, printed. The URL shown has its api_key masked; the body is printed
 * verbatim (the point of the probe) but with the exact key string scrubbed.
 */
async function call(label: string, endpoint: string, params: Record<string, string>): Promise<Raw> {
  const real = new URLSearchParams(params)
  const shown = new URLSearchParams(params)
  if (shown.has('api_key')) shown.set('api_key', last4(params.api_key ?? ''))

  console.log(`\n──────── ${label} ────────`)
  console.log(`GET ${endpoint}?${redact(shown.toString())}`)

  let res: Response
  try {
    res = await fetch(`${endpoint}?${real.toString()}`, { method: 'GET' })
  } catch (e) {
    // An error must not leak the URL (it carries the key).
    console.log('REQUEST FAILED before a response:', e instanceof Error ? e.message : String(e))
    return { status: 0, statusText: 'network-error', body: '' }
  }
  const body = await res.text()
  console.log(`HTTP ${res.status} ${res.statusText}`)
  console.log('--- RAW BODY (verbatim) ---')
  console.log(redact(body))
  console.log('--- END BODY ---')

  const code = body.trim().match(/^(\d)\s*$/)?.[1]
  if (code && CODES[code]) console.log(`(bare code ${code} = ${CODES[code]})`)

  return { status: res.status, statusText: res.statusText, body }
}

/** Best-effort JSON parse; probes never assume a body is well-formed. */
function tryJson(body: string): unknown {
  try {
    return JSON.parse(body)
  } catch {
    return null
  }
}

type Template = { id: string; name: string; message: string; variables: string[] }

function parseTemplates(body: string): { ok: boolean; templates: Template[]; reason: string } {
  const json = tryJson(body) as
    | { success?: string; results?: Array<Record<string, unknown>> }
    | null
  if (!json || typeof json !== 'object') {
    return { ok: false, templates: [], reason: 'response was not JSON' }
  }
  const success = String(json.success ?? '').toLowerCase() === 'true'
  const results = Array.isArray(json.results) ? json.results : []
  if (!success) {
    const err = results[0]?.error ?? 'success:false'
    return { ok: false, templates: [], reason: String(err) }
  }
  const templates: Template[] = results.map((r) => {
    // variables[] may be strings or objects; coerce to names.
    const varsRaw = (r.variables ?? []) as unknown[]
    const variables = Array.isArray(varsRaw)
      ? varsRaw.map((v) =>
          typeof v === 'string' ? v : String((v as Record<string, unknown>)?.name ?? v),
        )
      : []
    return {
      id: String(r.id ?? ''),
      name: String(r.name ?? ''),
      message: String(r.message ?? ''),
      variables,
    }
  })
  return { ok: true, templates, reason: '' }
}

/** Fill a template's variables with dummy values; an otp-like var gets `code`. */
function fillVars(variables: string[], code: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const v of variables) {
    if (/otp|code|pin|password|token/i.test(v)) out[v] = code
    else if (/name/i.test(v)) out[v] = 'TutorMint'
    else out[v] = 'test'
  }
  return out
}

function extractSendId(body: string): string | null {
  return body.match(/OK\s*ID:?\s*(\d+)/i)?.[1] ?? null
}

function num(body: string): number | null {
  const m = body.trim().match(/-?\d+(?:\.\d+)?/)
  return m ? Number(m[0]) : null
}

function arg(name: string): string | undefined {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`))
  return hit?.slice(name.length + 3)
}

async function main() {
  const env = loadEnv()
  const key = (env.SENDPK_API_KEY ?? '').trim()
  if (!key) die('SENDPK_API_KEY is not set in .env.local or the environment. Nothing was done.')
  REAL_KEY = key

  const send = process.argv.slice(2).includes('--send')
  const rawTo = arg('to')
  const sender = arg('sender') || '8584'
  const dead = arg('dead') || '923001234567'

  let to: string | null = null
  if (rawTo) {
    to = normalisePkMobile(rawTo)
    if (!to) die(`--to="${rawTo}" is not a valid Pakistani mobile. Nothing was done.`)
  }
  if (send && !to) die('--send requires --to=<msisdn> (a real number that can receive the test).')

  console.log('SendPK probe')
  console.log('  api_key:', last4(key), '(last 4 only; never printed in full)')
  console.log('  mode:   ', send ? 'READ + SEND (paid steps armed)' : 'READ ONLY (steps 1–3, spends nothing)')
  console.log('  to:     ', to ?? '(not given — read-only run)')
  console.log('  sender: ', sender)

  // Observations, filled from output only — never assumed.
  const obs: Record<string, string> = {}

  // ── 1. Templates — the gate ────────────────────────────────────────────
  const t = await call('STEP 1  templates (approved templates gate)', EP.templates, { api_key: key })
  const parsed = parseTemplates(t.body)
  if (!parsed.ok || parsed.templates.length === 0) {
    console.log(
      `\n✗ GATE FAILED: no approved template exists (${parsed.reason}). SendPK rejects free text — ` +
        `a fixed template must be created and APPROVED in the SendPK dashboard before ANY message ` +
        `can be sent. Nothing below this can run. Stopping.\n`,
    )
    obs['approved template'] = `NONE (${parsed.reason})`
    printSummary(obs, { sent: false })
    return
  }
  console.log(`\nApproved templates (${parsed.templates.length}):`)
  for (const tpl of parsed.templates) {
    console.log(`  • id=${tpl.id}  name=${JSON.stringify(tpl.name)}`)
    console.log(`      message:   ${JSON.stringify(tpl.message)}`)
    console.log(`      variables: ${JSON.stringify(tpl.variables)}`)
  }
  const template = parsed.templates[0]
  obs['approved template'] = `id=${template.id}, name=${JSON.stringify(template.name)}, variables=${JSON.stringify(template.variables)}`

  // ── 2. Balance ─────────────────────────────────────────────────────────
  const b = await call('STEP 2  balance (before)', EP.balance, { api_key: key })
  const balanceBefore = num(b.body)
  console.log(
    '\nNote: ~60 PKR is PROBE-sized, not launch-sized — enough for a handful of test sends, not a live OTP flow.',
  )
  obs['balance before'] = balanceBefore === null ? `unparsed (${JSON.stringify(b.body.trim())})` : String(balanceBefore)

  // ── 3. Bad key ─────────────────────────────────────────────────────────
  const bad = await call('STEP 3  balance with a BAD key (api_key=deadbeef)', EP.balance, { api_key: 'deadbeef' })
  const badCode = bad.body.trim().match(/^(\d)\s*$/)?.[1] ?? null
  const distinguishable = redact(bad.body).trim() !== redact(b.body).trim()
  console.log(
    `\nGood-key body vs bad-key body differ: ${distinguishable ? 'YES' : 'NO'} — ` +
      (distinguishable
        ? 'a wrong key is distinguishable from a right one (SMSPoint\'s was not).'
        : 'they look IDENTICAL — a wrong key cannot be told from a right one (the SMSPoint problem).'),
  )
  obs['bad key distinguishable'] =
    (distinguishable ? 'YES' : 'NO — looks identical to a good key') +
    (badCode ? ` (code ${badCode}${CODES[badCode] ? ` = ${CODES[badCode]}` : ''})` : '')

  if (!send) {
    console.log('\n(No --send: paid steps 4–7 skipped. Re-run with --send --to=<msisdn> to test delivery.)')
    printSummary(obs, { sent: false })
    return
  }

  // ── 4. Invalid recipient (paid) ────────────────────────────────────────
  const message = JSON.stringify(fillVars(template.variables, '123456'))
  const inv = await call('STEP 4  send to an INVALID/dead number', EP.send, {
    api_key: key,
    sender,
    mobile: dead,
    template_id: template.id,
    message,
  })
  const invId = extractSendId(inv.body)
  const invCode = inv.body.trim().match(/^(\d)\s*$/)?.[1] ?? null
  if (invId) {
    console.log(
      `\n⚠️  LOUD WARNING: the invalid/dead number ${dead} returned OK ID:${invId}, NOT code 7. ` +
        `SendPK is FIRE-AND-FORGET like SMSPoint — it accepts a number it cannot deliver to, so an ` +
        `OK from the send API does NOT mean the code was delivered. This is the exact SMSPoint failure.`,
    )
    obs['invalid number'] = `FALSELY ACCEPTED (OK ID:${invId}) — fire-and-forget, cannot be trusted for OTP`
  } else {
    console.log(
      `\nInvalid number ${dead} was rejected` +
        (invCode ? ` with code ${invCode}${CODES[invCode] ? ` = ${CODES[invCode]}` : ''}` : '') +
        ' — the send API validates the recipient (better than SMSPoint).',
    )
    obs['invalid number'] = `rejected${invCode ? ` (code ${invCode}${CODES[invCode] ? ` = ${CODES[invCode]}` : ''})` : ''}`
  }

  // ── 5. Real send (paid) ────────────────────────────────────────────────
  const code = String(Math.floor(100000 + Math.random() * 900000))
  console.log(`\n(Real 6-digit code for this send: ${code} — check the handset it should arrive on.)`)
  const realMsg = JSON.stringify(fillVars(template.variables, code))
  const s = await call(`STEP 5  REAL send to ${to}`, EP.send, {
    api_key: key,
    sender,
    mobile: to!,
    template_id: template.id,
    message: realMsg,
  })
  const sendId = extractSendId(s.body)
  const sendCode = s.body.trim().match(/^(\d)\s*$/)?.[1] ?? null
  obs['real send'] = sendId
    ? `OK ID:${sendId} (sender param "${sender}")`
    : `NO ID${sendCode ? ` (code ${sendCode}${CODES[sendCode] ? ` = ${CODES[sendCode]}` : ''})` : ` — raw: ${JSON.stringify(s.body.trim())}`}`

  // ── 6. Delivery poll (paid, no cost) ───────────────────────────────────
  if (sendId) {
    const schedule = [5, 15, 30, 60] // absolute seconds after send
    let elapsed = 0
    const seen: string[] = []
    let finalAt = ''
    for (const at of schedule) {
      await sleep((at - elapsed) * 1000)
      elapsed = at
      const d = await call(`STEP 6  delivery report @ ${at}s (id=${sendId})`, EP.delivery, {
        api_key: key,
        id: sendId,
      })
      const status = redact(d.body).trim()
      seen.push(`${at}s: ${JSON.stringify(status)}`)
      // A terminal-looking word marks when it settled.
      if (!finalAt && /deliver|failed|rejected|expired|undeliver/i.test(status)) finalAt = `${at}s`
    }
    const changed = new Set(seen.map((x) => x.split(': ')[1])).size > 1
    console.log(`\nDelivery status across polls: ${changed ? 'CHANGED' : 'did NOT change'}`)
    for (const line of seen) console.log('  ' + line)
    obs['delivery report'] =
      (changed ? 'status changed over time' : 'status did NOT change (opaque — possibly not a real report)') +
      (finalAt ? `; terminal-looking by ${finalAt}` : '; no terminal status seen within 60s')
  } else {
    obs['delivery report'] = 'not tested — step 5 returned no send ID'
  }

  // ── 7. Real send in JSON mode (paid) ───────────────────────────────────
  const code2 = String(Math.floor(100000 + Math.random() * 900000))
  console.log(`\n(Second real code, JSON mode: ${code2})`)
  const j = await call(`STEP 7  REAL send to ${to} with format=json`, EP.send, {
    api_key: key,
    sender,
    mobile: to!,
    template_id: template.id,
    message: JSON.stringify(fillVars(template.variables, code2)),
    format: 'json',
  })
  obs['json send shape'] = tryJson(j.body)
    ? `JSON: ${redact(j.body).trim().slice(0, 200)}`
    : `NOT JSON even with format=json — raw: ${JSON.stringify(redact(j.body).trim().slice(0, 120))}`

  // Balance after, to measure cost rather than guess it.
  const b2 = await call('BALANCE (after the sends)', EP.balance, { api_key: key })
  const balanceAfter = num(b2.body)
  obs['balance after'] = balanceAfter === null ? `unparsed (${JSON.stringify(b2.body.trim())})` : String(balanceAfter)
  if (balanceBefore !== null && balanceAfter !== null) {
    obs['cost observed'] = `${(balanceBefore - balanceAfter).toFixed(2)} PKR across the sends made this run`
  }

  printSummary(obs, { sent: true, sender })
}

function printSummary(obs: Record<string, string>, ctx: { sent: boolean; sender?: string }) {
  const say = (q: string, key: string) => console.log(`  • ${q}\n      ${obs[key] ?? (ctx.sent ? 'not observed' : 'not tested (read-only run)')}`)
  console.log('\n\n════════════════ SUMMARY (from observed output only) ════════════════')
  say('Does an approved template exist, its id and variables?', 'approved template')
  console.log(
    `  • Sender: the probe sent with the "${ctx.sender ?? '8584'}" sender param.\n` +
      `      Whether 8584 (short code) or a brand mask is the one that WORKS is told by which\n` +
      `      sender value returned OK above — re-run with --sender=<mask> to compare the two.`,
  )
  say('Is a bad api_key distinguishable from a good one?', 'bad key distinguishable')
  say('Is an invalid number rejected (7) or falsely accepted (OK)?', 'invalid number')
  say('Does delivery.php return a real, changing status, and how long to final?', 'delivery report')
  console.log(
    `  • Balance before / after (cost measured, not guessed):\n` +
      `      before: ${obs['balance before'] ?? 'n/a'}   after: ${obs['balance after'] ?? (ctx.sent ? 'n/a' : 'not tested')}` +
      (obs['cost observed'] ? `   →  ${obs['cost observed']}` : ''),
  )
  say('JSON send shape (format=json)?', 'json send shape')
  console.log(
    `  • SMS or WhatsApp, and the on-device sender name:\n` +
      `      NOT observable from the API — the send/delivery responses do not say which channel\n` +
      `      was used or what name showed on the handset. Read that off the phone the code arrived on.`,
  )
  console.log('═════════════════════════════════════════════════════════════════════\n')
}

main().catch((e) => die(e instanceof Error ? e.message : String(e)))
