// lib/waLinkCore.ts
//
// PURE, client-safe. Links in every admin pre-filled WhatsApp message (owner,
// 21 Oct 2026):
//   • written in full, https://www.tutormint.org/… — never a bare domain, never
//     without www (WhatsApp only draws a link preview for a full address, and
//     the apex redirects);
//   • ONE link per message, on its own line, so WhatsApp shows the preview.
//
// `finishWaText()` is applied by every wa.me link builder (waLink, adminWaLink,
// followUpWaLink, waMeHref), so a template an admin edited later is fixed the
// same way. A message with several links (the Featured WhatsApp tuition list)
// keeps them where they are; only their address is written in full.
//
// Unit-tested by scripts/test-follow-ups-reasons.ts.

export const WA_SITE = 'https://www.tutormint.org'

/** A site path as a full link: siteLink('/pay/choose') → https://www.tutormint.org/pay/choose. */
export function siteLink(path: string): string {
  const p = path.startsWith('/') ? path : `/${path}`
  return `${WA_SITE}${p === '/' ? '' : p}`
}

// A tutormint.org address in any shape: with or without http(s), with or
// without www. Never part of an email address or a sub-domain such as
// users.tutormint.org (the lookbehind refuses a preceding letter, dot or @).
const SITE_LINK = /(?<![@\w.\/-])(?:https?:\/\/)?(?:www\.)?tutormint\.org(?:\/[^\s<>"']*)?/gi
const TRAILING = /[.,;:!?)\]]+$/

/** The site links in a text, each written in full, in order (duplicates kept). */
export function siteLinksIn(text: string): string[] {
  const out: string[] = []
  for (const m of text.matchAll(SITE_LINK)) out.push(fullLink(m[0]))
  return out
}

function fullLink(raw: string): string {
  const bare = raw.replace(TRAILING, '')
  const path = bare.replace(/^(?:https?:\/\/)?(?:www\.)?tutormint\.org/i, '')
  return `${WA_SITE}${path === '/' ? '' : path}`
}

/** Every site link written as https://www.tutormint.org/… (punctuation after a
 *  link is left where it was). */
export function fullSiteLinks(text: string): string {
  return text.replace(SITE_LINK, (raw) => {
    const tail = raw.match(TRAILING)?.[0] ?? ''
    return fullLink(raw) + tail
  })
}

/**
 * With exactly one distinct site link, put it on its own line:
 *   • already the last thing in the text → "…here:\n<link>";
 *   • in the middle of a sentence → taken out ("continue here: <link>. If…" →
 *     "continue here. If…") and added at the end after a blank line.
 * Texts with no link, or with several different links, are returned unchanged.
 */
export function linkOnOwnLine(text: string): string {
  const links = [...new Set(siteLinksIn(text))]
  if (links.length !== 1) return text
  const link = links[0]
  const lines = text.split('\n')
  if (lines.some((l) => l.trim() === link)) {
    // Already alone on a line — drop any other copies inside sentences.
    return text
  }
  const esc = link.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  // The link is the last thing in the text (only punctuation after it).
  const atEnd = new RegExp(`\\s*${esc}[.!]?\\s*$`)
  if (atEnd.test(text)) return `${text.replace(atEnd, '').replace(/\s+$/, '')}\n${link}`
  // In the middle: remove it with the space (and a colon) before it.
  const mid = new RegExp(`\\s*:?\\s+${esc}`, 'g')
  const body = text
    .replace(mid, '')
    .replace(/ +([.,;!?])/g, '$1')
    .replace(/ {2,}/g, ' ')
    .trim()
  return `${body}\n\n${link}`
}

/** What every admin WhatsApp message goes through before it is sent. */
export function finishWaText(text: string): string {
  return linkOnOwnLine(fullSiteLinks(text.trim()))
}

// ------------------------------------------------- the WhatsApp link itself
//
// Why not https://wa.me/… (owner, 23 Oct 2026): WhatsApp's own wa.me address
// redirects to api.whatsapp.com/send and, on the way, turns EVERY emoji in the
// text into "�" (U+FFFD) — checked on 23 Oct 2026: wa.me/…?text=%F0%9F%99%82
// and …%E2%9C%85 both redirect with text=%EF%BF%BD, while Urdu passes through.
// That is the "�" before "You can continue here:" (the 🙂 in the follow-up
// message). The direct address keeps the text byte for byte, and opens the
// same chat on Android, iPhone, WhatsApp Desktop and WhatsApp Web.

export const WA_SEND_URL = 'https://api.whatsapp.com/send'

/** The text WhatsApp gets: a lone half of an emoji (a surrogate with no
 *  partner) or a "�" is dropped rather than sent; everything else — emoji with
 *  skin tones and joiners, Urdu — is kept exactly. */
export function waSafeText(text: string): string {
  let out = ''
  for (let i = 0; i < text.length; i++) {
    const u = text.charCodeAt(i)
    if (u >= 0xd800 && u <= 0xdbff) {
      const next = text.charCodeAt(i + 1)
      if (next >= 0xdc00 && next <= 0xdfff) {
        out += text[i] + text[i + 1]
        i++
      }
      continue
    }
    if (u >= 0xdc00 && u <= 0xdfff) continue
    if (u === 0xfffd) continue
    out += text[i]
  }
  return out
}

/** At most `max` characters, never cutting an emoji or a letter in half. */
export function safeSlice(text: string, max: number): string {
  const chars = Array.from(text)
  return chars.length <= max ? text : chars.slice(0, max).join('')
}

/**
 * THE pre-filled WhatsApp link (every Follow-ups, Applications, By-tutor and
 * member-page message): https://api.whatsapp.com/send?phone=92…&text=…
 * `msisdn` is digits only (92…); null/empty = no number (WhatsApp then asks
 * who to send it to). The text is not changed here — callers that want links
 * tidied run finishWaText first.
 */
export function waSendHref(msisdn: string | null | undefined, text: string): string {
  const phone = (msisdn ?? '').replace(/\D/g, '')
  const params = [phone ? `phone=${phone}` : '', `text=${encodeURIComponent(waSafeText(text))}`].filter(Boolean)
  return `${WA_SEND_URL}?${params.join('&')}`
}
