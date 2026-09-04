import { List, Search } from 'lucide-react'
import Link from 'next/link'
import { headers } from 'next/headers'

import { cityFromSegment } from '@/lib/slugs'

// A tuition that is closed, filled, or was never real.
//
// A REAL 404, AND NO EXTRA DATABASE READ. This replaces a page that answered
// 200 with a "this tuition has closed" body, and before that a 410 served from
// proxy.ts at the cost of a round trip on every tuition request. notFound() is
// the one interrupt that carries a status, and 404 is the honest answer for an
// address that no longer serves anything — so the status, the body and the
// query count come out right at once.
//
// It also drops the second query. Telling "closed" from "filled" from "never
// existed" meant asking job_page_status() after the first query had already
// come back empty, and all three answers led to this page.
//
// A SERVER COMPONENT, AND IT HAS TO BE. A nested not-found.tsx that renders any
// Client Component is SILENTLY IGNORED in Next 16.3 — the parent boundary
// renders instead, with no warning in the log. Verified three ways: a server
// component here renders; a client one, colocated or imported from
// components/, does not. So usePathname() is not available, and a not-found
// boundary takes no props and cannot read route params either.
//
// Hence the header. proxy.ts puts the URL's city segment on /tuitions/*
// requests and nothing else — no database read, the city is already in the
// path. See the note there for why this is not the stale-path bug that the
// same file's previous header was.

export default async function TuitionNotFound() {
  const city = cityFromSegment((await headers()).get('x-tm-tuition-city'))

  return (
    <main className="mx-auto w-full max-w-3xl p-4 sm:p-6">
      <section className="space-y-3 rounded-2xl border border-gray-200 bg-white p-6 text-center sm:p-8">
        <h1 className="text-xl font-black text-tm-navy sm:text-2xl">This tuition has closed</h1>
        <p className="mx-auto max-w-md text-sm leading-relaxed text-slate-700">
          This tuition has closed or is no longer available. The parent has finished hiring.
        </p>
        <p className="mx-auto max-w-md text-sm leading-relaxed text-slate-700">
          New tuitions are posted every day{city ? ` in ${city}` : ''}, and applying is free.
        </p>
        <div className="flex flex-col items-center gap-2 pt-1 sm:flex-row sm:justify-center">
          <Link
            href={city ? `/browse/tuitions?city=${encodeURIComponent(city)}` : '/browse/tuitions'}
            className="gap-1.5 inline-flex min-h-[44px] items-center justify-center rounded-xl bg-tm-black px-5 text-xs font-bold text-white transition-colors hover:bg-slate-700"
          >
            <Search aria-hidden size={14} />
            Find similar tuitions
          </Link>
          <Link
            href="/browse/tuitions"
            className="gap-1.5 inline-flex min-h-[44px] items-center justify-center rounded-xl border border-gray-200 px-5 text-xs font-bold text-tm-navy transition-colors hover:border-tm-navy"
          >
            <List aria-hidden size={14} />
            All tuitions in Pakistan
          </Link>
        </div>
      </section>
    </main>
  )
}
