// The subject counter under every tutor subject picker (owner, 21 Oct 2026):
// "12 of 15 subjects"; at 15, why nothing more can be added; over 15 (a tutor
// who chose more before the limit), a gentle note. Rules: lib/subjectLimitCore.

import { OVER_LIMIT_NOTE, SUBJECT_LIMIT, SUBJECT_LIMIT_MESSAGE, subjectCounterLabel } from '@/lib/subjectLimitCore'

export default function SubjectLimitNote({ count, refused = false, className = '' }: {
  /** Distinct subjects chosen now. */
  count: number
  /** The tutor just tried to add one past the limit. */
  refused?: boolean
  className?: string
}) {
  const over = count > SUBJECT_LIMIT
  const atLimit = count === SUBJECT_LIMIT
  return (
    <div className={`space-y-0.5 text-[11px] ${className}`} aria-live="polite">
      <p className={`font-bold ${over ? 'text-tm-gold-ink' : 'text-gray-600'}`}>{subjectCounterLabel(count)}</p>
      {over && <p className="font-semibold text-tm-gold-ink">{OVER_LIMIT_NOTE}</p>}
      {(atLimit || (refused && !over)) && <p className={`font-semibold ${refused ? 'text-tm-red' : 'text-gray-600'}`}>{SUBJECT_LIMIT_MESSAGE}</p>}
      {refused && over && <p className="font-semibold text-tm-red">{SUBJECT_LIMIT_MESSAGE}</p>}
    </div>
  )
}
