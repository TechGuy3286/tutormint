import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import { sendReuploadAlert } from '@/lib/payments/paymentAlerts'
import { formatName } from '@/lib/formatName'

// When a tutor re-uploads a document that staff had REJECTED (PR106-H4 §2.7),
// email the Payment-alert address and let the Approval-needed queue surface it.
// "Was rejected" is detected by the lingering rejection REASON — reviewTutorDocument
// clears it only on approval, so a reason still present at upload time means this
// is a re-upload after a rejection (a first upload has no reason). The document
// contents are never read or sent — member name + a link only.

export async function alertIfReupload(userId: string, kind: 'cnic' | 'photo' | 'selfie'): Promise<void> {
  const admin = createAdminClient()
  if (!admin) return
  const { data } = await admin
    .from('profiles')
    .select('full_name, verification_rejection_reason, profile_pic_reason, selfie_reason')
    .eq('id', userId)
    .maybeSingle()
  if (!data) return
  const reason =
    kind === 'cnic'
      ? data.verification_rejection_reason
      : kind === 'photo'
        ? data.profile_pic_reason
        : data.selfie_reason
  if (typeof reason === 'string' && reason.trim().length > 0) {
    await sendReuploadAlert({ memberName: formatName(data.full_name as string | null) || 'A member', memberId: userId })
  }
}
