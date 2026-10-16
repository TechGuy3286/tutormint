'use client'

import { reasonAppliesTo, reasonsFor, REJECT_FALLBACK, type RejectTarget } from '@/lib/rejectReasonsCore'

// Quick rejection reasons (owner, Part F): one tap selects a reason, a second
// tap clears it; free text is optional and is added after the reason. With
// nothing chosen or typed, the member is told the fallback reason. The text
// built from these (buildRejectReason) is what the in-app notice, the email
// and the WhatsApp re-upload message all carry.

export default function RejectReasonPicker({
  target,
  chosen,
  onChoose,
  freeText,
  onFreeText,
  audience = 'tutor',
}: {
  target: RejectTarget
  chosen: string | null
  onChoose: (reason: string | null) => void
  freeText: string
  onFreeText: (text: string) => void
  audience?: 'tutor' | 'parent'
}) {
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap gap-1" role="group" aria-label="Reason for rejecting">
        {reasonsFor(target).map((r) => {
          const on = chosen === r
          const relevant = reasonAppliesTo(r, target)
          return (
            <button
              key={r}
              type="button"
              aria-pressed={on}
              onClick={() => onChoose(on ? null : r)}
              className={`min-h-[32px] rounded-lg border px-2 py-1 text-[10px] hover:border-tm-navy ${
                on
                  ? 'border-tm-navy bg-tm-tint-navy font-bold text-tm-navy'
                  : relevant
                    ? 'border-gray-300 text-slate-700'
                    : 'border-gray-200 text-gray-500'
              }`}
            >
              {r}
            </button>
          )
        })}
      </div>
      <textarea
        value={freeText}
        onChange={(e) => onFreeText(e.target.value)}
        rows={2}
        placeholder={`Add a note for the ${audience} (optional)`}
        className="w-full rounded-lg border border-gray-200 p-2 text-[11px] outline-none focus:border-tm-red"
      />
      {!chosen && !freeText.trim() && (
        <p className="text-[10px] text-gray-500">No reason chosen — the {audience} will be told: “{REJECT_FALLBACK}”</p>
      )}
    </div>
  )
}
