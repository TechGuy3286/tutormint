import { redirect } from 'next/navigation'

// Flagged messages is now a tab of Trust → Reports & flags (owner, 15 Oct
// 2026). The old address redirects there; the page it lands on checks the role.

export const dynamic = 'force-dynamic'

export default function FlagsMoved() {
  redirect('/admin/reports?tab=flags')
}
