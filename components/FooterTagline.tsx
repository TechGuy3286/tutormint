'use client'

import { usePathname } from 'next/navigation'
import { SITE_TAGLINE } from '@/lib/siteIdentity'

// The footer's brand tagline — rendered on every page EXCEPT the homepage.
//
// The homepage's locked hero already carries its own line ("Free to Join · Verified
// Tutors · Contact Directly · Live Demo" since PR-12), so the footer does not
// repeat the tagline there. Every other page carries SITE_TAGLINE here.
//
// This is a CLIENT component reading usePathname() ON PURPOSE. The Footer is a
// server component in the (site) layout, and that layout is NOT re-rendered on a
// client navigation between (site) routes — so a headers()-based path read there
// goes stale (the exact bug SiteChrome documents). usePathname updates on every
// navigation, so the line correctly appears and disappears as the route changes.
export default function FooterTagline() {
  const pathname = usePathname()
  if (pathname === '/') return null
  return (
    <p className="mt-2 max-w-xs text-xs leading-snug text-slate-400">
      {SITE_TAGLINE}
    </p>
  )
}
