'use client'

import { useState } from 'react'
import { adminFetch } from '@/components/admin/adminFetch'
import { useToast } from '@/components/ui/Toast'

// Owner-only "Payment alert emails" (PR106-H1 §2). One or more addresses that
// get an email on every confirmed payment. Saves through adminFetch (the
// fresh-password prompt is handled there) to the owner-only route.
export default function AlertEmailsForm({ initial }: { initial: string }) {
  const toast = useToast()
  const [value, setValue] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [testing, setTesting] = useState(false)

  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setBusy(true)
    const { ok, data } = await adminFetch<{ error?: string }>('/api/admin/payments/alert-emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ emails: value }),
    })
    setBusy(false)
    if (ok) toast.success('Payment alert emails saved.')
    else toast.error(data?.error ?? 'Could not save.')
  }

  const sendTest = async () => {
    setTesting(true)
    const { ok, data } = await adminFetch<{ error?: string; sentTo?: number }>('/api/admin/payments/alert-emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ test: true }),
    })
    setTesting(false)
    if (ok) toast.success(`Test alert sent to ${data?.sentTo ?? 0} address${data?.sentTo === 1 ? '' : 'es'}. Check the inbox.`)
    else toast.error(data?.error ?? 'Could not send the test.')
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3 rounded-2xl border border-gray-200 bg-white p-4 sm:p-5">
      <div className="space-y-1">
        <h2 className="text-sm font-black text-tm-navy">Payment alert emails</h2>
        <p className="text-xs text-gray-500">
          Who gets an email the moment a payment is confirmed. One address per line, or separated by commas.
        </p>
      </div>
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        rows={3}
        placeholder="techguy3286@gmail.com"
        autoCapitalize="none"
        autoCorrect="off"
        className="min-h-[88px] w-full rounded-xl border border-gray-200 p-3 text-sm text-slate-700 focus:border-tm-navy focus:outline-none"
      />
      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={busy}
          className="min-h-[44px] rounded-xl bg-tm-navy px-5 text-sm font-bold text-white hover:bg-tm-navy-hover disabled:opacity-60"
        >
          {busy ? 'Saving…' : 'Save alert emails'}
        </button>
        <button
          type="button"
          onClick={sendTest}
          disabled={testing}
          className="min-h-[44px] rounded-xl border border-tm-navy px-5 text-sm font-bold text-tm-navy hover:bg-tm-tint-navy disabled:opacity-60"
        >
          {testing ? 'Sending…' : 'Send a test'}
        </button>
      </div>
    </form>
  )
}
