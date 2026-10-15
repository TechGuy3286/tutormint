import { redirect } from 'next/navigation'

import { TEAM_ACTIVITY_PATH } from '@/lib/teamActivityCore'

// Moved to Team activity (owner, 15 Oct 2026).

export default function ClaimsMoved() {
  redirect(`${TEAM_ACTIVITY_PATH}/claims`)
}
