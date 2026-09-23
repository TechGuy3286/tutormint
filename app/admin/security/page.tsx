import { redirect } from 'next/navigation'

import { getAdminActor } from '@/lib/adminAuth'
import { hasVerifiedFactor, backupCodesLeft } from '@/lib/adminMfa'
import MfaSelfService from '@/components/admin/MfaSelfService'

// Every staff member's own two-factor screen (PR50 §2). Any admin role can open
// it — there is no SCREEN_ACCESS gate, because it only ever touches the caller's
// OWN account (the routes it calls are self-scoped). It is where an operations
// or admin account that never sees the Team page turns two-factor on, sees
// whether it is on, and makes fresh backup codes.

export const dynamic = 'force-dynamic'

export default async function AdminSecurityPage() {
  const actor = await getAdminActor()
  if (!actor) redirect('/')

  const [enrolled, backupLeft] = await Promise.all([
    hasVerifiedFactor(actor.id),
    backupCodesLeft(actor.id),
  ])

  return (
    <div className="max-w-xl space-y-4">
      <MfaSelfService enrolled={enrolled} backupLeft={backupLeft} />
    </div>
  )
}
