'use client'

import { usePathname } from 'next/navigation'

// The ONE component that decides where the WhatsApp support button appears
// (PR 4 §4) — no page-level copies. It is mounted once in SiteChrome (so it is
// absent from /admin by construction, §4.4).
//
//   §4.1 Logged-OUT visitors, every public page, all sizes → floating button.
//   §4.2 Logged-IN, desktop → NO floating button; WhatsApp lives in the dock's
//        Support tab, so this hides at lg and up.
//   §4.3 Logged-IN, phone → floating button, but hidden on the inbox and chat
//        screens and in the onboarding/verify/payment flow, and LIFTED above any
//        sticky bottom bar (e.g. Apply) so it never covers a control.
//
// The number is resolved server-side (lib/support) and handed in as `href`, so
// nothing is hardcoded here.

const WhatsAppGlyph = () => (
  <svg aria-hidden viewBox="0 0 24 24" fill="currentColor" className="h-7 w-7">
    <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38a9.86 9.86 0 0 0 4.79 1.22h.01c5.46 0 9.91-4.45 9.91-9.91C21.96 6.45 17.5 2 12.04 2Zm0 18.15h-.01a8.2 8.2 0 0 1-4.19-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.19 8.19 0 0 1-1.26-4.38c0-4.54 3.7-8.24 8.25-8.24 2.2 0 4.27.86 5.83 2.42a8.19 8.19 0 0 1 2.41 5.83c0 4.54-3.7 8.23-8.24 8.23Zm4.52-6.16c-.25-.12-1.47-.72-1.69-.81-.23-.08-.39-.12-.56.13-.16.24-.64.8-.78.97-.15.16-.29.18-.53.06-.25-.12-1.05-.39-1.99-1.23-.74-.66-1.24-1.47-1.38-1.72-.15-.25-.02-.38.1-.5.11-.11.25-.29.37-.44.13-.15.17-.25.25-.41.08-.17.04-.31-.02-.43-.06-.12-.56-1.34-.76-1.84-.2-.48-.41-.42-.56-.43h-.48c-.16 0-.43.06-.65.31-.23.25-.86.84-.86 2.05s.88 2.38 1 2.54c.13.17 1.74 2.65 4.21 3.72.59.25 1.05.4 1.4.52.59.19 1.13.16 1.55.1.47-.07 1.47-.6 1.67-1.18.21-.58.21-1.07.15-1.18-.06-.1-.23-.16-.48-.28Z" />
  </svg>
)

export default function SupportWhatsApp({ href, signedIn }: { href: string | null; signedIn: boolean }) {
  const pathname = usePathname() ?? ''

  if (!href) return null
  // Admin is outside the (site) chrome anyway; this is belt-and-braces.
  if (pathname.startsWith('/admin')) return null

  if (signedIn) {
    const inInbox =
      /\/(tutor|parent)\/dashboard\/messages/.test(pathname) ||
      pathname.startsWith('/messages') ||
      pathname.startsWith('/chat')
    const inFlow =
      pathname.startsWith('/tutor/onboarding') ||
      pathname.startsWith('/tutor/complete-profile') ||
      pathname.startsWith('/tutor/verify') ||
      // Settings has its own sticky Save / "Send for checking" buttons the
      // floating button was overlapping (owner PR8 §4.2).
      pathname.startsWith('/tutor/dashboard/settings')
    const inPay = pathname.startsWith('/pay')
    if (inInbox || inFlow || inPay) return null
  }

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Chat with TutorMint support on WhatsApp"
      // Phone: lifted (bottom-24) so it clears a sticky Apply/Post/Send bar.
      // Desktop: lower (bottom-5) for logged-out; hidden for logged-in (the dock
      // carries WhatsApp there, §4.2).
      className={`fixed bottom-24 right-5 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-tm-green-deep text-white shadow-lg transition-colors hover:bg-tm-green-deep-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tm-green-deep lg:bottom-5 ${
        signedIn ? 'lg:hidden' : ''
      }`}
    >
      <WhatsAppGlyph />
    </a>
  )
}
