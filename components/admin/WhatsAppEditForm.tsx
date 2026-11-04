'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

import { adminFetch } from '@/components/admin/adminFetch'
import MaskedContact from '@/components/admin/MaskedContact'
import MobileNumberInput from '@/components/auth/MobileNumberInput'
import { useToast } from '@/components/ui/Toast'
import { useAdminReadOnly } from '@/components/admin/ReadOnly'
import { WHATSAPP_INVALID, WHATSAPP_REASON_MIN, WHATSAPP_REASON_NEEDED } from '@/lib/whatsappEditCore'
import { normalisePkMobile } from '@/lib/phone'

// Staff set or change a tutor's or parent's WhatsApp number (owner, 4 Nov
// 2026), on the member page's Edit tab. The current number shows masked with
// the logged "Show". The server (/api/admin/members/whatsapp) applies the same
// rules again and also refuses a number on the Do not use list or On hold. The
// sign-in mobile is not changed here.

export default function WhatsAppEditForm({ memberId, currentMasked }: { memberId: string; currentMasked: string | null }) {
  const router = useRouter()
  const toast = useToast()
  const readOnly = useAdminReadOnly()
  const [masked, setMasked] = useState(currentMasked)
  const [value, setValue] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  async function save() {
    if (!normalisePkMobile(value)) return toast.error(WHATSAPP_INVALID)
    if (reason.trim().length < WHATSAPP_REASON_MIN) return toast.error(WHATSAPP_REASON_NEEDED)
    setBusy(true)
    const { ok, data } = await adminFetch<{ ok?: boolean; unchanged?: boolean; masked?: string | null; error?: string }>('/api/admin/members/whatsapp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ memberId, whatsapp: value, reason: reason.trim() }),
    })
    setBusy(false)
    if (!ok || !data?.ok) return toast.error(data?.error ?? 'That did not save. Please try again.')
    if (data.unchanged) return toast.success('No change — that is already the WhatsApp number.')
    setMasked(data.masked ?? null)
    setValue('')
    setReason('')
    toast.success('WhatsApp number saved.')
    router.refresh()
  }

  return (
    <div className="space-y-3" data-whatsapp-edit>
      <p className="text-xs text-slate-700">
        Current:{' '}
        {masked ? <MaskedContact memberId={memberId} field="whatsapp" masked={masked} /> : <span className="text-gray-500">none on file</span>}
      </p>
      <p className="text-[11px] text-gray-500">This changes only the WhatsApp number. The sign-in mobile number stays as it is.</p>
      {!readOnly && (
        <>
          <label className="block space-y-1">
            <span className="block text-[11px] font-bold text-tm-navy">New WhatsApp number</span>
            <MobileNumberInput value={value} onChange={setValue} />
          </label>
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
            disabled={busy || !value}
            onClick={() => void save()}
            className="inline-flex min-h-[44px] w-full items-center justify-center rounded-xl bg-tm-red px-4 text-xs font-bold text-white transition-colors hover:bg-tm-red-hover disabled:opacity-50 sm:w-auto"
          >
            {busy ? 'Saving…' : 'Save WhatsApp number'}
          </button>
        </>
      )}
    </div>
  )
}
