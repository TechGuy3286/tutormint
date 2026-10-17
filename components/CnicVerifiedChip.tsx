import { ShieldCheck } from 'lucide-react'

// "CNIC verified" (owner, 17 Oct 2026): shown on a tutor's card and profile once
// staff approved the CNIC. It says the check happened and nothing else — no
// part of the number is ever shown to parents, the public or other tutors.

export default function CnicVerifiedChip({ className = '' }: { className?: string }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-full bg-tm-tint-green px-2 py-0.5 text-[11px] font-bold text-tm-green-deep ${className}`}
    >
      <ShieldCheck aria-hidden size={12} />
      CNIC verified
    </span>
  )
}
