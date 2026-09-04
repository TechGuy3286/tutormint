import type { Heading } from '@/lib/markdown'

// The table of contents, from the post's H2s (and H3s, indented). Server-
// rendered plain anchor links — no client JavaScript needed to jump, and the
// headings carry scroll-mt so the sticky header does not cover them.
//
// Hidden entirely when a post has fewer than two headings: a one-item contents
// list is noise.

export default function Toc({ headings }: { headings: Heading[] }) {
  if (headings.length < 2) return null

  return (
    <nav aria-label="On this page" className="rounded-2xl border border-gray-200 bg-white p-4">
      <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-gray-500">On this page</p>
      <ul className="space-y-1.5 text-xs">
        {headings.map((h) => (
          <li key={h.id} className={h.level === 3 ? 'pl-3' : ''}>
            <a href={`#${h.id}`} className="text-tm-navy hover:text-tm-red hover:underline">
              {h.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  )
}
