import { LifeBuoy, Settings } from 'lucide-react'
import Link from 'next/link'

// Two small outlined buttons on the dashboard profile card (owner, 9 Oct 2026):
// Settings and Help & Support. Help & Support used to live only in the header
// dropdown, which is gone; this is its visible home. Side by side on a phone.

const BTN =
  'inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 text-[11px] font-bold text-tm-navy transition-colors hover:border-tm-navy'

export default function AccountLinks({ settingsHref }: { settingsHref: string }) {
  return (
    <div className="flex flex-wrap gap-2 pt-0.5">
      <Link href={settingsHref} className={BTN}>
        <Settings aria-hidden size={14} className="shrink-0" />
        Settings
      </Link>
      <Link href="/support" className={BTN}>
        <LifeBuoy aria-hidden size={14} className="shrink-0" />
        Help &amp; Support
      </Link>
    </div>
  )
}
