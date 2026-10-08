'use client'

import Link from 'next/link'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { UserPlus } from 'lucide-react'
import { adminFetch } from '@/components/admin/adminFetch'
import { useToast } from '@/components/ui/Toast'
import { useAdminReadOnly } from '@/components/admin/ReadOnly'

// "Create a parent account for this person" / "Create a tutor account"
// (owner, 8 Oct 2026). Owner and Admin only. Confirm the name, give a reason
// (Audit log); the new account uses the same, already-verified mobile and is
// linked to this one. Sign-in then asks "Continue as Tutor or Parent?".

export default function SecondRoleCard({
  memberId,
  role,
  defaultName,
  linkedId,
  reason,
}: {
  memberId: string
  role: 'tutor' | 'parent' | null
  defaultName: string
  linkedId: string | null
  reason: string | null
}) {
  const router = useRouter()
  const toast = useToast()
  const readOnly = useAdminReadOnly()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState(defaultName)
  const [why, setWhy] = useState('')
  const [busy, setBusy] = useState(false)

  if (linkedId) {
    return (
      <section className="rounded-2xl border border-gray-200 bg-white p-4 text-xs text-gray-700">
        <h2 className="mb-1 text-xs font-black uppercase tracking-wide text-gray-500">Second account</h2>
        This person also has a linked account on the same mobile.{' '}
        <Link href={`/admin/users/${linkedId}`} className="font-bold text-tm-navy underline">
          Open it
        </Link>
      </section>
    )
  }
  if (!role) {
    return reason ? (
      <section className="rounded-2xl border border-gray-200 bg-white p-4 text-xs text-gray-500">
        <h2 className="mb-1 text-xs font-black uppercase tracking-wide text-gray-500">Second account</h2>
        {reason}
      </section>
    ) : null
  }
  if (readOnly) return null

  const label = role === 'parent' ? 'Create a parent account for this person' : 'Create a tutor account'

  const create = async () => {
    setBusy(true)
    const r = await adminFetch<{ error?: string; newId?: string }>('/api/admin/users/second-role', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ memberId, name, reason: why }),
    })
    setBusy(false)
    if (r.ok && r.data?.newId) {
      toast.success(`${role === 'parent' ? 'Parent' : 'Tutor'} account created and linked.`)
      setOpen(false)
      router.refresh()
    } else {
      toast.error(r.data?.error ?? 'That did not go through. Please try again.')
    }
  }

  return (
    <section className="space-y-3 rounded-2xl border border-gray-200 bg-white p-4">
      <h2 className="text-xs font-black uppercase tracking-wide text-gray-500">Second account</h2>
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-tm-navy px-4 text-xs font-bold text-tm-navy hover:bg-tm-tint-navy"
        >
          <UserPlus aria-hidden size={14} />
          {label}
        </button>
      ) : (
        <div className="space-y-2">
          <p className="text-[11px] text-gray-500">
            Same mobile, already verified, linked to this account. Each account keeps its own data. At most one tutor
            and one parent account per mobile.
          </p>
          <label className="block space-y-1">
            <span className="text-[11px] font-bold text-tm-navy">Confirm the name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} className="min-h-[44px] w-full rounded-xl border border-gray-200 px-3 text-xs" />
          </label>
          <label className="block space-y-1">
            <span className="text-[11px] font-bold text-tm-navy">Reason (goes in the Audit log)</span>
            <input value={why} onChange={(e) => setWhy(e.target.value)} placeholder="e.g. Tutor also wants a tutor for her son" className="min-h-[44px] w-full rounded-xl border border-gray-200 px-3 text-xs" />
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy || name.trim().length < 2 || why.trim().length < 3}
              onClick={create}
              className="min-h-[44px] rounded-xl bg-tm-navy px-4 text-xs font-bold text-white disabled:opacity-50"
            >
              {busy ? 'Creating…' : label}
            </button>
            <button type="button" onClick={() => setOpen(false)} className="min-h-[44px] rounded-xl border border-gray-200 px-4 text-xs font-bold text-gray-700">
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
