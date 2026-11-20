import 'server-only'

// lib/memberAvatars.ts — PR-04 (owner, 18 Nov 2026). Photo + gender for a set
// of members, in one batch, for the admin pictures (components/admin/
// AdminAvatar). Staff see the real photo even when it is hidden publicly.

import { createAdminClient } from '@/lib/supabase/admin'
import { pageAllIn } from '@/lib/pageAll'
import { pickAvatarSrc, type AdminAvatarFacts } from '@/lib/adminAvatarCore'

export async function loadAvatarFacts(ids: (string | null | undefined)[]): Promise<Record<string, AdminAvatarFacts>> {
  const out: Record<string, AdminAvatarFacts> = {}
  const unique = [...new Set(ids.filter((v): v is string => !!v))]
  const admin = createAdminClient()
  if (!admin || !unique.length) return out
  try {
    const [profs, tps] = await Promise.all([
      pageAllIn<{ id: string; avatar_url: string | null }, string>(unique, (part, f, t) => admin.from('profiles').select('id, avatar_url').in('id', part).order('id').range(f, t)),
      pageAllIn<{ id: string; avatar_url: string | null; gender: string | null }, string>(unique, (part, f, t) =>
        admin.from('tutor_profiles').select('id, avatar_url, gender').in('id', part).order('id').range(f, t),
      ),
    ])
    const tp = new Map(tps.map((t) => [t.id, t]))
    for (const p of profs) {
      const t = tp.get(p.id)
      out[p.id] = { src: pickAvatarSrc(t?.avatar_url, p.avatar_url), gender: t?.gender ?? null }
    }
  } catch {
    /* a picture is never worth a failed page: the defaults show */
  }
  return out
}

/**
 * PR-11: which of these members were erased on request (id → erased_at). Every
 * list that names members uses it to show the grey "Deleted user · erased
 * <date>" row instead of the name.
 */
export async function loadErasedAt(ids: (string | null | undefined)[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  const unique = [...new Set(ids.filter((v): v is string => !!v))]
  const admin = createAdminClient()
  if (!admin || !unique.length) return out
  try {
    const rows = await pageAllIn<{ id: string; erased_at: string | null }, string>(unique, (part, f, t) =>
      admin.from('profiles').select('id, erased_at').in('id', part).not('erased_at', 'is', null).order('id').range(f, t),
    100, 8)
    for (const r of rows) if (r.erased_at) out[r.id] = r.erased_at
  } catch {
    /* names show as they are; the member page still says "erased" */
  }
  return out
}
