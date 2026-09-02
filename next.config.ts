import type { NextConfig } from 'next'

// Security headers, and the apex-to-www redirect.
//
// ---------------------------------------------------------------------------
// A HONEST NOTE ABOUT THE CSP
//
// script-src carries 'unsafe-inline'. That is not where a Content-Security-
// Policy wants to end up, and it is worth saying why it is here rather than
// letting a future reader assume it was an oversight.
//
// Next's App Router emits inline bootstrap and flight-data scripts on every
// page. Allowing them needs either a per-request nonce -- which means
// generating one in proxy.ts, threading it through every rendered page, and
// accepting that any inline script anyone adds later silently stops working --
// or 'unsafe-inline'. The nonce route is the correct destination and is a
// change worth making on its own, with its own testing, not bundled into a
// hardening pass alongside eleven other things.
//
// What this policy DOES stop, today, with 'unsafe-inline' in place:
//   * loading a script from any origin we have not named. That is the step an
//     XSS payload needs in order to become a data-exfiltration tool.
//   * connecting to any origin we have not named -- so a token read out of
//     browser storage has nowhere to be sent.
//   * framing the site (clickjacking), and being framed by anything.
//   * submitting a form to another origin.
//
// So it is a real control with a known gap, not security theatre. The gap is
// on the T8b list.
// ---------------------------------------------------------------------------

/** The Supabase project host, derived rather than hardcoded. */
function supabaseHost(): string {
  const raw = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!raw) return 'https://*.supabase.co'
  try {
    return new URL(raw).origin
  } catch {
    return 'https://*.supabase.co'
  }
}

function contentSecurityPolicy(): string {
  const supabase = supabaseHost()
  // The realtime socket lives on the same host over wss.
  const supabaseWs = supabase.replace(/^https:/, 'wss:')

  const directives: Record<string, string[]> = {
    'default-src': ["'self'"],

    // See the note above. 'unsafe-eval' is development only -- React Refresh
    // needs it, and it must never reach a built deployment.
    //
    // This one stays on NODE_ENV rather than lib/env.ts's isProduction(), and
    // deliberately: the question here is "was this compiled by `next build`",
    // not "is this the live site". A Vercel preview is a real build with no
    // React Refresh, so it neither needs 'unsafe-eval' nor should have it. The
    // security headers stay production-grade on preview -- only the test
    // conveniences relax.
    'script-src': [
      "'self'",
      "'unsafe-inline'",
      ...(process.env.NODE_ENV === 'production' ? [] : ["'unsafe-eval'"]),
    ],

    // Tailwind and the inline styles in the email-preview and error pages.
    'style-src': ["'self'", "'unsafe-inline'"],

    'img-src': [
      "'self'",
      'data:',
      'blob:',
      supabase, // avatars, ad creatives and document previews
      'https://i.ytimg.com', // YouTube thumbnails
    ],

    'font-src': ["'self'", 'data:'],

    // Where the browser may talk to. Resend and Twilio are absent on purpose:
    // those are called from the server, and an API key that a browser could
    // reach would be an API key that has already leaked.
    'connect-src': ["'self'", supabase, supabaseWs],

    // Verification videos.
    'frame-src': ['https://www.youtube.com', 'https://www.youtube-nocookie.com'],

    'media-src': ["'self'", supabase, 'blob:'],

    'object-src': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
    'frame-ancestors': ["'none'"],
    'upgrade-insecure-requests': [],
  }

  return Object.entries(directives)
    .map(([k, v]) => (v.length ? `${k} ${v.join(' ')}` : k))
    .join('; ')
}

const nextConfig: NextConfig = {
  async redirects() {
    return [
      {
        source: '/:path*',
        has: [{ type: 'host', value: 'tutormint.org' }],
        destination: 'https://www.tutormint.org/:path*',
        permanent: true,
      },
    ]
  },

  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: contentSecurityPolicy() },

          // Redundant with frame-ancestors above, and kept because older
          // browsers honour this and ignore the CSP directive.
          { key: 'X-Frame-Options', value: 'DENY' },

          { key: 'X-Content-Type-Options', value: 'nosniff' },

          // Send the full URL within our own site, only the origin off-site.
          // A tutor profile URL contains their slug; an outbound click should
          // not tell a third party which profile the visitor came from.
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },

          // Nothing on TutorMint needs any of these. Denying them means an
          // injected script cannot ask for them either.
          {
            key: 'Permissions-Policy',
            value: [
              'camera=()',
              'microphone=()',
              'geolocation=()',
              'payment=()',
              'usb=()',
              'magnetometer=()',
              'gyroscope=()',
              'accelerometer=()',
              'interest-cohort=()',
            ].join(', '),
          },

          // Two years, subdomains included. Only meaningful over HTTPS, which
          // Vercel terminates; harmless in development where nothing is served
          // over TLS to honour it.
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },

          // Cross-origin isolation for the document itself. Ads and YouTube
          // embeds are unaffected -- both are iframes, not popups.
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
        ],
      },
    ]
  },
}

export default nextConfig
