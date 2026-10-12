import { faqJsonLd, jsonLdScript } from '@/lib/seo'
import type { Faq } from '@/lib/hubCopy'

// The three questions and answers on a hub page (owner, 12 Oct 2026), with the
// FAQPage structured data built from the SAME array, so the two cannot differ.
// Rendered only by pages that clear their threshold; native <details>, so it
// needs no JavaScript.

export default function HubFaq({ items, path }: { items: Faq[]; path: string }) {
  if (items.length === 0) return null
  return (
    <section aria-label="Common questions" className="space-y-2 rounded-2xl border border-gray-200 bg-white p-4 sm:p-5">
      <script type="application/ld+json" dangerouslySetInnerHTML={jsonLdScript(faqJsonLd(items, path))} />
      <h2 className="text-sm font-black text-tm-navy">Common questions</h2>
      <div className="divide-y divide-gray-100">
        {items.map((it) => (
          <details key={it.q} className="group py-1">
            <summary className="flex min-h-[44px] cursor-pointer list-none items-center text-xs font-bold text-slate-700 sm:text-sm">
              {it.q}
            </summary>
            <p className="pb-3 text-xs leading-relaxed text-gray-600 sm:text-sm">{it.a}</p>
          </details>
        ))}
      </div>
    </section>
  )
}
