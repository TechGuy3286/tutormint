// components/WhatsAppBubble.tsx
//
// The floating WhatsApp button from design/reference/homepage.png.
//
// Rendered on the homepage only, not from the root layout. A fixed element
// pinned to the bottom-right of every page would sit on top of the sticky
// mobile action bars the dashboards use for Apply / Post Job / Send Message --
// covering a primary action with a support link is a bad trade on exactly the
// screens where the primary action matters most.
//
// The number comes from SUPPORT_WHATSAPP. With nothing configured the bubble
// does not render at all: a wa.me link with no number opens a dead chat, and a
// member who taps it believes they have asked for help.

import { supportContactFromEnv, whatsappHref } from '@/lib/support'

export default function WhatsAppBubble() {
  const { whatsapp } = supportContactFromEnv()
  const href = whatsappHref(whatsapp, 'Hi TutorMint — I need help finding a tutor.')
  if (!href) return null

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Chat with TutorMint on WhatsApp"
      className="fixed bottom-5 right-5 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-tm-green-deep text-white shadow-lg transition-colors hover:bg-tm-green-deep-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tm-green-deep"
    >
      {/* WhatsApp's glyph has no lucide equivalent, so it is inline SVG. */}
      <svg
        aria-hidden
        viewBox="0 0 24 24"
        fill="currentColor"
        className="h-7 w-7"
      >
        <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38a9.86 9.86 0 0 0 4.79 1.22h.01c5.46 0 9.91-4.45 9.91-9.91C21.96 6.45 17.5 2 12.04 2Zm0 18.15h-.01a8.2 8.2 0 0 1-4.19-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.19 8.19 0 0 1-1.26-4.38c0-4.54 3.7-8.24 8.25-8.24 2.2 0 4.27.86 5.83 2.42a8.19 8.19 0 0 1 2.41 5.83c0 4.54-3.7 8.23-8.24 8.23Zm4.52-6.16c-.25-.12-1.47-.72-1.69-.81-.23-.08-.39-.12-.56.13-.16.24-.64.8-.78.97-.15.16-.29.18-.53.06-.25-.12-1.05-.39-1.99-1.23-.74-.66-1.24-1.47-1.38-1.72-.15-.25-.02-.38.1-.5.11-.11.25-.29.37-.44.13-.15.17-.25.25-.41.08-.17.04-.31-.02-.43-.06-.12-.56-1.34-.76-1.84-.2-.48-.41-.42-.56-.43h-.48c-.16 0-.43.06-.65.31-.23.25-.86.84-.86 2.05s.88 2.38 1 2.54c.13.17 1.74 2.65 4.21 3.72.59.25 1.05.4 1.4.52.59.19 1.13.16 1.55.1.47-.07 1.47-.6 1.67-1.18.21-.58.21-1.07.15-1.18-.06-.1-.23-.16-.48-.28Z" />
      </svg>
    </a>
  )
}
