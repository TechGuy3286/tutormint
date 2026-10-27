'use client'

import { ShieldCheck } from 'lucide-react'
import { CONSENT_METHOD_LABEL, CONSENT_TICK_LABEL, STAFF_CONSENT_METHODS } from '@/lib/tuitionConsentCore'

// Parent consent on staff Post a tuition and admin edit (owner, 27 Oct 2026).
// The tick and the method are REQUIRED before the tuition saves — the form
// checks first, and createTeamJob / updateTeamJob refuse without them. The note
// is optional.

export type ConsentValue = { agreed: boolean; method: string; note: string }

const FIELD =
  'w-full min-h-[44px] rounded-xl border border-gray-200 bg-white px-3 text-xs font-semibold text-tm-navy outline-none focus:border-tm-red'

export default function ConsentBox({ value, onChange }: { value: ConsentValue; onChange: (next: ConsentValue) => void }) {
  return (
    <fieldset className="space-y-3 rounded-xl border border-tm-navy/30 bg-tm-tint-navy p-3" data-consent-box="">
      <legend className="sr-only">Parent consent</legend>
      <p className="flex items-start gap-2 text-[11px] leading-relaxed text-slate-700">
        <ShieldCheck size={13} className="mt-px shrink-0 text-tm-navy" aria-hidden />
        <span>
          <strong>Parent consent (required).</strong> Only list a tuition the parent has agreed to. Without it, tutors never see
          the parent’s number.
        </span>
      </p>
      <label className="flex min-h-[44px] items-center gap-2 text-xs font-bold text-tm-navy">
        <input
          type="checkbox"
          checked={value.agreed}
          onChange={(e) => onChange({ ...value, agreed: e.target.checked })}
          required
          aria-required="true"
          className="h-5 w-5 shrink-0"
        />
        {CONSENT_TICK_LABEL}
      </label>
      <label className="block space-y-1">
        <span className="text-[11px] font-bold uppercase tracking-wide text-gray-600">How did they agree? (required)</span>
        <select
          value={value.method}
          onChange={(e) => onChange({ ...value, method: e.target.value })}
          required
          aria-required="true"
          className={FIELD}
        >
          <option value="">Choose…</option>
          {STAFF_CONSENT_METHODS.map((m) => (
            <option key={m} value={m}>
              {CONSENT_METHOD_LABEL[m]}
            </option>
          ))}
        </select>
      </label>
      <label className="block space-y-1">
        <span className="text-[11px] font-bold uppercase tracking-wide text-gray-600">Note (optional)</span>
        <input
          value={value.note}
          onChange={(e) => onChange({ ...value, note: e.target.value })}
          maxLength={500}
          placeholder="e.g. Spoke to the mother on 27 Oct"
          className={FIELD}
        />
      </label>
    </fieldset>
  )
}
