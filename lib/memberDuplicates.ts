import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import { pageAll } from '@/lib/pageAll'
import { logAdminAction } from '@/lib/auditLog'
import { duplicateTags, inTab, loadDirectory } from '@/lib/peopleDirectory'
import { DUP_WORDS, type DupLink, type DupReason } from '@/lib/peopleDirectoryCore'
import { openPairs, withoutDismissed, type DuplicatePair } from '@/lib/memberDuplicatesCore'
import type { AdminRole } from '@/lib/adminAccessCore'

// "Possible duplicate" pairs (owner, 26 Oct 2026). A pair the Owner marked "Not
// a duplicate" is hidden for good (member_duplicate_dismissals, logged); a pair
// where either account is already merged is not a duplicate any more.

export async function loadDismissedPairs(): Promise<Set<string>> {
  const admin = createAdminClient()
  const out = new Set<string>()
  if (!admin) return out
  const rows = await pageAll((a, b) => admin.from('member_duplicate_dismissals').select('a_id, b_id').order('a_id').range(a, b) as never)
  for (const r of rows as { a_id: string; b_id: string }[]) out.add(`${r.a_id}|${r.b_id}`)
  return out
}

/** Every open pair, from the People page's own tags, minus the dismissed. */
export async function loadOpenDuplicatePairs(): Promise<DuplicatePair[]> {
  const d = await loadDirectory()
  const people = [...inTab(d.people, 'tutor', false), ...inTab(d.people, 'parent', false)]
  const [tags, dismissed] = await Promise.all([duplicateTags(people), loadDismissedPairs()])
  const names = new Map(people.map((p) => [p.id, { name: p.name, role: p.role }]))
  return openPairs(tags, dismissed, names)
}

/** Tags for a set of people with the dismissed pairs taken out. */
export async function openTags(tags: Map<string, DupLink[]>): Promise<Map<string, DupLink[]>> {
  return withoutDismissed(tags, await loadDismissedPairs())
}

export async function dismissPair(actor: { id: string; adminRole: AdminRole; email: string | null }, aId: string, bId: string, reason: DupReason | null) {
  const admin = createAdminClient()
  if (!admin) return { ok: false as const, status: 503, error: 'This is not working right now.' }
  const [a, b] = aId < bId ? [aId, bId] : [bId, aId]
  const { error } = await admin.from('member_duplicate_dismissals').upsert({ a_id: a, b_id: b, dismissed_by: actor.id }, { onConflict: 'a_id,b_id', ignoreDuplicates: true })
  if (error) return { ok: false as const, status: 400, error: 'That did not save. Please try again.' }
  for (const target of [a, b]) {
    await logAdminAction({
      actorId: actor.id,
      actorRole: actor.adminRole,
      actorEmail: actor.email,
      action: 'member.not_duplicate',
      targetType: 'profile',
      targetId: target,
      detail: { otherId: target === a ? b : a, reason: reason ? DUP_WORDS[reason] : null },
    })
  }
  return { ok: true as const }
}
