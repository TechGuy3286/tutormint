import Link from 'next/link'
import { GraduationCap, Briefcase } from 'lucide-react'

import { liveLandingPages } from '@/lib/landing'

// The landing pages a post is linked to.
//
// The author picks these in the editor from the live landing set; here they are
// resolved against that set AGAIN at render, so a page that has since dropped
// below the threshold simply is not shown rather than linking somewhere that
// now 404s. This is how "a subject or city mention links through the landing
// helper" is realised on a post — through the picker, not by scanning prose,
// because a mislinked auto-detected word is worse than none.

export default async function RelatedLanding({ paths }: { paths: string[] }) {
  if (!paths || paths.length === 0) return null

  const live = await liveLandingPages()
  const byPath = new Map(live.map((p) => [`${p.kind}/${p.citySlug}/${p.subjectSlug}`, p]))

  const resolved = paths
    .map((p) => byPath.get(p.replace(/^\//, '')))
    .filter((p): p is NonNullable<typeof p> => !!p)

  if (resolved.length === 0) return null

  return (
    <nav aria-label="Related directory pages" className="rounded-2xl border border-gray-200 bg-white p-4">
      <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-gray-500">
        Browse verified listings
      </p>
      <ul className="flex flex-wrap gap-2">
        {resolved.map((p) => (
          <li key={`${p.kind}/${p.citySlug}/${p.subjectSlug}`}>
            <Link
              href={`/${p.kind}/${p.citySlug}/${p.subjectSlug}`}
              className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-gray-200 bg-tm-bg px-3 text-[11px] font-semibold text-tm-navy hover:border-tm-navy"
            >
              {p.kind === 'tutors' ? (
                <GraduationCap aria-hidden size={12} />
              ) : (
                <Briefcase aria-hidden size={12} />
              )}
              {p.subjectName} · {p.city}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  )
}
