/**
 * scripts/recompute-completion.ts <userId> [userId ...]
 *
 *   npx tsx scripts/recompute-completion.ts <id>            # report only
 *   npx tsx scripts/recompute-completion.ts <id> --apply    # persist
 *
 * Recomputes profiles.profile_completion from live data using the SAME pure
 * checklist the app uses (lib/profileChecklist), reading through the service
 * role. recomputeCompletion() in lib/completion.ts needs a request-scoped
 * cookie client and cannot run in a script; this reproduces its reads exactly.
 *
 * Written for the credential cleanup of 4 Sep 2026 (migration 46): the
 * instruction was to recompute afterwards so the percentage tells the truth.
 * It reports before/after per tutor so an unchanged percentage is proven, not
 * asserted.
 */

import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import {
  calculateTutorCompletion,
  calculateParentCompletion,
} from '../lib/profileChecklist'
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
  const apply = process.argv.includes('--apply')
  const ids = process.argv.slice(2).filter((a) => !a.startsWith('--'))
  if (ids.length === 0) die('Pass one or more user ids.')

  await guardWrites({
    scriptName: 'recompute-completion -- recalc profiles.profile_completion',
    env,
    action: apply
      ? 'Recomputes and PERSISTS profile_completion for the named users.'
      : 'Dry run only: reports old and new percentages, writes nothing.',
    dryRun: !apply,
  })

  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceKey) die('SUPABASE_SERVICE_ROLE_KEY is not set.')
  const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  for (const id of ids) {
    const { data: profile } = await admin
      .from('profiles')
      .select('id, role, full_name, city, address, cnic_number, cnic_image_path, phone_verified_at, profile_completion')
      .eq('id', id)
      .maybeSingle()
    if (!profile) {
      console.log(`${id}: no profile`)
      continue
    }

    let percent: number
    if (profile.role === 'tutor') {
      const { data: tp } = await admin
        .from('tutor_profiles')
        .select('gender, area, avatar_url, headline, bio, experience_years, hourly_rate_pkr, teaching_mode, degrees, video_youtube_id, video_status')
        .eq('id', id)
        .maybeSingle()
      const { count: subjectCount } = await admin
        .from('tutor_subjects')
        .select('master_id', { count: 'exact', head: true })
        .eq('tutor_id', id)
      const { count: degreeDocCount } = await admin
        .from('user_documents')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', id)
        .eq('kind', 'degree')
      percent = calculateTutorCompletion({
        profile,
        tutorProfile: tp,
        subjectCount: subjectCount ?? 0,
        degreeDocCount: degreeDocCount ?? 0,
      }).percent
    } else {
      percent = calculateParentCompletion({ profile }).percent
    }

    const old = profile.profile_completion
    console.log(`${profile.full_name ?? id}: ${old} -> ${percent}${old === percent ? ' (unchanged)' : ' (CHANGED)'}`)

    if (apply && old !== percent) {
      const { error } = await admin.from('profiles').update({ profile_completion: percent }).eq('id', id)
      if (error) die(`update failed for ${id}: ${error.message}`)
    }
  }
}

main().catch((e) => die(String(e?.stack || e)))
