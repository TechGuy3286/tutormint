import { Link2 } from 'lucide-react'

import CopyButton from '@/components/admin/CopyButton'
import type { MyLinkCounts } from '@/lib/staffSignupsCore'

// The "My link" card, props only (owner, 23 Oct 2026). The loader is
// components/admin/MyLinkCard.tsx; scripts/screenshot-my-link.tsx renders this
// view on its own.

export default function MyLinkCardView({ url, counts, qr }: { url: string; counts: MyLinkCounts; qr: string }) {
  const { last7, last30 } = counts
  const cells: { label: string; d7: number; d30: number }[] = [
    { label: 'Tutor sign-ups', d7: last7.tutors, d30: last30.tutors },
    { label: 'Parent sign-ups', d7: last7.parents, d30: last30.parents },
    { label: 'Tutors who paid', d7: last7.tutorsPaid, d30: last30.tutorsPaid },
  ]
  return (
    <section aria-labelledby="my-link" className="rounded-2xl border border-gray-200 bg-white p-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <div className="min-w-0 flex-1 space-y-2">
          <h2 id="my-link" className="flex items-center gap-1.5 text-sm font-black text-tm-navy">
            <Link2 aria-hidden size={15} /> My link
          </h2>
          <p className="text-xs text-gray-600">
            Share this link. Tutors and parents who join after opening it in the next 30 days are credited to you.
            Links you send from the admin panel carry your code too.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <code className="min-w-0 break-all rounded-lg bg-tm-bg px-2 py-1 text-xs font-bold text-slate-800">{url}</code>
            <CopyButton text={url} label="link" />
          </div>
          <table className="w-full max-w-md text-left text-xs">
            <thead>
              <tr className="text-gray-600">
                <th scope="col" className="py-1 font-bold">Your sign-ups</th>
                <th scope="col" className="py-1 text-right font-bold">Last 7 days</th>
                <th scope="col" className="py-1 text-right font-bold">Last 30 days</th>
              </tr>
            </thead>
            <tbody>
              {cells.map((c) => (
                <tr key={c.label} className="border-t border-gray-100">
                  <th scope="row" className="py-1.5 font-bold text-slate-800">{c.label}</th>
                  <td className="py-1.5 text-right font-black text-tm-navy">{c.d7}</td>
                  <td className="py-1.5 text-right font-black text-tm-navy">{c.d30}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element -- a data: URI QR */}
        <img src={qr} alt={`QR code for ${url}`} width={128} height={128} className="h-32 w-32 shrink-0 self-center rounded-lg border border-gray-100 sm:self-start" />
      </div>
    </section>
  )
}
