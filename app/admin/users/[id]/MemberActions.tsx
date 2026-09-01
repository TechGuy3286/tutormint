'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

// Quick actions on a member page.
//
// Warn, suspend, reinstate — the same three the reports queue offers, through
// the same route and the same lib/moderation.ts implementation, so the outcome
// does not depend on which screen an admin happened to be looking at.
//
// Granting a plan is deliberately NOT duplicated here: that flow already exists
// on /admin/plans with its own permission (owner/manager, not support), and
// re-implementing it would quietly widen who can hand out plans. The link
// carries the member across instead.

export default function MemberActions({
  userId,
  name,
  suspended,
  isSelf,
  isStaff,
  isOwner,
  isTutor,
}: {
  userId: string
  name: string
  suspended: boolean
  isSelf: boolean
  isStaff: boolean
  isOwner: boolean
  isTutor: boolean
}) {
  const router = useRouter()
  const [open, setOpen] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const act = async (action: string) => {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/members', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, action, reason }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'That did not work.')
      setOpen(null)
      setReason('')
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not work.')
    } finally {
      setBusy(false)
    }
  }

  const firstName = name.split(' ')[0]

  return (
    <section className="space-y-3 rounded-2xl border border-gray-200 bg-white p-4">
      <h2 className="text-xs font-black uppercase tracking-wide text-gray-400">Actions</h2>

      {error && <p className="text-[11px] font-bold text-[#d60008]">{error}</p>}

      {isSelf ? (
        <p className="text-xs text-gray-500">This is your own account.</p>
      ) : isOwner ? (
        <p className="text-xs text-gray-500">
          The owner account cannot be warned or suspended from here.
        </p>
      ) : open ? (
        <div className="space-y-2">
          <label className="block space-y-1">
            <span className="text-[11px] font-bold text-gray-500">
              {open === 'unsuspend'
                ? `Why is ${firstName} being reinstated?`
                : `Reason — ${firstName} is shown this`}
            </span>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="min-h-[44px] w-full rounded-xl border border-gray-200 px-3 text-xs font-semibold"
            />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={busy || reason.trim().length < 5}
              onClick={() => act(open)}
              className="min-h-[44px] rounded-xl bg-[#0F172A] px-4 text-xs font-bold text-white disabled:bg-gray-300"
            >
              {busy ? 'Working…' : `Confirm ${open}`}
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(null)
                setReason('')
              }}
              className="min-h-[44px] rounded-xl border border-gray-200 px-4 text-xs font-bold text-[#334155]"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => setOpen('warn')}
            className="min-h-[44px] rounded-xl bg-[#F59E0B] px-4 text-xs font-bold text-[#0F172A]"
          >
            Warn
          </button>
          {suspended ? (
            <button
              type="button"
              onClick={() => setOpen('unsuspend')}
              className="min-h-[44px] rounded-xl bg-[#059669] px-4 text-xs font-bold text-white"
            >
              Reinstate
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setOpen('suspend')}
              className="min-h-[44px] rounded-xl bg-[#d60008] px-4 text-xs font-bold text-white"
            >
              Suspend
            </button>
          )}
        </div>
      )}

      <div className="flex flex-col gap-2 sm:flex-row">
        {!isStaff && (
          <Link
            href="/admin/plans"
            className="inline-flex min-h-[44px] flex-1 items-center justify-center rounded-xl border border-gray-200 px-4 text-xs font-bold text-[#334155]"
          >
            Grant or revoke a plan
          </Link>
        )}
        {isTutor && (
          <Link
            href="/admin/tutors"
            className="inline-flex min-h-[44px] flex-1 items-center justify-center rounded-xl border border-gray-200 px-4 text-xs font-bold text-[#334155]"
          >
            Open moderation queue
          </Link>
        )}
      </div>
    </section>
  )
}
