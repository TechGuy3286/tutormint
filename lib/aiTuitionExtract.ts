import 'server-only'

// lib/aiTuitionExtract.ts — the server half of lib/aiTuitionExtractCore
// (owner, 23 Nov 2026 — PR-18 Part A). Loads our lists (job titles, curated
// cities, the taxonomy) and runs the pure pipeline with the real Claude call
// (lib/ai/anthropic). The pipeline redacts the post again and refuses to call
// the AI when anything number-shaped is left. The pasted text is never logged
// or stored — a failure logs its reason only.

import { complete, isConfigured } from '@/lib/ai/anthropic'
import { createAdminClient } from '@/lib/supabase/admin'
import { buildTaxonomy, fetchTaxonomyTables } from '@/lib/taxonomyBuild'
import { sortJobTitles } from '@/lib/jobTitlesCore'
import { memoize } from '@/lib/memoCache'
import { AI_UNAVAILABLE, runExtraction, type AiLists, type ExtractResult } from '@/lib/aiTuitionExtractCore'

/** Our lists (job titles, cities, taxonomy) — also read by "Read from image" (lib/imageRead). */
export const loadAiLists = memoize(
  async (): Promise<AiLists> => {
    const admin = createAdminClient()
    if (!admin) return { jobTitles: [], cities: [], tree: {} }
    const [titles, cities, tables] = await Promise.all([
      admin.from('job_titles').select('name, sort_order'),
      admin.from('location_cities').select('name'),
      fetchTaxonomyTables(admin),
    ])
    const tree = tables ? buildTaxonomy(tables).tree : {}
    return {
      jobTitles: sortJobTitles((titles.data ?? []).map((r) => ({ name: r.name as string, sort_order: (r.sort_order as number) ?? 100 }))),
      cities: (cities.data ?? []).map((r) => r.name as string).filter(Boolean).sort(),
      tree,
    }
  },
  ['ai-tuition-lists-v1'],
  { revalidate: 600 },
)

export async function extractTuition(post: string): Promise<ExtractResult> {
  if (!isConfigured()) return { ok: false, status: 503, error: AI_UNAVAILABLE }
  return runExtraction(post, await loadAiLists(), async (a) => {
    const r = await complete(a)
    if (!r.ok) console.warn(`[ai-tuition] extract failed: ${r.reason.slice(0, 120)}`)
    return r
  })
}
