'use client'

import { usePathname } from 'next/navigation'

// Renders its children on every page EXCEPT the homepage (owner, 13 Oct 2026).
// The homepage lists the city tuition-job links itself, so the footer's copy of
// them is left out there and each link appears once. A client component reading
// usePathname() for the same reason as FooterTagline: the footer sits in the
// (site) layout, which is not re-rendered on a client navigation.
export default function HideOnHome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  if (pathname === '/') return null
  return <>{children}</>
}
