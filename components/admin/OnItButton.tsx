'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Hand } from 'lucide-react'

import { adminFetch } from '@/components/admin/adminFetch'
import { useToast } from '@/components/ui/Toast'

// "I'm on it" (owner, 23 Nov 2026 — PR-18 Part C.4), on the admin member page
// and in the follow-up mode. The first staff member to tap claims the member;
// everyone else sees "<name> is on it". For a tutor in a followed-up People
// stage the claim is that stage's follow-up. The claimer can release it; the
// Owner can release anyone's or hand it to another staff member.

export type OnItState = { staffName: string; mine: boolean } | null

export default function OnItButton({
  memberId,
  initial,
  isOwner = false,
  staff = [],
  compact = false,
}: {
  memberId: string
  initial: OnItState
  isOwner?: boolean
  /** Owner only: the working staff to reassign to. */
  staff?: { id: string; name: string }[]
  compact?: boolean
}) {
  const router = useRouter()
  const toast = useToast()
  const [state, setState] = useState<OnItState>(initial)
  const [busy, setBusy] = useState(false)
  const [to, setTo] = useState('')

  const call = async (body: Record<string, unknown>) => {
    setBusy(true)
    const res = await adminFetch<{ error?: string; onIt?: { staffName: string; staffId: string } | null; followUp?: boolean }>('/api/admin/members/on-it', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ memberId, ...body }),
    })
    setBusy(false)
    return res
  }

  const claim = async () => {
    const { ok, data } = await call({ action: 'claim' })
    if (!ok) {
      if (data?.onIt) setState({ staffName: data.onIt.staffName, mine: false })
      return void toast.error(data?.error ?? 'That did not save. Please try again.')
    }
    setState({ staffName: 'You', mine: true })
    toast.success(data.followUp ? "You're on it. Counted as a follow-up." : "You're on it.")
    if (!compact) router.refresh()
  }

  const release = async () => {
    const { ok, data } = await call({ action: 'release' })
    if (!ok) return void toast.error(data?.error ?? 'That did not save. Please try again.')
    setState(null)
    toast.success('Released. Anyone can take it now.')
    if (!compact) router.refresh()
  }

  const reassign = async () => {
    if (!to) return
    const { ok, data } = await call({ action: 'reassign', staffId: to })
    if (!ok) return void toast.error(data?.error ?? 'That did not save. Please try again.')
    setState(data.onIt ? { staffName: data.onIt.staffName, mine: false } : state)
    setTo('')
    toast.success(`Handed to ${data.onIt?.staffName ?? 'them'}.`)
    router.refresh()
  }

  const btn = 'inline-flex min-h-[44px] items-center gap-1.5 rounded-xl px-4 text-xs font-bold disabled:opacity-50'

  return (
    <div className="flex flex-wrap items-center gap-2">
      {!state ? (
        <button type="button" disabled={busy} onClick={() => void claim()} className={`${btn} border border-tm-navy bg-white text-tm-navy hover:bg-tm-tint-navy`}>
          <Hand size={14} aria-hidden /> I&apos;m on it
        </button>
      ) : (
        <>
          <span className="inline-flex min-h-[32px] items-center gap-1.5 rounded-full bg-tm-tint-navy px-3 text-xs font-bold text-tm-navy">
            <Hand size={13} aria-hidden /> {state.mine ? "You're on it" : `${state.staffName} is on it`}
          </span>
          {(state.mine || isOwner) && (
            <button type="button" disabled={busy} onClick={() => void release()} className={`${btn} border border-gray-200 bg-white text-slate-700 hover:border-tm-navy`}>
              Release
            </button>
          )}
        </>
      )}
      {isOwner && staff.length > 0 && (
        <span className="flex flex-wrap items-center gap-2">
          <select
            value={to}
            onChange={(e) => setTo(e.target.value)}
            aria-label="Hand to a staff member"
            className="min-h-[44px] rounded-xl border border-gray-200 bg-white px-3 text-xs font-semibold text-tm-navy"
          >
            <option value="">Hand to…</option>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <button type="button" disabled={busy || !to} onClick={() => void reassign()} className={`${btn} border border-gray-200 bg-white text-tm-navy hover:border-tm-navy`}>
            Reassign
          </button>
        </span>
      )}
    </div>
  )
}
