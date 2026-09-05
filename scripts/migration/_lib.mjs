// scripts/migration/_lib.mjs
//
// Shared guard rails and helpers for the one-off Sydney -> Mumbai region
// migration (Sep 2026). EVERY script in this directory imports guard() and
// calls it first, so none of them can run by accident:
//
//   * ALLOW_REGION_MIGRATION=1 must be set,
//   * --from=<ref> --to=<ref> must both be given and must differ,
//   * --from must equal the recorded SYDNEY_REF and --to the NEW_SUPABASE_REF
//     in .env.migration, so a fat-fingered ref cannot point a write at the
//     wrong project,
//   * NOTHING is ever written to the --from (Sydney) project: writeGuard()
//     refuses any URL/ref that resolves to --from.
//
// Secrets (the Management API token, the Mumbai keys, the DB password) live only
// in .env.migration, which is git-ignored; this file loads them at runtime and
// never contains one.

import { readFileSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
export const REPO = join(HERE, '..', '..')

export function loadEnv() {
  const path = join(REPO, '.env.migration')
  let raw
  try {
    raw = readFileSync(path, 'utf8')
  } catch {
    die(`.env.migration not found at ${path}`)
  }
  const env = {}
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (m) env[m[1]] = m[2]
  }
  return env
}

function argVal(name) {
  const pref = `${name}=`
  const hit = process.argv.find((a) => a.startsWith(pref))
  return hit ? hit.slice(pref.length) : null
}

export function die(msg) {
  console.error(`\n✗ ${msg}\n`)
  process.exit(1)
}

// The gate every migration script passes through before doing anything.
export function guard() {
  const env = loadEnv()
  if (process.env.ALLOW_REGION_MIGRATION !== '1') {
    die('refusing to run: set ALLOW_REGION_MIGRATION=1 to confirm a region migration.')
  }
  const from = argVal('--from')
  const to = argVal('--to')
  if (!from || !to) die('refusing to run: pass --from=<sydney ref> --to=<mumbai ref>.')
  if (from === to) die('refusing to run: --from and --to are identical.')
  if (env.SYDNEY_REF && from !== env.SYDNEY_REF) {
    die(`refusing: --from=${from} does not match SYDNEY_REF=${env.SYDNEY_REF} in .env.migration.`)
  }
  if (env.NEW_SUPABASE_REF && to !== env.NEW_SUPABASE_REF) {
    die(`refusing: --to=${to} does not match NEW_SUPABASE_REF=${env.NEW_SUPABASE_REF} in .env.migration.`)
  }
  return { from, to, env }
}

// A hard stop before any WRITE: the target string (a ref, a URL, a host) must
// not resolve to the --from (Sydney) project. Sydney is read-only, always.
export function writeGuard(from, target) {
  if (typeof target === 'string' && target.includes(from)) {
    die(`SAFETY STOP: a write was aimed at the source project (${from}). Sydney is read-only.`)
  }
}

// psql resolution: $PSQL, then the Windows PostgreSQL 17 install, then PATH.
export function psqlBin() {
  if (process.env.PSQL && existsSync(process.env.PSQL)) return process.env.PSQL
  const win = 'C:/Program Files/PostgreSQL/17/bin/psql.exe'
  if (existsSync(win)) return win
  return 'psql'
}

/** Run one SQL statement, returning rows as arrays of column strings (-A -t). */
export function psql(url, sql) {
  const out = execFileSync(psqlBin(), [url, '-X', '-A', '-t', '-F', '\u0001', '-v', 'ON_ERROR_STOP=1', '-c', sql], {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  })
  return out
    .split(/\r?\n/)
    .filter((l) => l.length > 0)
    .map((l) => l.split('\u0001'))
}

/** A single scalar. */
export function psqlScalar(url, sql) {
  const rows = psql(url, sql)
  return rows.length ? rows[0][0] : null
}

const API = 'https://api.supabase.com'

export async function mgmt(env, method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  const text = await res.text()
  let json
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = { _raw: text }
  }
  if (!res.ok) {
    throw new Error(`${method} ${path} -> ${res.status}: ${text.slice(0, 300)}`)
  }
  return json
}
