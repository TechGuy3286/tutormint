'use client'

import { useState } from 'react'
import { GraduationCap, Users, Loader2 } from 'lucide-react'
import { submitJson } from '@/lib/submit'

// "Continue as Tutor or Parent?" (owner, 8 Oct 2026). Shown after the password
// or the code when the mobile holds two LINKED accounts. Choosing the role the
// session already has just continues; the other one asks the server to switch
// the session (it mints the linked account's sign-in itself). Each account keeps
// its own data.

export default function RolePicker({ onDone }: { onDone: (next: string) => void }) {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const pick = async (role: 'tutor' | 'parent') => {
    setBusy(role)
    setError(null)
    const { ok, data, error: err } = await submitJson<{ next?: string }>('/api/auth/switch-role', { role })
    if (!ok || !data?.next) {
      setBusy(null)
      setError(err ?? 'That did not go through. Please try again.')
      return
    }
    onDone(data.next)
  }

  const btn =
    'flex min-h-[64px] w-full items-center gap-3 rounded-2xl border-2 border-gray-200 bg-white px-4 text-left transition-colors hover:border-tm-navy disabled:opacity-60'

  return (
    <div className="space-y-4">
      <div className="space-y-1 text-center">
        <h2 className="text-lg font-black text-tm-navy">Continue as Tutor or Parent?</h2>
        <p lang="ur" dir="rtl" className="text-sm text-gray-500">
          ٹیوٹر کے طور پر جاری رکھیں یا والدین کے طور پر؟
        </p>
      </div>
      <button type="button" className={btn} disabled={!!busy} onClick={() => pick('tutor')}>
        {busy === 'tutor' ? <Loader2 aria-hidden size={22} className="animate-spin text-tm-green-deep" /> : <GraduationCap aria-hidden size={22} className="text-tm-green-deep" />}
        <span>
          <span className="block text-sm font-black text-tm-navy">Tutor</span>
          <span lang="ur" dir="rtl" className="block text-xs text-gray-500">ٹیوٹر</span>
        </span>
      </button>
      <button type="button" className={btn} disabled={!!busy} onClick={() => pick('parent')}>
        {busy === 'parent' ? <Loader2 aria-hidden size={22} className="animate-spin text-tm-navy" /> : <Users aria-hidden size={22} className="text-tm-navy" />}
        <span>
          <span className="block text-sm font-black text-tm-navy">Parent</span>
          <span lang="ur" dir="rtl" className="block text-xs text-gray-500">والدین</span>
        </span>
      </button>
      {error && (
        <p role="alert" className="whitespace-pre-line rounded-xl bg-tm-tint-red p-3 text-xs font-bold text-tm-red">
          {error}
        </p>
      )}
    </div>
  )
}
