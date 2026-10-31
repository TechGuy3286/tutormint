'use client'
import { AlertTriangle, Ban, ChevronDown, CreditCard, MessageCircle, MessageSquare, Pencil, Phone, PhoneCall, RotateCcw, ShieldX } from 'lucide-react'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { adminFetch } from '@/components/admin/adminFetch'
import { useToast } from '@/components/ui/Toast'
import { useAdminReadOnly } from '@/components/admin/ReadOnly'
import AdminWhatsAppLink from '@/components/admin/AdminWhatsAppLink'

// Actions on a member page (owner, 20 Oct 2026):
//
//   Warn · Suspend or ban ▾ (Suspend / Reinstate, Ban for fraud)
//   Contact: Message (the in-app TutorMint Team channel) · WhatsApp · Call
//   Verify mobile manually · Change mobile · Grant or revoke a plan ·
//   Edit tutor record · Create parent account
//
// Warn, suspend, reinstate and ban go through the same route and the same
// lib/moderation.ts as the reports queue, with the same confirm steps (a
// reason; for a ban, typing BAN) and the same permissions as before. Granting a
// plan stays on /admin/plans with its own permission.

const BTN = 'inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl px-4 text-xs font-bold'

export default function MemberActions({
  userId,
  name,
  suspended,
  banned,
  canBan,
  canModerate = true,
  canGrantPlans = true,
  canUnban,
  isSelf,
  isStaff,
  isOwner,
  canVerifyMobile,
  mobileVerified,
  hasMobile,
  whatsappMsisdn = null,
  callMsisdn = null,
  editTutorHref = null,
  secondRole = null,
}: {
  userId: string
  name: string
  suspended: boolean
  banned: boolean
  canBan: boolean
  /** Warn / suspend / ban / mobile tools — false for Backend Support (owner, 31 Oct 2026). */
  canModerate?: boolean
  /** The Plans screen opens for this role (Owner and Partner). */
  canGrantPlans?: boolean
  canUnban: boolean
  isSelf: boolean
  isStaff: boolean
  isOwner: boolean
  isTutor?: boolean
  canVerifyMobile: boolean
  mobileVerified: boolean
  hasMobile: boolean
  /** 92… for wa.me; null when there is no number. */
  whatsappMsisdn?: string | null
  /** 92… for tel:; null when there is no number. */
  callMsisdn?: string | null
  /** The admin tutor record (profile address and edits). */
  editTutorHref?: string | null
  /** "Create parent account" / "Create tutor account" (SecondRoleCard). */
  secondRole?: React.ReactNode
}) {
  const router = useRouter()
  const toast = useToast()
  const readOnly = useAdminReadOnly()
  const [open, setOpen] = useState<string | null>(null)
  const [menu, setMenu] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const [reason, setReason] = useState('')
  const [confirmWord, setConfirmWord] = useState('')
  const [newMobile, setNewMobile] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!menu) return
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(false)
    }
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setMenu(false)
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', esc)
    }
  }, [menu])

  const act = async (action: string) => {
    setBusy(true)
    setError(null)
    try {
      const { ok, data: json } = await adminFetch<{ [k: string]: unknown; error?: string }>(
        '/api/admin/members',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId, action, reason, newMobile }),
        },
      )
      if (!ok) throw new Error(json.error ?? 'That did not work.')
      setOpen(null)
      setReason('')
      setConfirmWord('')
      setNewMobile('')
      toast.success(
        action === 'warn'
          ? 'Warning sent. The member has been notified.'
          : action === 'unsuspend'
            ? 'Reinstated. The member has been notified.'
            : action === 'ban'
              ? 'Account banned.'
              : action === 'unban'
                ? 'Ban lifted. The member has been notified.'
                : action === 'verify-mobile'
                  ? 'Mobile number verified manually.'
                  : action === 'change-mobile'
                    ? 'Mobile number changed. The member will verify the new number.'
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

  if (readOnly) return null

  const moderable = !isSelf && !isOwner

  return (
    <section className="space-y-4 rounded-2xl border border-gray-200 bg-white p-4">
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
        <p className="text-xs text-gray-500">The owner account cannot be warned, suspended or banned from here.</p>
      ) : null}

      {open ? (
        <div className="space-y-2">
          <label className="block space-y-1">
            <span className="text-[11px] font-bold text-gray-500">
              {open === 'unsuspend'
                ? `Why is ${firstName} being reinstated?`
                : open === 'ban'
                  ? `Why is ${firstName} being banned? This is permanent.`
                  : open === 'unban'
                    ? `Why is ${firstName}'s ban being lifted?`
                    : open === 'verify-mobile'
                      ? `Why are you verifying ${firstName}'s number manually? (for the record)`
                      : open === 'change-mobile'
                        ? `Why are you changing ${firstName}'s number? (for the record)`
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
          {open === 'change-mobile' && (
            <label className="block space-y-1">
              <span className="text-[11px] font-bold text-gray-500">New mobile number</span>
              <input
                value={newMobile}
                onChange={(e) => setNewMobile(e.target.value)}
                inputMode="tel"
                placeholder="0300 1234567"
                className="min-h-[44px] w-full rounded-xl border border-gray-200 px-3 text-xs font-semibold"
              />
            </label>
          )}
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={
                busy ||
                reason.trim().length < 5 ||
                banGate ||
                (open === 'change-mobile' && newMobile.replace(/\D/g, '').length < 10)
              }
              onClick={() => act(open)}
              className={`min-h-[44px] rounded-xl px-4 text-xs font-bold text-white disabled:bg-gray-300 ${
                open === 'ban' ? 'bg-tm-red' : 'bg-tm-black'
              }`}
            >
              {busy
                ? 'Working…'
                : open === 'verify-mobile'
                  ? 'Verify number'
                  : open === 'change-mobile'
                    ? 'Change number'
                    : `Confirm ${open}`}
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
        <>
          {moderable && canModerate && (
            <div className="flex flex-wrap gap-2">
              {banned ? (
                canUnban && (
                  <button type="button" onClick={() => setOpen('unban')} className={`${BTN} bg-tm-green-deep text-white`}>
                    <RotateCcw aria-hidden size={13} />
                    Lift ban
                  </button>
                )
              ) : (
                <>
                  <button type="button" onClick={() => setOpen('warn')} className={`${BTN} bg-tm-gold text-tm-navy`}>
                    <AlertTriangle aria-hidden size={13} />
                    Warn
                  </button>
                  {/* Suspend and ban in one menu (owner, 20 Oct 2026): the same
                      confirm steps and permissions as the two buttons had. */}
                  <div ref={menuRef} className="relative">
                    <button
                      type="button"
                      aria-haspopup="menu"
                      aria-expanded={menu}
                      onClick={() => setMenu((v) => !v)}
                      className={`${BTN} border border-tm-red bg-white text-tm-red`}
                    >
                      <Ban aria-hidden size={13} />
                      Suspend or ban
                      <ChevronDown aria-hidden size={13} />
                    </button>
                    {menu && (
                      <ul role="menu" className="absolute left-0 z-20 mt-1 min-w-[200px] overflow-hidden rounded-xl border border-gray-200 bg-white py-1 shadow-lg">
                        <li role="none">
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => {
                              setMenu(false)
                              setOpen(suspended ? 'unsuspend' : 'suspend')
                            }}
                            className="flex min-h-[44px] w-full items-center gap-1.5 px-3 text-left text-xs font-bold text-tm-navy hover:bg-tm-bg"
                          >
                            {suspended ? <RotateCcw aria-hidden size={13} /> : <Ban aria-hidden size={13} />}
                            {suspended ? 'Reinstate' : 'Suspend'}
                          </button>
                        </li>
                        {canBan && (
                          <li role="none">
                            <button
                              type="button"
                              role="menuitem"
                              onClick={() => {
                                setMenu(false)
                                setOpen('ban')
                              }}
                              className="flex min-h-[44px] w-full items-center gap-1.5 px-3 text-left text-xs font-bold text-tm-red hover:bg-tm-bg"
                            >
                              <ShieldX aria-hidden size={13} />
                              Ban for fraud
                            </button>
                          </li>
                        )}
                      </ul>
                    )}
                  </div>
                </>
              )}
            </div>
          )}

          {/* Contact (owner, 20 Oct 2026): one group. */}
          {!isSelf && (
            <div className="space-y-1.5">
              <p className="text-[10px] font-bold uppercase tracking-wide text-gray-500">Contact</p>
              <div className="flex flex-wrap gap-2">
                {!banned && (
                  <Link href={`/admin/inbox?to=${userId}`} className={`${BTN} border border-gray-200 text-slate-700 hover:border-tm-navy`}>
                    <MessageSquare aria-hidden size={14} />
                    Message
                  </Link>
                )}
                {whatsappMsisdn && (
                  <AdminWhatsAppLink memberId={userId} from="member" className={`${BTN} bg-tm-green-deep text-white hover:bg-tm-green-deep-hover`}>
                    <MessageCircle aria-hidden size={14} />
                    WhatsApp
                  </AdminWhatsAppLink>
                )}
                {callMsisdn && (
                  <a href={`tel:+${callMsisdn}`} className={`${BTN} border border-gray-200 text-slate-700 hover:border-tm-navy`}>
                    <Phone aria-hidden size={14} />
                    Call
                  </a>
                )}
                {!whatsappMsisdn && !callMsisdn && <span className="self-center text-[11px] text-gray-500">No mobile number on file.</span>}
              </div>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            {moderable && canModerate && !banned && canVerifyMobile && hasMobile && !mobileVerified && (
              <button type="button" onClick={() => setOpen('verify-mobile')} className={`${BTN} bg-tm-navy text-white`}>
                <PhoneCall aria-hidden size={13} />
                Verify mobile manually
              </button>
            )}
            {moderable && canModerate && !banned && canVerifyMobile && (
              <button
                type="button"
                onClick={() => setOpen('change-mobile')}
                className={`${BTN} border border-gray-200 bg-white text-tm-navy hover:border-tm-navy`}
              >
                <PhoneCall aria-hidden size={13} />
                Change mobile
              </button>
            )}
            {!isStaff && canGrantPlans && (
              <Link href="/admin/plans" className={`${BTN} border border-gray-200 text-slate-700 hover:border-tm-navy`}>
                <CreditCard aria-hidden size={14} />
                Grant or revoke a plan
              </Link>
            )}
            {editTutorHref && (
              <Link href={editTutorHref} className={`${BTN} border border-gray-200 text-slate-700 hover:border-tm-navy`}>
                <Pencil aria-hidden size={14} />
                Edit tutor record
              </Link>
            )}
          </div>

          {secondRole}
        </>
      )}
    </section>
  )
}
