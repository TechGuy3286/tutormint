'use client'

import { DAYS, SLOTS, normalizeSlots, type DaySlot, type DayKey, type SlotKey } from '@/lib/timeSlots'

// The one time-slot grid (PR73 §A): 7 rows (Mon–Sun) × 3 tap-to-select slots
// (Morning / Afternoon / Evening). English over Urdu, phone-first at 360px, 44px
// tap targets, selected = filled. Used by tutor onboarding, tutor Settings, and
// the shared post-a-tuition form (parent + admin) — everywhere a time is entered.
//
// PURE presentational: the value is a DaySlot[] and every change is handed back
// through onChange; the caller owns saving.

export default function TimeSlotGrid({
  value,
  onChange,
  disabled = false,
}: {
  value: DaySlot[]
  onChange: (next: DaySlot[]) => void
  disabled?: boolean
}) {
  const has = (day: DayKey, slot: SlotKey) => value.some((v) => v.day === day && v.slot === slot)
  const toggle = (day: DayKey, slot: SlotKey) => {
    if (disabled) return
    const next = has(day, slot)
      ? value.filter((v) => !(v.day === day && v.slot === slot))
      : [...value, { day, slot }]
    onChange(normalizeSlots(next))
  }

  return (
    <div className="space-y-2">
      {/* header row of slot labels (English + Urdu) */}
      <div className="grid grid-cols-[3.5rem_repeat(3,1fr)] items-end gap-1.5">
        <span aria-hidden />
        {SLOTS.map((s) => (
          <span key={s.key} className="text-center">
            <span className="block text-[11px] font-black text-tm-navy">{s.en}</span>
            <span className="block text-[10px] text-gray-500" lang="ur" dir="rtl">{s.ur}</span>
          </span>
        ))}
      </div>

      {DAYS.map((d) => (
        <div key={d.key} className="grid grid-cols-[3.5rem_repeat(3,1fr)] items-stretch gap-1.5">
          <span className="flex flex-col justify-center">
            <span className="text-[11px] font-bold text-tm-navy">{d.short}</span>
            <span className="text-[10px] text-gray-500" lang="ur" dir="rtl">{d.ur}</span>
          </span>
          {SLOTS.map((s) => {
            const on = has(d.key, s.key)
            return (
              <button
                key={s.key}
                type="button"
                role="switch"
                aria-checked={on}
                aria-label={`${d.full} ${s.en}`}
                disabled={disabled}
                onClick={() => toggle(d.key, s.key)}
                className={`min-h-[44px] rounded-xl border text-xs font-bold transition-colors disabled:opacity-50 ${
                  on
                    ? 'border-tm-green-deep bg-tm-green-deep text-white'
                    : 'border-gray-200 bg-white text-gray-500 hover:border-tm-green-deep'
                }`}
              >
                {on ? '✓' : ''}
              </button>
            )
          })}
        </div>
      ))}
    </div>
  )
}
