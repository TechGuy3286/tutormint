import Link from 'next/link'
import { GraduationCap, Briefcase } from 'lucide-react'

import { liveLandingPages } from '@/lib/landing'
import { rankLandingOptions } from '@/lib/blog'

// The landing pages a post is linked to.
//
// The author picks these in the editor from the live landing set; here they are
// resolved against that set AGAIN at render, so a page that has since dropped
// below the threshold simply is not shown rather than linking somewhere that
// now 404s. This is how "a subject or city mention links through the landing
// helper" is realised on a post — through the picker, not by scanning prose,
// because a mislinked auto-detected word is worse than none.
//
// ORDER (owner, 6 Oct 2026): ranked by match with the post's own city and
// subject — both first, then the subject, then the city — never alphabetically.
// The same rule the editor's picker uses (lib/blog rankLandingOptions).

export default async function RelatedLanding({
  paths,
  city = null,
  subject = null,
}: {
  paths: string[]
  city?: string | null
  subject?: string | null
}) {
  if (!paths || paths.length === 0) return null

  const live = await liveLandingPages()
  const byPath = new Map(live.map((p) => [`${p.kind}/${p.citySlug}/${p.subjectSlug}`, p]))

  const resolved = paths
    .map((p) => byPath.get(p.replace(/^\//, '')))
    .filter((p): p is NonNullable<typeof p> => !!p)

  if (resolved.length === 0) return null

  const ranked = rankLandingOptions(
    resolved.map((p) => ({
      path: `${p.kind}/${p.citySlug}/${p.subjectSlug}`,
      label: `${p.subjectName} · ${p.city}`,
      city: p.city,
      subject: p.subjectName,
      kind: p.kind,
      count: p.count,
      page: p,
    })),
    city,
    subject,
  )

  return (
    <nav aria-label="Related directory pages" className="rounded-2xl border border-gray-200 bg-white p-4">
      <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-gray-500">
        Browse verified listings
      </p>
      <ul className="flex flex-wrap gap-2">
        {ranked.map(({ page: p }) => (
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
