'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function PasswordForm({ next }: { next: string | null }) {
  const router = useRouter()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/account/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not set your password.')
      router.push(next ?? '/')
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not set your password.')
      setBusy(false)
    }
  }

  const mismatch = confirm.length > 0 && password !== confirm

  return (
    <form onSubmit={submit} className="space-y-4">
      <label className="block space-y-1">
        <span className="text-xs font-bold text-[#0F172A]">New password</span>
        <input
          type="password"
          required
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="min-h-[44px] w-full rounded-xl border border-gray-200 bg-[#F8FAFC] p-3 text-sm outline-none focus:border-[#0F172A] focus:bg-white"
        />
        <span className="block text-[11px] text-gray-400">
          At least 10 characters. A short phrase you will remember beats a short jumble you will
          not.
        </span>
      </label>

      <label className="block space-y-1">
        <span className="text-xs font-bold text-[#0F172A]">Type it again</span>
        <input
          type="password"
          required
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          className="min-h-[44px] w-full rounded-xl border border-gray-200 bg-[#F8FAFC] p-3 text-sm outline-none focus:border-[#0F172A] focus:bg-white"
        />
      </label>

      {mismatch && <p className="text-[11px] font-bold text-[#d60008]">Those do not match.</p>}
      {error && <p className="text-[11px] font-bold text-[#d60008]">{error}</p>}

      <button
        type="submit"
        disabled={busy || password.length < 10 || mismatch}
        className="min-h-[44px] w-full rounded-xl bg-[#d60008] py-3.5 text-xs font-bold uppercase tracking-wider text-white shadow-md transition-all hover:bg-red-700 disabled:bg-gray-300"
      >
        {busy ? 'Saving…' : 'Set my password'}
      </button>
    </form>
  )
}
