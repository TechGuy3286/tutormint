// lib/utm.ts
//
// Where a member came from.
//
// If Meta ads are the acquisition channel then the question that decides the
// budget is not "how many clicks" — it is which ad brought the tutor who
// actually PAID. That needs the campaign to survive from an anonymous first
// visit, through a signup that may happen days later, to a payment that may
// happen weeks after that.
//
// FIRST TOUCH, and deliberately so. The cookie is written only when it is not
// already there, so a member who arrives from an ad, leaves, and comes back a
// week later through a Google search is still credited to the ad. Last-touch
// would credit the search — which reliably makes brand search look like the
// best-performing channel, because it is where people go once an ad has
// already done its work.
//
// THIRTY DAYS. Long enough to cover a tutor who reads the packages page and
// thinks about it for a fortnight; short enough that a campaign switched off
// two months ago stops taking credit for today's signups.
//
// No third-party pixel is involved. These are four strings from our own URL,
// in our own first-party cookie, read by our own server.

export const UTM_COOKIE = 'tm_utm'
export const UTM_MAX_AGE_SECONDS = 30 * 24 * 60 * 60

export type Utm = {
  utm_source: string | null
  utm_medium: string | null
  utm_campaign: string | null
  utm_content: string | null
}

export const EMPTY_UTM: Utm = {
  utm_source: null,
  utm_medium: null,
  utm_campaign: null,
  utm_content: null,
}

const KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content'] as const

/**
 * Bounded hard. These values are attacker-controlled — anyone can put anything
 * in a query string and send the link to a thousand people — and they end up
 * in a database column and on an admin screen. 120 characters is longer than
 * any campaign name Ads Manager will produce and short enough that the column
 * cannot be used as free storage.
 */
function clean(raw: string | null | undefined): string | null {
  if (!raw) return null
  const v = raw.trim().slice(0, 120)
  return v.length > 0 ? v : null
}

/** The UTM parameters present on a URL, or null when there are none at all. */
export function readUtmFromUrl(url: URL): Utm | null {
  const out: Utm = { ...EMPTY_UTM }
  let any = false
  for (const key of KEYS) {
    const v = clean(url.searchParams.get(key))
    if (v) {
      out[key] = v
      any = true
    }
  }
  return any ? out : null
}

/** Serialise for the cookie. Compact and boring on purpose. */
export function encodeUtm(utm: Utm): string {
  const params = new URLSearchParams()
  for (const key of KEYS) if (utm[key]) params.set(key, utm[key] as string)
  return params.toString()
}

/**
 * Parse the cookie back.
 *
 * Never throws: a truncated or hand-edited cookie means "we do not know where
 * this person came from", which is a perfectly ordinary answer, not an error
 * worth failing a signup over.
 */
export function decodeUtm(raw: string | null | undefined): Utm {
  if (!raw) return { ...EMPTY_UTM }
  try {
    const params = new URLSearchParams(raw)
    const out: Utm = { ...EMPTY_UTM }
    for (const key of KEYS) out[key] = clean(params.get(key))
    return out
  } catch {
    return { ...EMPTY_UTM }
  }
}

/** True when at least one field is known — worth writing to a row. */
export function hasUtm(utm: Utm): boolean {
  return KEYS.some((k) => !!utm[k])
}

/** How it reads on an admin screen. */
export function describeUtm(utm: Partial<Utm> | null | undefined): string | null {
  if (!utm) return null
  const bits = [utm.utm_source, utm.utm_medium, utm.utm_campaign].filter(Boolean)
  if (bits.length === 0) return null
  return bits.join(' · ')
}
