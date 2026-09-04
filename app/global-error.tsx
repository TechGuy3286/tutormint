'use client'


import { BRAND, NEUTRAL } from '@/lib/brand'

// The last resort: an error in the root layout itself.
//
// This replaces <html> and <body>, so nothing from the app is available — not
// the layout, not globals.css, not the Navbar. Every style here is inline for
// that reason, and there is no import of ErrorShell: a component that failed to
// render is not the thing to reach for while handling the failure.
//
// If this page is ever seen in production, something is badly wrong. It still
// gives the visitor a way out rather than a white screen.

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: BRAND.bg,
          color: NEUTRAL.slate700,
          fontFamily:
            "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
          padding: '16px',
        }}
      >
        <div
          style={{
            width: '100%',
            maxWidth: '420px',
            background: BRAND.white,
            border: `1px solid ${NEUTRAL.gray200}`,
            borderRadius: '24px',
            padding: '28px 24px',
            textAlign: 'center',
          }}
        >
          <p style={{ margin: '0 0 18px', fontSize: '20px', fontWeight: 900, color: BRAND.navy }}>
            Tutor<span style={{ color: BRAND.red }}>Mint</span>
          </p>
          <h1 style={{ margin: '0 0 10px', fontSize: '18px', fontWeight: 800, color: BRAND.navy }}>
            The site failed to load
          </h1>
          <p style={{ margin: '0 0 20px', fontSize: '14px', lineHeight: 1.6 }}>
            Something went wrong before the page could start. Reloading usually fixes it.
          </p>

          <button
            type="button"
            onClick={reset}
            style={{
              display: 'block',
              width: '100%',
              minHeight: '44px',
              background: BRAND.red,
              color: BRAND.white,
              border: 'none',
              borderRadius: '12px',
              fontSize: '12px',
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              cursor: 'pointer',
            }}
          >
            Reload
          </button>

          <p style={{ margin: '14px 0 0', fontSize: '12px' }}>
            <a href="/" style={{ color: BRAND.red, fontWeight: 700 }}>
              Go to the homepage
            </a>
          </p>

          {error.digest && (
            <p style={{ margin: '12px 0 0', fontSize: '11px', color: NEUTRAL.slate400 }}>
              Reference: {error.digest}
            </p>
          )}
        </div>
      </body>
    </html>
  )
}
