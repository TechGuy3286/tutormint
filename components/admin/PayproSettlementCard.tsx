import Link from 'next/link'
import { settlementCardLine } from '@/lib/payproSettlementCore'

// The Finance page's PayPro card (owner, 27 Oct 2026): what PayPro still owes
// for successful payments, with a link to the full PayPro settlement section.
export default function PayproSettlementCard({ pending, unsettled, oldest }: { pending: number; unsettled: number; oldest: string | null }) {
  const red = pending > 0
  return (
    <Link
      href="/admin/finance/paypro"
      data-paypro-card=""
      className={`block rounded-2xl border p-4 [color-scheme:light] ${red ? 'border-tm-gold/40 bg-tm-tint-gold' : 'border-tm-green-deep/20 bg-tm-tint-green'}`}
    >
      <p className={`text-sm font-black ${red ? 'text-tm-gold-ink' : 'text-tm-green-deep'}`}>{settlementCardLine(pending)}</p>
      <p className="text-[11px] text-slate-700">
        {unsettled > 0
          ? `${unsettled} payment${unsettled === 1 ? '' : 's'} waiting${oldest ? ` · oldest paid ${oldest.slice(0, 10)}` : ''} · See PayPro settlement →`
          : 'Every successful PayPro payment has been paid out · See PayPro settlement →'}
      </p>
    </Link>
  )
}
