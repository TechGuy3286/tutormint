'use client'

import { useState } from 'react'
import { Save } from 'lucide-react'
import PasswordInput from '@/components/ui/PasswordInput'
import { createClient } from '@/lib/supabase/client'
import { useToast } from '@/components/ui/Toast'

// Change password (owner, 8 Oct 2026): ONE card for parents and tutors —
// current password + new password + confirm, saved through the member's own
// session, with a toast. The project requires the CURRENT password to set a new
// one (GoTrue "secure password change"), so it is asked for here.

export default function ChangePasswordCard() {
  const toast = useToast()
  const [current, setCurrent] = useState('')
  const [pw, setPw] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (pw !== confirm) return setError('The two passwords do not match.\nدونوں پاس ورڈ ایک جیسے نہیں ہیں۔')
    if (pw.length < 6) return setError('Use at least 6 characters.\nکم از کم 6 حروف استعمال کریں۔')
    setBusy(true)
    const { error: err } = await createClient().auth.updateUser({ password: pw, current_password: current })
    setBusy(false)
    if (err) {
      setError(
        /current password|invalid/i.test(err.message) && !/same|different/i.test(err.message)
          ? 'Your current password is not right.\nموجودہ پاس ورڈ درست نہیں۔'
          : /same|different/i.test(err.message)
          ? 'Choose a password different from your current one.\nموجودہ پاس ورڈ سے مختلف پاس ورڈ چنیں۔'
          : 'That did not save. Please try again, or message us on WhatsApp 0321 5872222.\nیہ محفوظ نہیں ہوا۔ دوبارہ کوشش کریں۔',
      )
      return
    }
    setCurrent('')
    setPw('')
    setConfirm('')
    toast.success('Password changed.\nپاس ورڈ تبدیل ہو گیا۔')
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      {error && (
        <p role="alert" className="whitespace-pre-line rounded-xl border border-tm-red/30 bg-tm-tint-red p-3 text-xs font-bold text-tm-red">
          {error}
        </p>
      )}
      <label className="block">
        <span className="sr-only">Current password</span>
        <PasswordInput
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          placeholder="Current password"
          autoComplete="current-password"
          className="w-full rounded-xl border border-gray-200 bg-tm-bg p-3 text-xs font-medium"
          required
        />
      </label>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="sr-only">New password</span>
          <PasswordInput
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            placeholder="New password"
            autoComplete="new-password"
            className="w-full rounded-xl border border-gray-200 bg-tm-bg p-3 text-xs font-medium"
            required
          />
        </label>
        <label className="block">
          <span className="sr-only">Confirm new password</span>
          <PasswordInput
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="Confirm new password"
            autoComplete="new-password"
            className="w-full rounded-xl border border-gray-200 bg-tm-bg p-3 text-xs font-medium"
            required
          />
        </label>
      </div>
      <button
        type="submit"
        disabled={busy}
        className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-tm-black px-6 text-xs font-extrabold text-white disabled:opacity-60"
      >
        <Save aria-hidden size={15} /> {busy ? 'Updating…' : 'Update password'}
      </button>
    </form>
  )
}
