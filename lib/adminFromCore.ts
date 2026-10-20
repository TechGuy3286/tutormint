// lib/adminFromCore.ts
//
// "Breadcrumbs follow you" (owner, 20 Oct 2026). When staff open a member,
// tuition or tutor record FROM a list, the record's address carries the list
// it was opened from in `?from=` — the list's full address, filter chip and
// search text included. The header trail is then built from that list's own
// trail plus the record ("Home › Admin › Overview › Tutors › Muhammad Dawood"),
// and the list crumb links back to the exact list the person left.
//
// Opened directly (search, a link, a notification) there is no `from`, and the
// trail falls back to the record's own section ("Home › Admin › People › Name").
//
// The value comes from the address bar, so it is checked before use: an admin
// path on this site only, never another host, never a protocol-relative or
// backslash trick. PURE — unit-tested by scripts/test-admin-cleanup.ts.

export const FROM_PARAM = 'from'

/** Longest `from` kept. A record opened from a record opened from a list nests
 *  its `from`; past this the innermost link is dropped rather than the page. */
export const FROM_MAX_LENGTH = 1500

/** How many lists deep the trail is rebuilt. */
export const FROM_MAX_DEPTH = 3

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'

/** Record pages that keep the list they were opened from. */
const DETAIL = new RegExp(`^/admin/(users|jobs|tutors|team-activity)/${UUID}(/edit)?$`, 'i')

export function isAdminDetailPath(pathname: string): boolean {
  return DETAIL.test(pathname)
}

/** A safe same-site admin address (path + query), or null. */
export function safeAdminFrom(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null
  const v = raw.trim()
  if (!v || v.length > FROM_MAX_LENGTH) return null
  if (!v.startsWith('/admin')) return null
  if (v.startsWith('//') || v.includes('\\')) return null
  if (/[\u0000-\u001f\u007f]/.test(v)) return null
  // "/administrator" is not /admin.
  const rest = v.slice('/admin'.length)
  if (rest && !/^[/?#]/.test(rest)) return null
  if (/%2f%2f|%5c/i.test(v)) return null
  return v.split('#')[0]
}

/** Split an address into its path and its query (without the "?"). */
export function splitUrl(url: string): { path: string; query: string } {
  const noHash = url.split('#')[0]
  const i = noHash.indexOf('?')
  return i < 0 ? { path: noHash, query: '' } : { path: noHash.slice(0, i), query: noHash.slice(i + 1) }
}

/** The `from` an address carries, checked; null when it has none. */
export function fromOf(url: string): string | null {
  const { query } = splitUrl(url)
  if (!query) return null
  return safeAdminFrom(new URLSearchParams(query).get(FROM_PARAM))
}

/** The address with its `from` removed. */
export function withoutFrom(url: string): string {
  const { path, query } = splitUrl(url)
  if (!query) return path
  const sp = new URLSearchParams(query)
  sp.delete(FROM_PARAM)
  const s = sp.toString()
  return s ? `${path}?${s}` : path
}

/**
 * The record address to open, given the address of the page it is opened FROM.
 *
 *   • Opened from a list → `?from=<the list's address>`.
 *   • A link on a record to the SAME record (a timeline tab) keeps that record's
 *     own `from`, so changing a tab does not lose the way back.
 *   • A `from` that would be too long drops its innermost list.
 *   • Not a record page, or the current page is not admin → unchanged.
 */
export function withFrom(targetHref: string, currentUrl: string): string {
  const target = splitUrl(targetHref)
  if (!isAdminDetailPath(target.path)) return targetHref
  const cur = splitUrl(currentUrl)
  if (!cur.path.startsWith('/admin')) return targetHref
  const sp = new URLSearchParams(target.query)
  if (sp.has(FROM_PARAM)) return targetHref

  let from: string | null
  if (cur.path === target.path) {
    from = fromOf(currentUrl)
  } else {
    from = safeAdminFrom(currentUrl) ?? null
    if (from && from.length > FROM_MAX_LENGTH / 2) from = safeAdminFrom(withoutFrom(currentUrl))
  }
  if (!from) return targetHref
  sp.set(FROM_PARAM, from)
  const hash = targetHref.includes('#') ? targetHref.slice(targetHref.indexOf('#')) : ''
  return `${target.path}?${sp.toString()}${hash}`
}

export type FromCrumb = { label: string; href?: string }

/**
 * The trail for a page opened from a list: the list's trail (the list crumb
 * linking back to its full address) followed by this page. `fromTrail` is the
 * list page's own trail, already built; `pageLabel` this page's label.
 */
export function joinTrail(fromTrail: FromCrumb[], fromUrl: string, pageLabel: string): FromCrumb[] {
  if (fromTrail.length === 0) return [{ label: pageLabel }]
  const head = fromTrail.slice(0, -1)
  const last = fromTrail[fromTrail.length - 1]
  return [...head, { label: last.label, href: fromUrl }, { label: pageLabel }]
}

/**
 * The whole trail for an admin address. `baseTrail(path)` is the address's own
 * section trail (lib/adminNav adminTrail with its looked-up label). A record
 * opened from a list gets the list's trail — built the same way, up to
 * FROM_MAX_DEPTH lists deep — with this record on the end.
 */
export async function trailFor(
  url: string,
  baseTrail: (path: string) => FromCrumb[] | Promise<FromCrumb[]>,
  depth = 0,
): Promise<FromCrumb[]> {
  const { path } = splitUrl(url)
  const base = await baseTrail(path)
  const from = depth < FROM_MAX_DEPTH && isAdminDetailPath(path) ? fromOf(url) : null
  if (!from || base.length === 0) return base
  const parent = await trailFor(from, baseTrail, depth + 1)
  return joinTrail(parent, from, base[base.length - 1].label)
}
