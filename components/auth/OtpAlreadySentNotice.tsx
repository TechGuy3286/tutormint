import Link from 'next/link'
import { supportWhatsappHref } from '@/lib/errorMessages'

// The shared "one code per number" notice (PR93 Part A.2), rendered above the
// shared OtpCodeEntry on every mobile-verification surface. A number receives ONE
// code, ever — there is no resend — so the standing message tells the member to
// use the code they already have, offers the free email-signup path, and gives
// the WhatsApp support link for anyone who never received it. The code entry box
// stays open beneath it so they can type the code.
//
// English with Urdu underneath, matching the shared components' bilingual copy.
export default function OtpAlreadySentNotice({
  emailSignupHref,
}: {
  /** Show "Or sign up with your email instead" (→ /register) — signup surfaces
   *  only; omitted where the member already has an account (Settings). */
  emailSignupHref?: string
}) {
  return (
    <div className="space-y-1.5 rounded-xl border border-tm-navy/15 bg-tm-tint-navy p-3 text-xs text-tm-navy">
      <p className="font-bold">A code was already sent to your mobile. Please use that code.</p>
      <p lang="ur" dir="rtl" className="leading-relaxed text-gray-500">
        آپ کے موبائل پر پہلے ہی ایک کوڈ بھیجا جا چکا ہے۔ براہ کرم وہی کوڈ استعمال کریں۔
      </p>
      <p className="text-[11px] leading-relaxed">
        {emailSignupHref && (
          <>
            <Link href={emailSignupHref} className="font-bold text-tm-red hover:underline">
              Or sign up with your email instead
            </Link>
            {' · '}
          </>
        )}
        Never received it?{' '}
        <a
          href={supportWhatsappHref()}
          target="_blank"
          rel="noopener noreferrer"
          className="font-bold text-tm-red hover:underline"
        >
          WhatsApp support
        </a>
      </p>
    </div>
  )
}
