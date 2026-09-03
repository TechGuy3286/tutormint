import { headers } from 'next/headers'

import { PREVIEW_MODE, PREVIEW_NOTICE } from '@/lib/preview'

// The preview notice.
//
// QUIET ON PURPOSE. It is a thin tinted strip under the header, not a modal,
// not a dismissible toast and not a coloured alert: a visitor should be able to
// read it once and then ignore it while they browse. An urgent-looking banner
// on every page teaches people to look past banners, which is a thing worth
// still having later.
//
// Not dismissible, and that is deliberate too: a dismissed banner means the
// next visitor on the same laptop is not told, and the whole reason it exists
// is that somebody arriving cold should know what they are looking at.
//
// It renders wherever the site header renders — one place, so it cannot go
// missing from a page somebody adds next month. /admin is the exception,
// because admin is not a public page and its own bar is the chrome there.

export default async function PreviewBanner() {
  if (!PREVIEW_MODE) return null

  const path = (await headers()).get('x-tm-pathname') ?? ''
  if (path === '/admin' || path.startsWith('/admin/')) return null

  return (
    <p
      role="status"
      className="border-b border-tm-gold/30 bg-tm-tint-gold px-4 py-2 text-center text-[11px] font-semibold leading-relaxed text-tm-gold-ink sm:px-12"
    >
      {PREVIEW_NOTICE}
    </p>
  )
}
