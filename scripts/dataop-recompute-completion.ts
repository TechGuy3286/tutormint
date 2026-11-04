/**
 * scripts/dataop-recompute-completion.ts
 *
 * Owner, 4 Nov 2026 (Part B): recalculate profiles.profile_completion for EVERY
 * member with the one shared rule (lib/profileRequired — email and the intro
 * video never count). Tutors through the same facts the app reads
 * (lib/onboardingStop flowFactsByTutor); everyone else through the parent rule.
 * Prints the before/after distribution. Writes only rows whose number changes,
 * only the profile_completion column; deletes nothing.
 *   npx tsx --env-file=.env.local scripts/dataop-recompute-completion.ts           (dry run, writes nothing)
 *   npx tsx --env-file=.env.local scripts/dataop-recompute-completion.ts --apply
 * Counts only — no names, numbers or emails are printed.
 */
import { createClient } from '@supabase/supabase-js'
import { flowFactsByTutor } from '../lib/onboardingStop'
import { calculateParentCompletion, tutorCompletionFromFacts } from '../lib/profileChecklist'
import { pageAll } from '../lib/pageAll'

type Row = { id: string; role: string | null; profile_completion: number | null; full_name: string | null; city: string | null; address: string | null; cnic_number: string | null; cnic_image_path: string | null; phone_verified_at: string | null; admin_role: string | null }

const bucket = (p: number) => (p >= 100 ? '100' : p >= 90 ? '90-99' : p >= 75 ? '75-89' : p >= 50 ? '50-74' : p >= 25 ? '25-49' : '0-24')
const ORDER = ['0-24', '25-49', '50-74', '75-89', '90-99', '100']
function dist(values: number[]): string {
  const m = new Map<string, number>()
  for (const v of values) m.set(bucket(v), (m.get(bucket(v)) ?? 0) + 1)
  return ORDER.map((k) => `${k}: ${m.get(k) ?? 0}`).join(' · ')
}

async function main() {
  const apply = process.argv.includes('--apply')
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
  const rows = await pageAll<Row>((from, to) =>
    admin.from('profiles').select('id, role, admin_role, profile_completion, full_name, city, address, cnic_number, cnic_image_path, phone_verified_at').order('id').range(from, to) as never,
  )
  const members = rows.filter((r) => r.role !== 'admin')
  const tutorIds = members.filter((r) => r.role === 'tutor').map((r) => r.id)
  const facts = new Map<string, Awaited<ReturnType<typeof flowFactsByTutor>> extends Map<string, infer V> ? V : never>()
  for (let i = 0; i < tutorIds.length; i += 80) for (const [k, v] of await flowFactsByTutor(admin, tutorIds.slice(i, i + 80))) facts.set(k, v)

  const changes: { id: string; from: number; to: number; role: string }[] = []
  const before = { tutor: [] as number[], parent: [] as number[] }
  const after = { tutor: [] as number[], parent: [] as number[] }
  for (const r of members) {
    const role = r.role === 'tutor' ? 'tutor' : 'parent'
    let next: number | null
    if (role === 'tutor') {
      const f = facts.get(r.id)
      next = f ? tutorCompletionFromFacts(f).percent : null // no tutor_profiles row: left as it is
    } else {
      next = calculateParentCompletion({ profile: r }).percent
    }
    const prev = Number(r.profile_completion ?? 0)
    before[role].push(prev)
    after[role].push(next ?? prev)
    if (next !== null && next !== prev) changes.push({ id: r.id, from: prev, to: next, role })
  }

  console.log(`Members: ${members.length} (tutors ${before.tutor.length}, parents ${before.parent.length}); staff accounts skipped: ${rows.length - members.length}`)
  console.log(`Tutors  before: ${dist(before.tutor)}`)
  console.log(`Tutors  after : ${dist(after.tutor)}`)
  console.log(`Parents before: ${dist(before.parent)}`)
  console.log(`Parents after : ${dist(after.parent)}`)
  const up = changes.filter((c) => c.to > c.from).length
  console.log(`Changes: ${changes.length} (up ${up}, down ${changes.length - up}); to 100%: ${changes.filter((c) => c.to === 100).length}`)

  if (!apply) {
    console.log('Dry run — nothing written. Re-run with --apply.')
    return
  }
  let written = 0
  for (const c of changes) {
    const { error } = await admin.from('profiles').update({ profile_completion: c.to }).eq('id', c.id).eq('profile_completion', c.from)
    if (error) console.error(`update failed: ${error.message}`)
    else written++
  }
  console.log(`Written: ${written} of ${changes.length}`)
}

main().then(() => process.exit(0), (e) => { console.error(e instanceof Error ? e.message : e); process.exit(1) })
