'use client'

import { usePathname } from 'next/navigation'

// The footer's brand tagline — rendered on every page EXCEPT the homepage.
//
// The homepage's locked, partner-approved hero already carries "No Fee · No
// Commission · No Middleman", so repeating it in the footer would put the word
// "commission" on the page twice — one more than the brand rule allows (owner,
// 10 Sep 2026). Every other page has no such line in its body, so the footer
// carries it there.
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
      Pakistan&rsquo;s Largest 100% Verified Tutors Network. No fee. No commission. No middleman.
    </p>
  )
}
