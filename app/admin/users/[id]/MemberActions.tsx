'use client'
import { AlertTriangle, Ban, ClipboardList, CreditCard, RotateCcw, ShieldX, MessageSquare } from 'lucide-react'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { adminFetch } from '@/components/admin/adminFetch'
import { useToast } from '@/components/ui/Toast'

// Quick actions on a member page.
//
// Warn, suspend, reinstate — the same three the reports queue offers, through
// the same route and the same lib/moderation.ts implementation. Part 4 adds a
// permanent BAN (owner/manager, distinct from suspend, with a typed "BAN"
// confirmation) and its owner-only reversal, plus a "Send message" link to the
// official TutorMint Team channel.
//
// Granting a plan is deliberately NOT duplicated here: that flow already exists
// on /admin/plans with its own permission, and re-implementing it would quietly
// widen who can hand out plans. The link carries the member across instead.

export default function MemberActions({
  userId,
  name,
  suspended,
  banned,
  canBan,
  canUnban,
  isSelf,
  isStaff,
  isOwner,
  isTutor,
}: {
  userId: string
  name: string
  suspended: boolean
  banned: boolean
  canBan: boolean
  canUnban: boolean
  isSelf: boolean
  isStaff: boolean
  isOwner: boolean
  isTutor: boolean
}) {
  const router = useRouter()
  const toast = useToast()
  const [open, setOpen] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [confirmWord, setConfirmWord] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const act = async (action: string) => {
    setBusy(true)
    setError(null)
    try {
      const { ok, data: json } = await adminFetch<{ [k: string]: unknown; error?: string }>(
        '/api/admin/members',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId, action, reason }),
        },
      )
      if (!ok) throw new Error(json.error ?? 'That did not work.')
      setOpen(null)
      setReason('')
      setConfirmWord('')
      toast.success(
        action === 'warn'
          ? 'Warning sent. The member has been notified.'
          : action === 'unsuspend'
            ? 'Reinstated. The member has been notified.'
            : action === 'ban'
              ? 'Account banned.'
              : action === 'unban'
                ? 'Ban lifted. The member has been notified.'
                : 'Suspended. The member has been notified.',
      )
      router.refresh()
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'That did not work.'
      setError(msg)
      toast.error(msg)
    } finally {
      setBusy(false)
    }
  }

  const firstName = name.split(' ')[0]
  const banGate = open === 'ban' && confirmWord.trim().toUpperCase() !== 'BAN'

  return (
    <section className="space-y-3 rounded-2xl border border-gray-200 bg-white p-4">
      <h2 className="text-xs font-black uppercase tracking-wide text-gray-500">Actions</h2>

      {error && <p className="text-[11px] font-bold text-tm-red">{error}</p>}

      {banned && (
        <p className="rounded-xl bg-tm-tint-red p-2.5 text-[11px] font-bold text-tm-red">
          This account is banned. It cannot sign in.
        </p>
      )}

      {isSelf ? (
        <p className="text-xs text-gray-500">This is your own account.</p>
      ) : isOwner ? (
        <p className="text-xs text-gray-500">
          The owner account cannot be warned, suspended or banned from here.
        </p>
      ) : open ? (
        <div className="space-y-2">
          <label className="block space-y-1">
            <span className="text-[11px] font-bold text-gray-500">
              {open === 'unsuspend'
                ? `Why is ${firstName} being reinstated?`
                : open === 'ban'
                  ? `Why is ${firstName} being banned? This is permanent.`
                  : open === 'unban'
                    ? `Why is ${firstName}'s ban being lifted?`
                    : `Reason — ${firstName} is shown this`}
            </span>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="min-h-[44px] w-full rounded-xl border border-gray-200 px-3 text-xs font-semibold"
            />
          </label>
          {open === 'ban' && (
            <label className="block space-y-1">
              <span className="text-[11px] font-bold text-tm-red">Type BAN to confirm</span>
              <input
                value={confirmWord}
                onChange={(e) => setConfirmWord(e.target.value)}
                placeholder="BAN"
                className="min-h-[44px] w-full rounded-xl border border-tm-red/40 px-3 text-xs font-bold uppercase"
              />
            </label>
          )}
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={busy || reason.trim().length < 5 || banGate}
              onClick={() => act(open)}
              className={`min-h-[44px] rounded-xl px-4 text-xs font-bold text-white disabled:bg-gray-300 ${
                open === 'ban' ? 'bg-tm-red' : 'bg-tm-black'
              }`}
            >
              {busy ? 'Working…' : `Confirm ${open}`}
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(null)
                setReason('')
                setConfirmWord('')
              }}
              className="min-h-[44px] rounded-xl border border-gray-200 px-4 text-xs font-bold text-slate-700"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {banned ? (
            canUnban && (
              <button
                type="button"
                onClick={() => setOpen('unban')}
                className="inline-flex items-center justify-center gap-1.5 min-h-[44px] rounded-xl bg-tm-green-deep px-4 text-xs font-bold text-white sm:col-span-2"
              >
                <RotateCcw aria-hidden size={13} />
                Lift ban
              </button>
            )
          ) : (
            <>
              <button
                type="button"
                onClick={() => setOpen('warn')}
                className="inline-flex items-center justify-center gap-1.5 min-h-[44px] rounded-xl bg-tm-gold px-4 text-xs font-bold text-tm-navy"
              >
                <AlertTriangle aria-hidden size={13} />
                Warn
              </button>
              {suspended ? (
                <button
                  type="button"
                  onClick={() => setOpen('unsuspend')}
                  className="inline-flex items-center justify-center gap-1.5 min-h-[44px] rounded-xl bg-tm-green-deep px-4 text-xs font-bold text-white"
                >
                  <RotateCcw aria-hidden size={13} />
                  Reinstate
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setOpen('suspend')}
                  className="inline-flex items-center justify-center gap-1.5 min-h-[44px] rounded-xl bg-tm-red px-4 text-xs font-bold text-white"
                >
                  <Ban aria-hidden size={13} />
                  Suspend
                </button>
              )}
              {canBan && (
                <button
                  type="button"
                  onClick={() => setOpen('ban')}
                  className="inline-flex items-center justify-center gap-1.5 min-h-[44px] rounded-xl border border-tm-red bg-white px-4 text-xs font-bold text-tm-red sm:col-span-2"
                >
                  <ShieldX aria-hidden size={13} />
                  Ban for fraud
                </button>
              )}
            </>
          )}
        </div>
      )}

      <div className="flex flex-col gap-2 sm:flex-row">
        {!isSelf && !banned && (
          <Link
            href={`/admin/inbox?to=${userId}`}
            className="gap-1.5 inline-flex min-h-[44px] flex-1 items-center justify-center rounded-xl border border-gray-200 px-4 text-xs font-bold text-slate-700 hover:border-tm-navy"
          >
            <MessageSquare aria-hidden size={14} />
            Send message
          </Link>
        )}
        {!isStaff && (
          <Link
            href="/admin/plans"
            className="gap-1.5 inline-flex min-h-[44px] flex-1 items-center justify-center rounded-xl border border-gray-200 px-4 text-xs font-bold text-slate-700"
          >
            <CreditCard aria-hidden size={14} />
            Grant or revoke a plan
          </Link>
        )}
        {isTutor && (
          <Link
            href="/admin/tutors"
            className="gap-1.5 inline-flex min-h-[44px] flex-1 items-center justify-center rounded-xl border border-gray-200 px-4 text-xs font-bold text-slate-700"
          >
            <ClipboardList aria-hidden size={14} />
            Open moderation queue
          </Link>
        )}
      </div>
    </section>
  )
}
