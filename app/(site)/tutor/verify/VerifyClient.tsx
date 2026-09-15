'use client'

import { useRouter } from 'next/navigation'
import type { Gate } from '@/lib/gate'
import TutorVerifyGate from '@/components/upgrade/TutorVerifyGate'

// The page form of the Rs 199 verification flow. Same CNIC + Verify content as
// the apply-gate sheet (one implementation, TutorVerifyGate), reached from the
// account menu, the packages page, and any gate whose href is /tutor/verify. The
// "Not now" action returns to the dashboard rather than closing a sheet.
export default function VerifyClient({ gate }: { gate: Gate }) {
  const router = useRouter()
  return <TutorVerifyGate gate={gate} onClose={() => router.push('/tutor/dashboard')} />
}
