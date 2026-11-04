'use client'

// Experience on Edit Profile (owner, 4 Nov 2026 hotfix): the onboarding bands as
// chips, a Save button and a "Saved." line. `onSave` writes the value (the page
// posts it to /api/profile/save, which rebuilds the cached public profile).

import { useState } from 'react'
import { Save } from 'lucide-react'
import { EXPERIENCE_CHOICES } from '@/lib/experienceEditCore'

export default function ExperienceEditor({
  initialYears,
  onSave,
  onSaved,
}: {
  initialYears: number | null
  onSave: (years: number) => Promise<void>
  onSaved?: (years: number) => void
}) {
  const [years, setYears] = useState<number | null>(initialYears)
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [msg, setMsg] = useState('')

  const run = async () => {
    if (years == null) return
    setState('saving')
    setMsg('')
    try {
      await onSave(years)
      setState('saved')
      onSaved?.(years)
    } catch (e) {
      setState('error')
      setMsg(e instanceof Error ? e.message : 'Could not save.')
    }
  }

  return (
    <div className="space-y-3" data-editor="experience">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Years of experience">
        {EXPERIENCE_CHOICES.map((c) => {
          const on = years === c.years
          return (
            <button
              key={c.years}
              type="button"
              aria-pressed={on}
              onClick={() => {
                setYears(c.years)
                if (state !== 'saving') setState('idle')
              }}
              className={`inline-flex min-h-[44px] items-center rounded-xl border px-4 text-xs font-bold transition-colors ${
                on
                  ? 'border-tm-green-deep/30 bg-tm-tint-green text-tm-green-deep'
                  : 'border-gray-200 bg-tm-bg text-gray-700 hover:bg-gray-100'
              }`}
            >
              {c.label}
            </button>
          )
        })}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void run()}
          disabled={state === 'saving' || years == null}
          className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-tm-red px-5 text-xs font-extrabold text-white transition-colors hover:bg-tm-red-hover disabled:opacity-60"
        >
          <Save aria-hidden size={14} /> {state === 'saving' ? 'Saving…' : 'Save'}
        </button>
        {state === 'saved' && (
          <p className="rounded-xl border border-tm-green-deep/30 bg-tm-tint-green px-3 py-2 text-[11px] font-bold text-tm-green-deep">
            Saved.
          </p>
        )}
        {state === 'error' && (
          <p role="alert" className="rounded-xl border border-tm-red/30 bg-tm-tint-red px-3 py-2 text-[11px] font-bold text-tm-red">
            {msg}
          </p>
        )}
      </div>
    </div>
  )
}
