// lib/socialLinksCore.ts
//
// "Send social links" on a paid tutor's member page (owner, 31 Oct 2026) — the
// PURE half (scripts/test-push1.ts). Staff send the tutor one WhatsApp message
// listing TutorMint's social pages. The pages come from the SOCIAL_* settings
// (lib/siteIdentity socialProfiles — the same values the footer and the
// Organization structured data use), one line per page that is set, so an
// unset page never appears. The message is the editable template
// `social_links` (Team inbox → Templates → Social links).

export const SOCIAL_LINKS_TEMPLATE_KEY = 'social_links'
export const SOCIAL_LINKS_FOLLOW_UP_SOURCE = 'social_links'
export const SOCIAL_LINKS_PLACEHOLDERS = ['first_name', 'social_links', 'support_whatsapp'] as const

export const SOCIAL_LINKS_DEFAULT =
  'Assalam o Alaikum {first_name},\nThank you for joining TutorMint. Follow us for new tuitions and tips:\n{social_links}\n\nNeed help? WhatsApp {support_whatsapp}'

export type SocialPlatform = 'facebook' | 'instagram' | 'youtube' | 'tiktok' | 'x'

/** In the order the message lists them. */
export const SOCIAL_PLATFORMS: { key: SocialPlatform; label: string; env: string; refOk: boolean }[] = [
  // refOk: the page opens normally with a ?ref=… on the end. Instagram's app
  // links are the exception — an unknown parameter can stop the app opening the
  // profile — so Instagram is sent clean.
  { key: 'facebook', label: 'Facebook', env: 'SOCIAL_FACEBOOK', refOk: true },
  { key: 'instagram', label: 'Instagram', env: 'SOCIAL_INSTAGRAM', refOk: false },
  { key: 'youtube', label: 'YouTube', env: 'SOCIAL_YOUTUBE', refOk: true },
  { key: 'tiktok', label: 'TikTok', env: 'SOCIAL_TIKTOK', refOk: true },
  { key: 'x', label: 'X', env: 'SOCIAL_X', refOk: true },
]

/** The pages that are set: an http(s) address in its SOCIAL_* setting. */
export function socialPagesFrom(env: Record<string, string | undefined>): { key: SocialPlatform; label: string; url: string; refOk: boolean }[] {
  const out: { key: SocialPlatform; label: string; url: string; refOk: boolean }[] = []
  for (const p of SOCIAL_PLATFORMS) {
    const v = (env[p.env] ?? '').trim()
    if (/^https?:\/\//i.test(v)) out.push({ key: p.key, label: p.label, url: v, refOk: p.refOk })
  }
  return out
}

/** Add ?ref=<code> (or &ref=) once, before any #fragment. */
export function withRef(url: string, code: string | null | undefined): string {
  const c = (code ?? '').trim()
  if (!c) return url
  try {
    const u = new URL(url)
    if (u.searchParams.has('ref')) return url
    u.searchParams.set('ref', c)
    return u.toString()
  } catch {
    return url
  }
}

/** One line per page: "Facebook: https://…". */
export function socialLinksBlock(pages: { label: string; url: string; refOk: boolean }[], refCode: string | null | undefined): string {
  return pages.map((p) => `${p.label}: ${p.refOk ? withRef(p.url, refCode) : p.url}`).join('\n')
}

/** The filled message. No emoji anywhere (the template is plain text). */
export function fillSocialLinks(body: string, v: { firstName: string; socialLinks: string; supportWhatsapp: string }): string {
  return body
    .split('{first_name}').join(v.firstName.trim() || 'there')
    .split('{social_links}').join(v.socialLinks)
    .split('{support_whatsapp}').join(v.supportWhatsapp)
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Shown only for a tutor who has paid the Verification Fee. */
export function socialLinksAllowed(t: { role: string | null | undefined; feePaidAt: string | null | undefined }): boolean {
  return t.role === 'tutor' && !!t.feePaidAt
}
