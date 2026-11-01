import { permanentRedirect } from 'next/navigation'

import { RETIRED_ADMIN_PAGES } from '@/lib/retiredAdminCore'

// Retired on 31 Oct 2026 (owner-approved): off the sidebar and every screen;
// its data is kept. Old links land on the address in lib/retiredAdminCore.
export default function RetiredPage() {
  permanentRedirect(RETIRED_ADMIN_PAGES['/admin/team-activity/claims'])
}
