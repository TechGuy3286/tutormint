'use client'

import { useEffect } from 'react'
import ErrorShell from '@/components/ErrorShell'

// An unhandled error inside the app shell.
//
// The digest is shown because it is the only thing that connects what the
// member saw to what the server logged. Without it a support conversation is
// "it broke" against a log of thousands of requests. The error MESSAGE is not
// shown: in production Next replaces it with a generic string anyway, and in
// development printing a stack trace into the page teaches nobody anything the
// terminal is not already saying more clearly.

export default function Error({
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
      message="This is our fault, not yours. Nothing you had saved has been lost — try again, and if it keeps happening let us know."
      detail={
        <div className="space-y-2">
          <button
            type="button"
            onClick={reset}
            className="min-h-[44px] w-full rounded-xl bg-tm-black px-4 text-xs font-bold uppercase tracking-wider text-white transition-colors hover:bg-slate-700"
          >
            Try again
          </button>
          {error.digest && (
            <p className="text-[11px] text-gray-500">
              Reference: <span className="font-mono">{error.digest}</span>
            </p>
          )}
        </div>
      }
      actions={[
        { label: 'Get help', href: '/support', tone: 'quiet' },
        { label: 'Go to the homepage', href: '/', tone: 'quiet' },
      ]}
    />
  )
}
