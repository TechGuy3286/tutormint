'use client'

import { useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'

import { adminFetch } from '@/components/admin/adminFetch'
import { useToast } from '@/components/ui/Toast'
import { useAdminReadOnly } from '@/components/admin/ReadOnly'
import { cleanName, nameProblem, NAME_REASON_MIN, NAME_REASON_NEEDED, OWNER_ONLY_NAME, VERIFIED_NAME_HINT, type NameField } from '@/lib/nameEditCore'
import { displayNameProblem } from '@/lib/memberNamesCore'

// Staff edit of a member's name (owner, 27 Oct 2026). Used in the tutor
// "Edit this tutor's details" panel and on the parent admin page. The server
// (/api/admin/members/name) applies the same rules again. After a tutor's name
// is saved, `afterSave` (the profile-address box) is shown so staff can
// Suggest → Save the address; the old address keeps redirecting.
//
// TWO NAMES (owner, 5 Nov 2026): `field` picks the Name on CNIC (the legal
// name; Owner only once the CNIC is approved) or the Display name (optional,
// what parents and tutors see). The profile-address box follows a Display
// name change.

export default function NameEditForm({
  memberId,
  currentName,
  ownerOnly,
  isOwner,
  afterSave,
  field = 'cnic',
}: {
  field?: NameField
  memberId: string
  currentName: string
  /** A verified tutor: only the Owner may change the name. */
  ownerOnly: boolean
  isOwner: boolean
  afterSave?: ReactNode
}) {
  const router = useRouter()
  const toast = useToast()
  const readOnly = useAdminReadOnly()
  const [name, setName] = useState(currentName)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)

  if (readOnly) return null
  const locked = ownerOnly && !isOwner && field === 'cnic'
  const display = field === 'display'
  const problem = display ? (name.trim() === '' ? null : displayNameProblem(name) ?? nameProblem(name)) : nameProblem(name)
  const unchanged = cleanName(name) === cleanName(currentName)

  async function save() {
    if (reason.trim().length < NAME_REASON_MIN) return toast.error(NAME_REASON_NEEDED)
    if (problem) return toast.error(problem)
    setBusy(true)
    const { ok, data } = await adminFetch<{ ok?: boolean; name?: string; unchanged?: boolean; error?: string }>('/api/admin/members/name', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ memberId, name, reason: reason.trim(), field }),
    })
    setBusy(false)
    if (!ok || !data?.ok) return toast.error(data?.error ?? 'That did not save. Please try again.')
    if (data.unchanged) return toast.success('No change — the name is already that.')
    setName(data.name ?? name)
    setReason('')
    setSaved(true)
    toast.success(display ? 'Display name saved.' : 'Name on CNIC saved.')
    router.refresh()
  }

  return (
    <div className="space-y-3" data-name-edit>
      {ownerOnly && !display && (
        <p className="rounded-xl bg-tm-tint-gold px-3 py-2 text-[11px] font-bold text-tm-gold-ink">
          {VERIFIED_NAME_HINT}.{locked ? ` ${OWNER_ONLY_NAME}` : ''}
        </p>
      )}
      <label className="block space-y-1">
        <span className="block text-[11px] font-bold text-tm-navy">{display ? 'Display name (shown to parents and tutors)' : 'Name on CNIC'}</span>
        <input
          value={name}
          disabled={locked && !display}
          placeholder={display ? 'Leave empty to show the Name on CNIC' : undefined}
          onChange={(e) => { setName(e.target.value); setSaved(false) }}
          className="min-h-[44px] w-full rounded-xl border border-gray-200 bg-white p-3 text-sm outline-none focus:border-tm-navy disabled:bg-gray-100"
        />
        {!unchanged && !problem && (
          <span className="block text-[11px] text-gray-500">Will be saved as: {cleanName(name)}</span>
        )}
      </label>
      {!locked && (
        <>
          <label className="block space-y-1">
            <span className="block text-[11px] font-bold text-tm-navy">Reason for this change</span>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why are you changing this?"
              className="min-h-[44px] w-full rounded-xl border border-gray-200 bg-white p-3 text-sm outline-none focus:border-tm-navy"
            />
          </label>
          <button
            type="button"
            disabled={busy || unchanged || !!problem}
            onClick={() => void save()}
            className="inline-flex min-h-[44px] w-full items-center justify-center rounded-xl bg-tm-red px-4 text-xs font-bold text-white transition-colors hover:bg-tm-red-hover disabled:opacity-50 sm:w-auto"
          >
            {busy ? 'Saving…' : display ? 'Save Display name' : 'Save Name on CNIC'}
          </button>
        </>
      )}
      {saved && afterSave && (
        <div className="space-y-1 rounded-xl border border-tm-navy/20 bg-tm-tint-navy/40 p-3">
          <p className="text-[11px] font-bold text-tm-navy">
            Update the profile address too? Press Suggest, check it, then Save address — the old address keeps redirecting.
          </p>
          {afterSave}
        </div>
      )}
    </div>
  )
}
