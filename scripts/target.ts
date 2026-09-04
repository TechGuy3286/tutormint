/**
 * scripts/target.ts — which database is this script about to touch?
 *
 * ONE SUPABASE PROJECT SERVES BOTH PREVIEW AND PRODUCTION. There is no
 * separate dev database. Every script under scripts/ that writes is therefore
 * writing to the database tutormint.org reads from, and must say so before it
 * acts.
 *
 * This file exists because the guard it replaces was inverted. seed-dev.ts and
 * seed-cleanup.ts each hardcoded this project's ref as `DEV_PROJECT_REF` and
 * REFUSED TO RUN UNLESS THE TARGET MATCHED IT -- so the check that read like a
 * safety rail was in fact a requirement to point at production, and `npm run
 * seed:dev` was armed against live data while appearing to protect against
 * exactly that. The name was the whole bug: nobody reading `if (ref !==
 * DEV_PROJECT_REF) die()` doubts what it does.
 *
 * Deliberately imports nothing from lib/ and uses no `@/` alias. A script that
 * can delete accounts should not depend on a bundler resolving a path -- the
 * same reasoning seed-cleanup.ts already applied to lib/env.ts.
 */

import { createInterface } from 'node:readline'

/**
 * The live project. Named for what it is.
 *
 * If a genuine second project is ever created for development, this constant
 * does not change: it always names production, and a dev project is simply
 * anything that is not this.
 */
export const PRODUCTION_PROJECT_REF = 'flhiraqouizzwnasuraj'

/** The one env var that permits a write script to touch production. */
export const OVERRIDE_VAR = 'ALLOW_SEED_ON_PRODUCTION'

export function die(msg: string): never {
  console.error(`\n✗ ${msg}\n`)
  process.exit(1)
}

/**
 * Project ref out of either URL shape.
 *
 *   API: https://<ref>.supabase.co
 *   DB:  postgres.<ref>@...pooler.supabase.com
 */
export function refOf(url: string | undefined, kind: 'db' | 'api'): string | null {
  if (!url) return null
  try {
    const u = new URL(url)
    return kind === 'api' ? u.hostname.split('.')[0] : (u.username.split('.')[1] ?? null)
  } catch {
    return null
  }
}

export type Target = {
  apiRef: string | null
  dbRef: string | null
  /** True when EITHER url resolves to production. Either is enough to do harm. */
  isProduction: boolean
}

export function resolveTarget(env: Record<string, string>): Target {
  const apiRef = refOf(env.NEXT_PUBLIC_SUPABASE_URL, 'api')
  const dbRef = refOf(env.SUPABASE_DB_URL, 'db')
  return {
    apiRef,
    dbRef,
    isProduction: apiRef === PRODUCTION_PROJECT_REF || dbRef === PRODUCTION_PROJECT_REF,
  }
}

/** Always printed before a write script acts, whichever project it found. */
export function announceTarget(scriptName: string, target: Target): void {
  const where = target.isProduction
    ? 'PRODUCTION — the database tutormint.org reads from'
    : 'a non-production project'
  console.log(
    `\n${scriptName}\n` +
      `  API project : ${target.apiRef ?? '(unset/unparseable)'}\n` +
      `  DB  project : ${target.dbRef ?? '(unset/unparseable)'}\n` +
      `  target      : ${where}\n`,
  )
}

/**
 * The gate every write script passes through.
 *
 * Refuses production outright unless ALLOW_SEED_ON_PRODUCTION=1 is set for
 * that single invocation, and even then makes the operator type the project
 * ref. Two steps on purpose: the env var is the deliberate decision, and the
 * typed ref is the proof that the person who made it is still at the keyboard
 * and reading. Either alone is something you can do by muscle memory.
 *
 * A non-interactive shell with the override set is refused UNLESS the caller
 * passes --confirm=<production ref> on the command line. A prompt that cannot
 * be answered would either hang a CI job or, worse, be satisfied by whatever
 * happened to be on stdin -- but a flat refusal makes the guarded path
 * unusable outside a terminal, and an unusable guard gets bypassed rather than
 * satisfied. See the note at the check itself.
 */
export async function guardWrites(opts: {
  scriptName: string
  env: Record<string, string>
  /** What is about to happen, in the operator's words. Shown in the prompt. */
  action: string
  /**
   * True when this invocation only reports and writes nothing.
   *
   * A dry run is allowed to proceed against production, because refusing it
   * would remove the one way of checking what the real run would do before
   * committing to it -- and a guard that makes the safe path harder than the
   * dangerous one gets worked around. It still announces the target.
   */
  dryRun?: boolean
}): Promise<Target> {
  const target = resolveTarget(opts.env)
  announceTarget(opts.scriptName, target)

  if (target.apiRef === null && target.dbRef === null) {
    die('Neither NEXT_PUBLIC_SUPABASE_URL nor SUPABASE_DB_URL is set. Refusing to run.')
  }

  if (!target.isProduction) return target

  if (opts.dryRun) {
    console.log('   Dry run: nothing will be written.')
    return target
  }

  if (process.env[OVERRIDE_VAR] !== '1') {
    die(
      `This script writes, and the target is PRODUCTION (${PRODUCTION_PROJECT_REF}).\n\n` +
        `  ${opts.action}\n\n` +
        `  There is one Supabase project and it serves the live site. Refusing.\n\n` +
        `  If you genuinely mean to do this, take a backup first:\n\n` +
        `      ./scripts/backup.sh --full\n\n` +
        `  then re-run this one invocation with:\n\n` +
        `      ${OVERRIDE_VAR}=1 npm run <script>\n`,
    )
  }

  // The typed confirmation, for a shell with no terminal.
  //
  // Authorised by the owner, 4 Sep 2026, and worth being precise about what it
  // relaxes. This was a flat refusal whenever stdin was not a TTY, which is
  // right about the risk and wrong about the remedy: CI has no TTY, an agent
  // shell has no TTY, and node started through npx on Windows often has none
  // either. A guard that cannot be satisfied on the safe path is a guard people
  // go around -- the exact failure this file exists to describe -- and going
  // around it means running the same writes from an ad-hoc script with no
  // announcement, no ref check and no backup reminder at all.
  //
  // Both paths still demand the same two things of ONE invocation: the override
  // variable set, and the operator naming the live project ref themselves. What
  // is given up is only "a human is watching the terminal at this moment". A
  // wrong ref still refuses; an absent flag on a non-interactive shell still
  // refuses.
  const confirmFlag = process.argv.find((a) => a.startsWith('--confirm='))
  if (confirmFlag) {
    if (confirmFlag.slice('--confirm='.length).trim() !== PRODUCTION_PROJECT_REF) {
      die('--confirm did not name the production project. Nothing was written.')
    }
    console.warn(`⚠  Confirmed by --confirm. Writing to PRODUCTION.\n   ${opts.action}\n`)
    return target
  }

  if (!process.stdin.isTTY) {
    die(
      `${OVERRIDE_VAR}=1 is set but this is not an interactive terminal, so the\n` +
        `  confirmation cannot be answered.\n\n` +
        `  Either run it from a terminal, or name the project on the command line:\n\n` +
        `      ${OVERRIDE_VAR}=1 npx tsx scripts/<name>.ts --apply --confirm=${PRODUCTION_PROJECT_REF}\n`,
    )
  }

  console.warn(
    `⚠  ${OVERRIDE_VAR}=1 is set. About to write to PRODUCTION.\n` +
      `   ${opts.action}\n`,
  )

  const typed = await ask(`   Type the project ref (${PRODUCTION_PROJECT_REF}) to continue: `)
  if (typed.trim() !== PRODUCTION_PROJECT_REF) {
    die('Confirmation did not match. Nothing was written.')
  }

  console.log('')
  return target
}

function ask(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close()
      resolve(answer)
    })
  })
}
