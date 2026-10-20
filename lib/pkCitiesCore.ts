// lib/pkCitiesCore.ts
//
// PURE, client-safe. The rules behind the searchable city picker (owner,
// 20 Oct 2026): search by name or alias, the Browse filter's "only cities that
// have something", and the subtitle under each city. The city list is passed
// in (lib/pkCityData PK_CITIES), so these are unit-tested without it.
//
// Unit-tested by scripts/test-pk-cities.ts.

export type CityEntry = { name: string; province: string; district: string; aliases: string[]; population?: number }

/** Lower case, letters and digits only: "D.I. Khan" → "dikhan", "Dera-Ismail Khan" → "deraismailkhan". */
export function foldCity(s: string | null | undefined): string {
  return (s ?? '').toLowerCase().normalize('NFKD').replace(/\p{M}/gu, '').replace(/[^a-z0-9]+/g, '')
}

/** "Kasur, Punjab"; the district is left out when it only repeats the name. */
export function citySubtitle(c: Pick<CityEntry, 'name' | 'province' | 'district'>): string {
  const base = c.name.replace(/\s*\(.*\)$/, '')
  const d = c.district && foldCity(c.district) !== foldCity(base) ? `${c.district} district, ` : ''
  return `${d}${c.province}`
}

/**
 * Cities matching what was typed, in list order (the list is already biggest
 * first). Best first: an exact name or alias, then a name that starts with the
 * text, then a word of the name that does, then an alias that does, then the
 * text anywhere in the name or an alias. Empty text = the list as it is.
 */
export function searchCities<T extends CityEntry>(list: T[], query: string, limit = 50): T[] {
  const q = foldCity(query)
  if (!q) return list.slice(0, limit)
  const words = query.toLowerCase().trim()
  const scored: { c: T; s: number; i: number }[] = []
  list.forEach((c, i) => {
    const name = foldCity(c.name)
    const aliases = c.aliases.map(foldCity)
    let s = -1
    if (name === q || aliases.includes(q)) s = 0
    else if (name.startsWith(q)) s = 1
    else if (c.name.toLowerCase().split(/[\s()-]+/).some((w) => w && foldCity(w).startsWith(foldCity(words)))) s = 2
    else if (aliases.some((a) => a.startsWith(q))) s = 3
    else if (name.includes(q) || aliases.some((a) => a.includes(q))) s = 4
    if (s >= 0) scored.push({ c, s, i })
  })
  return scored.sort((a, b) => a.s - b.s || a.i - b.i).slice(0, limit).map((x) => x.c)
}

/** The listed city a typed value means (by name or alias), or null. */
export function resolveCity<T extends CityEntry>(list: T[], typed: string | null | undefined): T | null {
  const q = foldCity(typed)
  if (!q) return null
  return list.find((c) => foldCity(c.name) === q) ?? list.find((c) => c.aliases.some((a) => foldCity(a) === q)) ?? null
}

/**
 * The Browse filter's cities: only those with an open tuition or a listed tutor
 * (`active`, any spelling), in list order, plus the city already chosen so the
 * filter can still show it. A typed city that is not on the list but has
 * activity is kept too, at the end.
 */
export function browseCityOptions(allNames: string[], active: string[], chosen?: string | null): string[] {
  const live = new Set(active.map(foldCity).filter(Boolean))
  const out = allNames.filter((n) => live.has(foldCity(n)))
  const listed = new Set(allNames.map(foldCity))
  for (const a of active) if (a.trim() && !listed.has(foldCity(a)) && !out.some((o) => foldCity(o) === foldCity(a))) out.push(a.trim())
  const c = (chosen ?? '').trim()
  if (c && !out.some((o) => foldCity(o) === foldCity(c))) out.unshift(c)
  return out
}
