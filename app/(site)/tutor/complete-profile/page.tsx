import { getSupportContact, whatsappHref } from '@/lib/support'
import CompleteProfileClient from './CompleteProfileClient'

// The tutor completion flow. A server component only so it can read the support
// contact (app_settings + env, never hardcoded) and hand it to the client — the
// Mobile step needs the SAME WhatsApp/email fallback /verify-phone has, so a
// tutor who cannot receive a code is never stuck at a dead end mid-completion.
// Everything interactive lives in CompleteProfileClient.

export const dynamic = 'force-dynamic'

export default async function CompleteProfilePage() {
  const support = await getSupportContact()
  const waHref = whatsappHref(
    support.whatsapp,
    "Assalam-o-Alaikum, I can't verify my mobile number on TutorMint while completing my profile. Please help.",
  )

  return <CompleteProfileClient support={{ waHref, email: support.email }} />
}
