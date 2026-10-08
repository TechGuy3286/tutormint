// lib/duplicates.ts
//
// Duplicate tuitions on the server (owner, 6 Oct 2026). Reads through the
// service role (jobs is public-read for open rows only; the check needs paused
// ones too). The RULES are in lib/duplicatesCore.ts.

import { pageAll, pageAllIn } from '@/lib/pageAll'
import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import { citySegment } from '@/lib/slugs'
import { comboKey, titleKey, duplicateReasons, type DuplicateFacts, type DuplicateReason } from './duplicatesCore'

export type ExistingTuition = {
  id: string
  refId: string | null
  title: string | null
  publicSlug: string | null
  city: string | null
  status: string
  createdAt: string
  reasons: DuplicateReason[]
  /** The public page. */
  href: string
}

const COLS = 'id, ref_id, title, public_slug, city, area, class_levels, class_level, gender_preference, budget_pkr, budget_min_pkr, budget_max_pkr, status, created_at, parent_id, grade_subjects'

async function factsFor(admin: NonNullable<ReturnType<typeof createAdminClient>>, rows: Record<string, unknown>[]): Promise<(DuplicateFacts & { row: Record<string, unknown> })[]> {
  const ids = rows.map((r) => r.id as string)
  const masters = new Map<string, number[]>()
  if (ids.length > 0) {
    const data = await pageAllIn(ids, (part, from, to) =>
      admin.from('job_subjects').select('job_id, master_id').in('job_id', part).order('job_id').order('master_id').range(from, to),
    )
    for (const l of data) {
      const arr = masters.get(l.job_id as string) ?? []
      arr.push(l.master_id as number)
      masters.set(l.job_id as string, arr)
    }
  }
  return rows.map((r) => ({
    row: r,
    id: r.id as string,
    title: (r.title as string) ?? null,
    city: (r.city as string) ?? null,
    area: (r.area as string) ?? null,
    classLevels: (r.class_levels as string[] | null) ?? null,
    classLevel: (r.class_level as string | null) ?? null,
    masterIds: masters.get(r.id as string) ?? [],
    genderPreference: (r.gender_preference as string | null) ?? null,
    budgetPkr: (r.budget_pkr as number | null) ?? null,
    budgetMinPkr: (r.budget_min_pkr as number | null) ?? null,
    budgetMaxPkr: (r.budget_max_pkr as number | null) ?? null,
    createdAt: String(r.created_at),
    gradeSubjects: (r.grade_subjects as DuplicateFacts['gradeSubjects']) ?? null,
  }))
}

export function tuitionHref(city: string | null, publicSlug: string | null): string {
  return `/tuitions/${citySegment(city)}/${publicSlug ?? ''}`
}

/**
 * The OPEN or PAUSED tuition this input would repeat (same title, or same full
 * combination), oldest first, or null. `excludeId` leaves the tuition being
 * edited out of its own check.
 */
export async function findExistingDuplicate(
  input: { title: string; city: string | null; area: string | null; classLevels: string[]; masterIds: number[]; genderPreference: string | null; budgetPkr: number | null; budgetMinPkr: number | null; budgetMaxPkr: number | null; gradeSubjects?: DuplicateFacts['gradeSubjects'] },
  excludeId: string | null = null,
): Promise<ExistingTuition | null> {
  const admin = createAdminClient()
  if (!admin) return null
  const me: DuplicateFacts = { id: '__new__', ...input, classLevel: null, createdAt: '9999' }
  const tKey = titleKey(me)
  const cKey = comboKey(me)

  // Candidates: same title (exact, case-insensitive) OR same city — the
  // combination test runs in code on that small set.
  let q = admin.from('jobs').select(COLS).in('status', ['open', 'paused']).limit(500)
  const parts: string[] = []
  if (tKey) parts.push(`title.ilike.${JSON.stringify((input.title ?? '').trim())}`)
  if (input.city) parts.push(`city.ilike.${JSON.stringify(input.city.trim())}`)
  if (parts.length === 0) return null
  q = q.or(parts.join(','))
  const { data } = await q
  const rows = ((data ?? []) as Record<string, unknown>[]).filter((r) => r.id !== excludeId)
  const facts = await factsFor(admin, rows)
  const hits = facts
    .map((f) => ({ f, reasons: duplicateReasons(me, f) }))
    .filter((x) => x.reasons.length > 0 && (x.reasons.includes('same title') || cKey))
    .sort((a, b) => a.f.createdAt.localeCompare(b.f.createdAt))
  const hit = hits[0]
  if (!hit) return null
  const r = hit.f.row
  return {
    id: hit.f.id,
    refId: (r.ref_id as string) ?? null,
    title: hit.f.title,
    publicSlug: (r.public_slug as string) ?? null,
    city: hit.f.city,
    status: r.status as string,
    createdAt: hit.f.createdAt,
    reasons: hit.reasons,
    href: tuitionHref(hit.f.city, (r.public_slug as string) ?? null),
  }
}

/**
 * Safety net (item 16): is this OPEN tuition a repeat of an OLDER open one? If
 * so the page emits no JobPosting and its canonical points at the original.
 */
export async function repeatOfOlderOpen(jobId: string): Promise<ExistingTuition | null> {
  const admin = createAdminClient()
  if (!admin) return null
  const { data: me } = await admin.from('jobs').select(COLS).eq('id', jobId).maybeSingle()
  if (!me || me.status !== 'open') return null
  const [mine] = await factsFor(admin, [me as Record<string, unknown>])
  const parts: string[] = []
  if (mine.title) parts.push(`title.ilike.${JSON.stringify(mine.title.trim())}`)
  if (mine.city) parts.push(`city.ilike.${JSON.stringify(mine.city.trim())}`)
  if (parts.length === 0) return null
  const { data } = await admin
    .from('jobs')
    .select(COLS)
    .eq('status', 'open')
    .neq('id', jobId)
    .lt('created_at', mine.createdAt)
    .or(parts.join(','))
    .limit(500)
  const facts = await factsFor(admin, (data ?? []) as Record<string, unknown>[])
  const hits = facts
    .map((f) => ({ f, reasons: duplicateReasons(mine, f) }))
    .filter((x) => x.reasons.length > 0)
    .sort((a, b) => a.f.createdAt.localeCompare(b.f.createdAt))
  const hit = hits[0]
  if (!hit) return null
  const r = hit.f.row
  return {
    id: hit.f.id,
    refId: (r.ref_id as string) ?? null,
    title: hit.f.title,
    publicSlug: (r.public_slug as string) ?? null,
    city: hit.f.city,
    status: r.status as string,
    createdAt: hit.f.createdAt,
    reasons: hit.reasons,
    href: tuitionHref(hit.f.city, (r.public_slug as string) ?? null),
  }
}

export type RepeatPair = {
  repeat: ExistingTuition & { postedBy: string | null; applications: number }
  original: ExistingTuition
  reasons: DuplicateReason[]
}

/**
 * Admin Duplicates view: every open/paused team-posted tuition created since
 * `since` that repeats an OLDER open/paused tuition, with the staff member who
 * posted it (from the job.post audit row).
 */
export async function recentRepeats(since: Date): Promise<RepeatPair[]> {
  const admin = createAdminClient()
  if (!admin) return []
  const all = await pageAll((from, to) => admin.from('jobs').select(COLS).in('status', ['open', 'paused']).order('id').range(from, to))
  const facts = await factsFor(admin, all as Record<string, unknown>[])
  const byTitle = new Map<string, typeof facts>()
  const byCombo = new Map<string, typeof facts>()
  for (const f of facts) {
    const t = titleKey(f)
    if (t) (byTitle.get(t) ?? byTitle.set(t, []).get(t)!).push(f)
    const c = comboKey(f)
    if (c) (byCombo.get(c) ?? byCombo.set(c, []).get(c)!).push(f)
  }
  const recent = facts.filter((f) => f.createdAt >= since.toISOString())
  const pairs = new Map<string, { repeat: typeof facts[number]; original: typeof facts[number]; reasons: Set<DuplicateReason> }>()
  for (const f of recent) {
    const siblings = [...(byTitle.get(titleKey(f)) ?? []), ...(comboKey(f) ? byCombo.get(comboKey(f)) ?? [] : [])]
    const older = siblings.filter((s) => s.id !== f.id && s.createdAt < f.createdAt).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    const original = older[0]
    if (!original) continue
    const key = f.id
    const p = pairs.get(key) ?? pairs.set(key, { repeat: f, original, reasons: new Set() }).get(key)!
    for (const r of duplicateReasons(f, original)) p.reasons.add(r)
  }
  if (pairs.size === 0) return []

  const repeatIds = [...pairs.keys()]
  const [{ data: posters }, { data: apps }] = await Promise.all([
    admin.from('admin_audit_log').select('target_id, actor_email, created_at').eq('action', 'job.post').in('target_id', repeatIds),
    admin.from('applications').select('job_id').in('job_id', repeatIds),
  ])
  const emailByJob = new Map<string, string>()
  for (const p of (posters ?? []).sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))) {
    if (!emailByJob.has(p.target_id as string)) emailByJob.set(p.target_id as string, p.actor_email as string)
  }
  const emails = [...new Set(emailByJob.values())].filter(Boolean)
  const nameByEmail = new Map<string, string>()
  if (emails.length > 0) {
    const { data: staff } = await admin.from('profiles').select('email, full_name').in('email', emails)
    for (const s of staff ?? []) nameByEmail.set(String(s.email).toLowerCase(), (s.full_name as string) ?? String(s.email))
  }
  const appCount = new Map<string, number>()
  for (const a of apps ?? []) appCount.set(a.job_id as string, (appCount.get(a.job_id as string) ?? 0) + 1)

  const toExisting = (f: typeof facts[number], reasons: DuplicateReason[]): ExistingTuition => ({
    id: f.id,
    refId: (f.row.ref_id as string) ?? null,
    title: f.title,
    publicSlug: (f.row.public_slug as string) ?? null,
    city: f.city,
    status: f.row.status as string,
    createdAt: f.createdAt,
    reasons,
    href: tuitionHref(f.city, (f.row.public_slug as string) ?? null),
  })

  return [...pairs.values()]
    .map((p) => {
      const email = emailByJob.get(p.repeat.id)
      const reasons = [...p.reasons]
      return {
        repeat: { ...toExisting(p.repeat, reasons), postedBy: email ? nameByEmail.get(email.toLowerCase()) ?? email : null, applications: appCount.get(p.repeat.id) ?? 0 },
        original: toExisting(p.original, reasons),
        reasons,
      }
    })
    .sort((a, b) => (a.repeat.postedBy ?? '').localeCompare(b.repeat.postedBy ?? '') || b.repeat.createdAt.localeCompare(a.repeat.createdAt))
}
