import Link from 'next/link'
import { ArrowRight, FileText } from 'lucide-react'

// The "Your CV" card on the tutor dashboard. Links to the CV builder, where
// every tutor sees a live preview; the label reflects whether the PDF download
// is unlocked. A free tutor lands on the page and meets the upgrade prompt for
// the next plan (Verified) — never a lower one — via the download button there.

export default function CvCard({ canDownload }: { canDownload: boolean }) {
  return (
    <Link
      href="/tutor/dashboard/cv"
      className="flex items-center gap-3 rounded-2xl border border-gray-200 bg-white p-4 transition-colors hover:border-tm-navy"
    >
      <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-tm-tint-navy text-tm-navy">
        <FileText aria-hidden size={18} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-black text-tm-navy">Your CV</p>
        <p className="text-[11px] text-gray-500">A print-ready CV, built from your profile.</p>
      </div>
      <span className="inline-flex shrink-0 items-center gap-1 text-xs font-bold text-tm-red">
        {canDownload ? 'Download CV' : 'Verify to download'}
        <ArrowRight aria-hidden size={13} />
      </span>
    </Link>
  )
}
