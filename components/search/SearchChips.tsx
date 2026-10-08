import Link from 'next/link'
import { X } from 'lucide-react'
import { withoutSpan, type Parsed } from '@/lib/smartSearchCore'

// What the smart search read out of the query (owner, 8 Oct 2026), as removable
// chips: "City Sahiwal × · Level Primary × · School Beaconhouse ×". Each × is a
// plain link to the same search with that part's words taken out — no script.

const KIND_LABEL = { city: 'City', level: 'Level', subject: 'Subject', school: 'School' } as const

export default function SearchChips({
  parsed,
  q,
  basePath,
  params,
}: {
  parsed: Parsed | null
  q: string
  basePath: string
  /** The page's other search params, kept on every × link. */
  params: Record<string, string | undefined>
}) {
  if (!parsed || parsed.spans.length === 0 || !q) return null
  const hrefWithout = (text: string) => {
    const next = new URLSearchParams()
    for (const [k, v] of Object.entries(params)) if (v && k !== 'q' && k !== 'page') next.set(k, v)
    const rest = withoutSpan(q, text)
    if (rest) next.set('q', rest)
    const qs = next.toString()
    return qs ? `${basePath}?${qs}` : basePath
  }
  return (
    <ul aria-label="Your search" className="flex flex-wrap items-center gap-1.5">
      {parsed.spans.map((s) => (
        <li key={`${s.kind}:${s.text}`}>
          <Link
            href={hrefWithout(s.text)}
            aria-label={`Remove ${KIND_LABEL[s.kind]} ${s.label}`}
            className="inline-flex min-h-[36px] items-center gap-1 rounded-full border border-tm-navy/30 bg-tm-tint-navy px-3 text-[11px] font-bold text-tm-navy hover:border-tm-navy"
          >
            <span className="font-semibold text-gray-600">{KIND_LABEL[s.kind]}</span>
            {s.label}
            <X aria-hidden size={12} />
          </Link>
        </li>
      ))}
    </ul>
  )
}
