'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'

import { formatDate } from '@/lib/datetime'
import { CLOSEST_LABEL, contactedAgo, recentlyContacted, type ClosestStage } from '@/lib/closestToPayCore'
import type { TutorFollowRow } from '@/lib/tutorFollowUps'
import TutorFollowUpButtons from '@/components/admin/TutorFollowUpButtons'
import ProfileShareButtons from '@/components/admin/ProfileShareButtons'
import type { ProfileShare } from '@/lib/profileShareCore'

// One tutor on a "Closest to paying" chip (owner, 5 Nov 2026): name, the one
// line of what is missing, who contacted them last, then the stage's own
// WhatsApp (recorded like every Follow-ups tap) and Call.

const STAGE_TONE: Record<ClosestStage, string> = {
  ready: 'bg-tm-tint-green text-tm-green-deep',
  main_approved: 'bg-tm-tint-navy text-tm-navy',
  all_uploaded: 'bg-tm-tint-gold text-tm-gold-ink',
  main_uploaded: 'bg-tm-tint-gold text-tm-gold-ink',
}

export default function ClosestRow({ row, share = null, nowMs }: { row: TutorFollowRow & { closest: ClosestStage }; share?: ProfileShare | null; nowMs: number }) {
  const router = useRouter()
  const contacted = contactedAgo(row.lastContactAt, nowMs)
  const sunk = recentlyContacted(row.lastContactAt, nowMs)
  return (
    <li className={`space-y-2 rounded-2xl border border-gray-200 p-4 ${row.paused || sunk ? 'bg-tm-bg' : 'bg-white'}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <Link href={`/admin/users/${row.id}`} className="text-sm font-black text-tm-navy hover:underline">
            {row.name}
          </Link>
          <p className="text-[11px] text-gray-600">
            {row.city ?? 'No city yet'} · joined {formatDate(row.joinedAt)}
            {row.lastSeenAt ? ` · last active ${formatDate(row.lastSeenAt)}` : ''}
          </p>
        </div>
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${STAGE_TONE[row.closest]}`}>{CLOSEST_LABEL[row.closest]}</span>
      </div>
      {row.closestMissing && <p className="text-xs font-bold text-slate-800">{row.closestMissing}</p>}
      {row.paused && <p className="text-[11px] font-semibold text-gray-600">Paused by user</p>}
      {contacted && <p className="text-[11px] font-semibold text-tm-green-deep">{contacted}</p>}
      {share && <ProfileShareButtons share={share} />}
      <div className="flex flex-wrap gap-2">
        <TutorFollowUpButtons
          memberId={row.id}
          reason={row.followReason}
          templateKey={row.closestTemplateKey}
          progress={row.progress}
          waHref={row.closestWaHref}
          telHref={row.telHref}
          sent={sunk}
          onChanged={() => router.refresh()}
        />
        {!row.closestWaHref && !row.telHref && <span className="self-center text-[11px] text-gray-500">No mobile number on file.</span>}
      </div>
    </li>
  )
}
