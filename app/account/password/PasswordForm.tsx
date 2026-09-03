'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

import SubmitEscape from '@/components/SubmitEscape'
import { armEscape, STUCK_MESSAGE, submitJson } from '@/lib/submit'

export default function PasswordForm({ next }: { next: string | null }) {
  const router = useRouter()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [stuck, setStuck] = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const { ok, error: failed } = await submitJson('/api/account/password', { password })
    if (!ok) {
      setError(failed ?? 'Could not set your password.')
      setBusy(false)
      return
    }

    // The password IS changed by this point. A stalled navigation must not
    // read as a failure -- somebody who sets it again would be told their new
    // password is the same as their old one.
    const target = next ?? '/'
    armEscape(() => {
      setBusy(false)
      setStuck(target)
      setError(STUCK_MESSAGE)
    })
    router.push(target)
    router.refresh()
  }

  const mismatch = confirm.length > 0 && password !== confirm

  return (
    <form onSubmit={submit} className="space-y-4">
      <label className="block space-y-1">
        <span className="text-xs font-bold text-tm-navy">New password</span>
        <input
          type="password"
          required
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="min-h-[44px] w-full rounded-xl border border-gray-200 bg-tm-bg p-3 text-sm outline-none focus:border-tm-navy focus:bg-white"
        />
        <span className="block text-[11px] text-gray-500">
          At least 10 characters. A short phrase you will remember beats a short jumble you will
          not.
        </span>
      </label>

      <label className="block space-y-1">
        <span className="text-xs font-bold text-tm-navy">Type it again</span>
        <input
          type="password"
          required
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          className="min-h-[44px] w-full rounded-xl border border-gray-200 bg-tm-bg p-3 text-sm outline-none focus:border-tm-navy focus:bg-white"
        />
      </label>

      {mismatch && <p className="text-[11px] font-bold text-tm-red">Those do not match.</p>}
      {error && (
        <div role="alert" className="space-y-2">
          <p className="text-[11px] font-bold text-tm-red">{error}</p>
          {stuck && <SubmitEscape href={stuck} />}
        </div>
      )}

      <button
        type="submit"
        disabled={busy || password.length < 10 || mismatch}
        className="min-h-[44px] w-full rounded-xl bg-tm-red py-3.5 text-xs font-bold uppercase tracking-wider text-white shadow-md transition-all hover:bg-tm-red-hover disabled:bg-gray-300"
      >
        {busy ? 'Saving…' : 'Set my password'}
      </button>
    </form>
  )
}
