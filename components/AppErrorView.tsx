'use client'
import { RotateCcw, MessageCircle } from 'lucide-react'

import Link from 'next/link'
import { useEffect } from 'react'
import ErrorShell from '@/components/ErrorShell'
import { supportWhatsappHref } from '@/lib/errorMessages'

// An unhandled error inside the app shell — the body of every error boundary
// on the site.
//
// Two files render it: app/(site)/error.tsx, which gets the header and footer
// from the site group's layout, and app/error.tsx, which catches everything
// outside that group (/admin, and the root layout itself).
//
// The digest is shown because it is the only thing that connects what the
// member saw to what the server logged. Without it a support conversation is
// "it broke" against a log of thousands of requests. The error MESSAGE is not
// shown: in production Next replaces it with a generic string anyway, and in
// development printing a stack trace into the page teaches nobody anything the
// terminal is not already saying more clearly.

export default function AppErrorView({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[app error]', error)
  }, [error])

  return (
    <ErrorShell
      title="Something went wrong at our end"
      message="Please try again. If it keeps happening, contact us on WhatsApp."
      detail={
        <div className="space-y-2">
          <p lang="ur" dir="rtl" className="text-sm leading-relaxed text-slate-700">
            براہ کرم دوبارہ کوشش کریں۔ اگر یہ مسئلہ بار بار ہو تو واٹس ایپ پر ہم سے رابطہ کریں۔
          </p>
          <div className="space-y-2 pt-2">
            <button
              type="button"
              onClick={reset}
              className="inline-flex min-h-[44px] w-full items-center justify-center gap-1.5 rounded-xl bg-tm-navy px-4 text-xs font-bold text-white transition-colors hover:bg-tm-navy-hover"
            >
              <RotateCcw aria-hidden size={14} />
              Try again
            </button>
            <a
              href={supportWhatsappHref(error.digest)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-[44px] w-full items-center justify-center gap-1.5 rounded-xl border border-gray-200 px-4 text-xs font-bold text-tm-navy transition-colors hover:border-tm-navy"
            >
              <MessageCircle aria-hidden size={14} />
              Contact support on WhatsApp
            </a>
          </div>
          <Link
            href="/"
            className="inline-flex min-h-[44px] items-center justify-center text-xs font-bold text-tm-navy underline-offset-2 hover:underline"
          >
            Go to the homepage
          </Link>
          {error.digest && (
            <p className="text-[11px] text-gray-500">
              Reference: <span className="font-mono">{error.digest}</span>
            </p>
          )}
        </div>
      }
      actions={[]}
    />
  )
}
