import { permanentRedirect } from 'next/navigation'

import { RETIRED_ADMIN_PAGES } from '@/lib/retiredAdminCore'

// Featured WhatsApp was retired on 31 Oct 2026 (owner-approved): its Overview
// list ("Featured tutors with new matches") is off the Overview; its data is kept.
export default function RetiredPage() {
  permanentRedirect(RETIRED_ADMIN_PAGES['/admin/overview/todo-featured'])
}
