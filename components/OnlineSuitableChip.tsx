import { Wifi } from 'lucide-react'

// "Suitable for online" — shown beside a tuition's mode when the tuition is in
// a different city from the tutor but can be taught online (lib/matchChip.ts).
// tm-tint-navy with tm-navy text is an approved contrast pair.

export default function OnlineSuitableChip({ className = '' }: { className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full bg-tm-tint-navy px-2 py-0.5 text-[10px] font-bold text-tm-navy ${className}`}
    >
      <Wifi aria-hidden size={11} />
      Suitable for online
    </span>
  )
}
