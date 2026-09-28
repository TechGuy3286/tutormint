import { Check } from 'lucide-react'
import type { ChecklistItem } from '@/lib/formChecklist'
import { firstMissing } from '@/lib/formChecklist'

// The self-explaining-form UI (PR80), used by every multi-part onboarding step
// and Settings form (tutor and parent). Two pieces, both presentational:
//
//   <FormChecklist items /> — the numbered required parts, each with a tick once
//     done and "(optional)" on the optional ones. Placed at the top of the form.
//   <ChecklistStatus items /> — the line UNDER the Save/Continue button: exactly
//     what is still missing, or "Ready to save". Placed under the button.
//
// The form owns its Save button and disables it with checklistReady(items). No
// save path, API or validation changes — the items' `done` flags mirror the
// server's existing rules so there is no surprise error after Save.

export function FormChecklist({ items, className = '' }: { items: ChecklistItem[]; className?: string }) {
  return (
    <ol className={`space-y-1.5 ${className}`}>
      {items.map((it, i) => (
        <li key={i} className="flex items-start gap-2">
          <span
            aria-hidden
            className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-[10px] font-black ${
              it.done ? 'bg-tm-green-deep text-white' : 'border border-gray-300 text-gray-500'
            }`}
          >
            {it.done ? <Check size={12} /> : i + 1}
          </span>
          <span className="min-w-0">
            <span className={`text-xs font-semibold ${it.done ? 'text-gray-500' : 'text-tm-navy'}`}>
              {it.en}
              {it.optional ? ' (optional)' : ''}
            </span>
            <span lang="ur" dir="rtl" className="block text-[11px] text-gray-500">
              {it.ur}
              {it.optional ? ' (اختیاری)' : ''}
            </span>
          </span>
        </li>
      ))}
    </ol>
  )
}

export function ChecklistStatus({ items, className = '' }: { items: ChecklistItem[]; className?: string }) {
  const miss = firstMissing(items)
  if (!miss) {
    return (
      <p className={`text-center text-[11px] font-semibold text-tm-green-deep ${className}`}>
        Ready to save
        <span lang="ur" dir="rtl" className="block font-normal text-gray-500">
          محفوظ کرنے کے لیے تیار
        </span>
      </p>
    )
  }
  return (
    <p className={`text-center text-[11px] text-gray-500 ${className}`}>
      {miss.en} to continue
      <span lang="ur" dir="rtl" className="block">
        {miss.ur} — جاری رکھنے کے لیے
      </span>
    </p>
  )
}
