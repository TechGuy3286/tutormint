// lib/dedupe.ts
//
// Keep the first occurrence of each id, preserving order. Pure and client-safe
// so admin lists that concatenate a server-rendered first page with a restored
// "load more" window render each row once (PR106-H3 §1.3).

export function dedupeById<T extends { id: string }>(rows: T[]): T[] {
  const seen = new Set<string>()
  const out: T[] = []
  for (const r of rows) {
    if (seen.has(r.id)) continue
    seen.add(r.id)
    out.push(r)
  }
  return out
}
