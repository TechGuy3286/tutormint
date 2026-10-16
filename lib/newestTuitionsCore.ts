// lib/newestTuitionsCore.ts — the PURE half of lib/newestTuitions (tested).

export type TuitionLinkRow = { id: string; href: string; title: string; city: string | null; createdAt: string; bumpedAt: string }
export type TuitionLink = { id: string; href: string; title: string }

/**
 * The newest rows in a scope: same city (case and spacing ignored) when one is
 * given, only the given ids when a set is given; newest posted first (or newest
 * bumped for a hub list), ties by id; at most `limit`.
 */
export function pickNewest(
  rows: TuitionLinkRow[],
  scope: { city: string | null; ids: Set<string> | null },
  limit: number,
  by: 'created' | 'bumped' = 'created',
): TuitionLink[] {
  const key = (s: string | null | undefined) => (s ?? '').trim().toLowerCase()
  const city = scope.city ? key(scope.city) : null
  const time = (r: TuitionLinkRow) => new Date(by === 'created' ? r.createdAt : r.bumpedAt).getTime()
  return rows
    .filter((r) => (!city || key(r.city) === city) && (!scope.ids || scope.ids.has(r.id)))
    .sort((a, b) => time(b) - time(a) || (a.id < b.id ? 1 : -1))
    .slice(0, Math.max(0, limit))
    .map((r) => ({ id: r.id, href: r.href, title: r.title }))
}
