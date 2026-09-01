'use client'

import { useState } from 'react'
import { ChevronDown } from 'lucide-react'

export type FaqItem = { q: string; a: string }
export type FaqGroup = { id: string; title: string; items: FaqItem[] }

// The FAQ accordion.
//
// Built on <details>/<summary> rather than a div with an onClick: it is
// keyboard-operable, screen-reader-announced and expandable by the browser's
// own find-in-page for free, and it still works if the JavaScript never
// arrives. The only client state is the filter box.
//
// Every answer is in the HTML whether or not its section is open, so the page
// is a real search-engine surface — "why can't I hire on TutorMint" should find
// this page, not a support ticket.

export default function FaqList({ groups }: { groups: FaqGroup[] }) {
  const [query, setQuery] = useState('')

  const needle = query.trim().toLowerCase()
  const filtered = needle
    ? groups
        .map((g) => ({
          ...g,
          items: g.items.filter(
            (i) => i.q.toLowerCase().includes(needle) || i.a.toLowerCase().includes(needle),
          ),
        }))
        .filter((g) => g.items.length > 0)
    : groups

  return (
    <div className="space-y-5">
      <div>
        <label htmlFor="faq-search" className="sr-only">
          Search the questions
        </label>
        <input
          id="faq-search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search — refunds, verification, hiring…"
          className="min-h-[44px] w-full rounded-2xl border border-gray-200 bg-white px-4 text-sm outline-none focus:border-[#0F172A]"
        />
      </div>

      {filtered.length === 0 && (
        <div className="space-y-2 rounded-2xl border border-gray-200 bg-white p-6 text-center">
          <p className="text-sm font-bold text-[#0F172A]">Nothing matches “{query}”</p>
          <p className="text-xs leading-relaxed text-gray-500">
            Try a single word — “refund”, “video”, “hire”, “CNIC” — or message us and we will answer
            it directly.
          </p>
        </div>
      )}

      {filtered.map((group) => (
        <section key={group.id} className="space-y-2">
          <h2 className="text-xs font-black uppercase tracking-wide text-gray-400">
            {group.title}
          </h2>
          <ul className="space-y-2">
            {group.items.map((item) => (
              <li key={item.q}>
                <details className="group rounded-2xl border border-gray-200 bg-white [&_summary::-webkit-details-marker]:hidden">
                  <summary className="flex min-h-[44px] cursor-pointer list-none items-center justify-between gap-3 p-4 text-sm font-bold text-[#0F172A]">
                    <span className="min-w-0 flex-1">{item.q}</span>
                    <ChevronDown
                      size={18}
                      className="shrink-0 text-gray-400 transition-transform group-open:rotate-180"
                      aria-hidden
                    />
                  </summary>
                  <p className="px-4 pb-4 text-sm leading-relaxed text-[#334155]">{item.a}</p>
                </details>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
