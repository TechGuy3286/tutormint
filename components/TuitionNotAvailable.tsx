import Link from 'next/link'
import { NOT_AVAILABLE_MESSAGE } from '@/lib/contactWithdrawCore'
import { citySegment } from '@/lib/slugs'

// The page of a tuition paused on a contact complaint (owner, 27 Oct 2026). It
// stays at its address and says only that it is not available: no title, no
// description, no contact line, no JobPosting (the page metadata is noindex).
// Onward links keep it from being a dead end.
export default function TuitionNotAvailable({ city }: { city: string | null }) {
  const c = (city ?? '').trim()
  return (
    <main className="mx-auto max-w-2xl space-y-4 px-4 py-12 text-center" data-tuition-not-available="">
      <h1 className="text-2xl font-black text-tm-navy">{NOT_AVAILABLE_MESSAGE}</h1>
      <p className="text-sm text-gray-600">You can find other tuitions below.</p>
      <div className="flex flex-wrap justify-center gap-2">
        {c && (
          <Link href={`/tuition-jobs/${citySegment(c)}`} className="inline-flex min-h-11 items-center rounded-xl bg-tm-navy px-4 text-sm font-bold text-white hover:bg-tm-navy-hover">
            Tuitions in {c}
          </Link>
        )}
        <Link href="/browse/tuitions" className="inline-flex min-h-11 items-center rounded-xl border border-gray-300 px-4 text-sm font-bold text-slate-700 hover:border-tm-navy">
          Browse tuitions
        </Link>
      </div>
    </main>
  )
}
