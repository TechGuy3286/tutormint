// PURE (scripts/test-pr17.ts). The rank_tutors() fallback (PR-17 Part A).
//
// A failing ranking must never become an error page. When rank_tutors() fails
// (a statement timeout under load), the directory is read again through
// rank_tutors_simple() — the precomputed cache, the live listing gate, the main
// filters and a simple ordering (verified first, then completion, then name).
// Only when that fails too is the read reported as failed.

export type RpcResult<T> = { data: T[] | null; error: { code?: string; message?: string } | null }

export type RankRead<T> = {
  data: T[]
  /** Both reads failed. */
  error: RpcResult<T>['error']
  /** The simple ordering answered (no cursor paging from here on). */
  fellBack: boolean
}

export async function withRankFallback<T>(
  primary: () => PromiseLike<RpcResult<T>>,
  fallback: () => PromiseLike<RpcResult<T>>,
): Promise<RankRead<T>> {
  let first: RpcResult<T>
  try {
    first = await primary()
  } catch (e) {
    first = { data: null, error: { message: e instanceof Error ? e.message : 'failed' } }
  }
  if (!first.error) return { data: first.data ?? [], error: null, fellBack: false }
  let second: RpcResult<T>
  try {
    second = await fallback()
  } catch (e) {
    second = { data: null, error: { message: e instanceof Error ? e.message : 'failed' } }
  }
  if (!second.error) return { data: second.data ?? [], error: null, fellBack: true }
  return { data: [], error: first.error, fellBack: true }
}

/** The arguments the simple ordering understands (the main filters only —
 *  fee range, area and a name query are dropped, so the page still lists the
 *  city / subject's tutors rather than nothing). A cursor cannot be continued
 *  in a different order, so the fallback always starts at the given offset. */
export function simpleRankArgs(a: {
  city: string | null
  masterIds: number[] | null
  mode: string | null
  gender: string | null
  limit: number
  offset: number
}): { p_city: string | null; p_master_ids: number[] | null; p_teaching_mode: string | null; p_gender: string | null; p_limit: number; p_offset: number } {
  return {
    p_city: a.city || null,
    p_master_ids: a.masterIds && a.masterIds.length > 0 ? a.masterIds : null,
    p_teaching_mode: a.mode || null,
    p_gender: a.gender || null,
    p_limit: a.limit,
    p_offset: Math.max(0, a.offset),
  }
}
