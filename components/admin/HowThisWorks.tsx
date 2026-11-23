import { Info } from 'lucide-react'

// A long admin explanation folded behind a small "How this works ⓘ" link
// (owner, 23 Nov 2026 — PR-19, Applications first). Native <details>: no
// script, works the same on a phone and a desktop, opens in place as a panel.

export default function HowThisWorks({ children, label = 'How this works' }: { children: React.ReactNode; label?: string }) {
  return (
    <details className="group text-xs" data-how-this-works="">
      <summary className="inline-flex min-h-[44px] cursor-pointer list-none items-center gap-1 font-bold text-tm-navy underline underline-offset-2 [&::-webkit-details-marker]:hidden">
        {label} <Info aria-hidden size={14} />
      </summary>
      <div className="mt-1 rounded-xl border border-gray-200 bg-white p-3 leading-relaxed text-slate-700">{children}</div>
    </details>
  )
}
