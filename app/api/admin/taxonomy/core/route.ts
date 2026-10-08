import { NextResponse } from 'next/server'

import { checkAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { saveLevelCore, saveSearchWords, saveUrduNames } from '@/lib/subjectsCore'
import { revalidateTag } from 'next/cache'
import { SMART_SEARCH_TAG } from '@/lib/smartSearch'
import { parseBody, z } from '@/lib/validate'

// Admin → Settings → Subjects: save a level's "Main subjects" (owner, 7 Oct
// 2026). OWNER AND ADMIN ONLY (SCREEN_ACCESS.subjectsCore) — any other staff
// role gets 403 here. Only the core flag changes; subjects are never added,
// renamed or deleted. Audit-logged in lib/subjectsCore.

export const runtime = 'nodejs'

const Body = z.object({
  levelSlug: z.string().min(1).max(200),
  coreMasterIds: z.array(z.coerce.number().int().positive()).max(1000),
  /** Short Urdu names by subject slug (migration 149); '' clears one. */
  urduNames: z.record(z.string().max(200), z.string().max(120).nullable()).optional(),
  /** "Search words" by subject slug (owner, 8 Oct 2026): the full list for each. */
  searchWords: z.record(z.string().max(200), z.array(z.string().max(60)).max(30)).optional(),
})

export async function POST(request: Request) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.subjectsCore)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })

  const parsed = await parseBody(request, Body)
  if (!parsed.ok) return parsed.response

  const result = await saveLevelCore(parsed.data.levelSlug, parsed.data.coreMasterIds, {
    id: gate.actor.id,
    adminRole: gate.actor.adminRole,
    email: gate.actor.email,
  })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })
  const urdu = await saveUrduNames(parsed.data.urduNames ?? {}, {
    id: gate.actor.id,
    adminRole: gate.actor.adminRole,
    email: gate.actor.email,
  })
  if (!urdu.ok) return NextResponse.json({ error: urdu.error }, { status: 400 })
  const words = await saveSearchWords(parsed.data.searchWords ?? {}, {
    id: gate.actor.id,
    adminRole: gate.actor.adminRole,
    email: gate.actor.email,
  })
  if (!words.ok) return NextResponse.json({ error: words.error }, { status: 400 })
  // The smart search reads the new words on its next request.
  if (words.changed.length) revalidateTag(SMART_SEARCH_TAG, 'max')
  return NextResponse.json({ ok: true, added: result.added, removed: result.removed, urduChanged: urdu.changed.length, wordsChanged: words.changed.length })
}
