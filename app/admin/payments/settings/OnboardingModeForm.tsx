'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

import { adminFetch } from '@/components/admin/adminFetch'
import { useToast } from '@/components/ui/Toast'
import type { OnboardingMode } from '@/lib/onboardingMode'

// PR106-G3 §1: the owner-only "New onboarding" rollout switch. Off / Staff only
// / Everyone. "Staff only" (the default) shows the new flow to owner + staff and
// the current flow to everyone else; "Everyone" gives all tutors the new flow;
// "Off" is the instant fallback to the current flow.

const ROWS: { value: OnboardingMode; title: string; sub: string }[] = [
  { value: 'off', title: 'Off', sub: 'Everyone sees the current onboarding (instant fallback).' },
  { value: 'staff', title: 'Staff only', sub: 'Owner + staff see the new onboarding; everyone else the current one.' },
  { value: 'everyone', title: 'Everyone', sub: 'All tutors get the new onboarding.' },
]

export default function OnboardingModeForm({ initial }: { initial: OnboardingMode }) {
  const router = useRouter()
  const toast = useToast()
  const [mode, setMode] = useState<OnboardingMode>(initial)
  const [busy, setBusy] = useState(false)

  const pick = async (next: OnboardingMode) => {
    if (next === mode || busy) return
    setBusy(true)
    const { ok, data } = await adminFetch<{ error?: string }>('/api/admin/onboarding-mode', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: next }),
    })
    setBusy(false)
    if (ok) {
      setMode(next)
      toast.success('Saved.')
      router.refresh()
    } else {
      toast.error(data?.error ?? 'Could not save.')
    }
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <h2 className="text-sm font-black text-tm-navy">New onboarding</h2>
        <p className="text-[11px] text-gray-500">Owner only. Each change is recorded in the audit log.</p>
      </div>
      <div className="space-y-2" role="radiogroup" aria-label="New onboarding">
        {ROWS.map((r) => {
          const on = mode === r.value
          return (
            <button
              key={r.value}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={busy}
              onClick={() => void pick(r.value)}
              className={`flex w-full items-start gap-3 rounded-2xl border-2 p-4 text-left transition-colors disabled:opacity-60 ${
                on ? 'border-tm-navy bg-tm-tint-navy' : 'border-gray-200 bg-white hover:border-gray-300'
              }`}
            >
              <span className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border-2 ${on ? 'border-tm-navy' : 'border-gray-300'}`}>
                {on && <span className="h-2.5 w-2.5 rounded-full bg-tm-navy" />}
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-bold text-tm-navy">{r.title}</span>
                <span className="block text-[11px] text-gray-500">{r.sub}</span>
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
