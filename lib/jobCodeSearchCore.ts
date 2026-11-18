// lib/jobCodeSearchCore.ts — PURE (owner, 18 Nov 2026 — PR-07).
//
// Finding a tuition by its codes in the admin searches (Applications and
// Tuitions): the TM number ("TM-2558", ref_id) and the job code
// ("JOB-TX-GYEMZMG", job_tx_id). Case-insensitive, with or without the prefix,
// with or without the dashes: "tm2558", "2558", "job tx gyemzmg", "GYEMZMG".
//
// Unit-tested by scripts/test-job-code-search.ts.

const squash = (v: string) => v.toUpperCase().replace(/[\s_]+/g, '')

/** The code without its prefix and dashes: "TM-2558" → "2558", "JOB-TX-GYEMZMG" → "GYEMZMG". */
export function bareJobCode(v: string | null | undefined): string {
  return squash(v ?? '')
    .replace(/^JOB-?TX-?/, '')
    .replace(/^TM-?/, '')
    .replace(/-/g, '')
}

/**
 * A typed search read as a code, in the stored shape — or nulls when it does not
 * look like one. "tm2558" → { ref: 'TM-2558' }; "job tx gyemzmg" →
 * { tx: 'JOB-TX-GYEMZMG' }. Plain words ("physics") are not codes.
 */
export function parseJobCode(q: string | null | undefined): { ref: string | null; tx: string | null } {
  const s = squash(q ?? '')
  const ref = /^TM-?(\d{1,8})$/.exec(s)
  if (ref) return { ref: `TM-${ref[1]}`, tx: null }
  const tx = /^JOB-?TX-?([A-Z0-9]{4,12})$/.exec(s)
  if (tx) return { ref: null, tx: `JOB-TX-${tx[1]}` }
  return { ref: null, tx: null }
}

/** Does a tuition with these codes match the typed search? */
export function jobCodeMatches(job: { ref?: string | null; tx?: string | null }, q: string | null | undefined): boolean {
  const needle = squash(q ?? '')
  if (!needle) return false
  const bare = bareJobCode(needle)
  for (const code of [job.ref, job.tx]) {
    const c = squash(code ?? '')
    if (!c) continue
    if (c.includes(needle)) return true
    if (bare.length >= 3 && bareJobCode(c).includes(bare)) return true
  }
  return false
}

/** The extra PostgREST `or` terms for the admin Tuitions search: the stored
 *  shape of a typed code ("tm2558" → ref_id ilike %TM-2558%). Empty when the
 *  search is not a code (the plain ilike terms already cover it). */
export function jobCodeOrTerms(q: string | null | undefined): string[] {
  const { ref, tx } = parseJobCode(q)
  const out: string[] = []
  if (ref) out.push(`ref_id.ilike.%${ref}%`)
  if (tx) out.push(`job_tx_id.ilike.%${tx}%`)
  return out
}
