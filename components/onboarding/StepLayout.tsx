import type { ReactNode } from 'react'

// The ONE onboarding/signup step template (PR106-F §1–§6). Every step renders
// through these pieces so no step invents its own layout:
//
//   <StepHeading en ur />  — the English title with the Urdu on its OWN line
//     below it, the Urdu equal to / slightly smaller than the English (§4).
//   <StepHelp en ur />     — one short optional help line under the fields.
//   <StepButton …/>        — the primary button FIXED at the bottom, above the
//     safe area, with content scrolling clear of it (§2). Nothing renders below
//     it except, optionally, one small skip text-link inside the bar (§3, §6).
//   <Ltr>…</Ltr>           — isolates numbers (CNIC, phone, fees, dates) so they
//     read left-to-right even inside an Urdu (RTL) line (§5).
//
// Presentational only (no hooks), so a server page and the client flow can both
// use it. Brand tokens only.

/** A number/identifier that must read left-to-right even inside Urdu RTL text. */
export function Ltr({ children }: { children: ReactNode }) {
  // <bdi> isolates the run; dir="ltr" forces its internal order, so
  // "42101-1234567-1" never gets bidi-reordered inside a dir="rtl" line.
  return (
    <bdi dir="ltr" className="[unicode-bidi:isolate]">
      {children}
    </bdi>
  )
}

/** The Urdu sub-line, one consistent small size everywhere (§4). */
export function Urdu({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <span lang="ur" dir="rtl" className={`block text-xs leading-relaxed text-gray-500 ${className}`}>
      {children}
    </span>
  )
}

/** The step heading: English title, Urdu on its own line beneath, centred. */
export function StepHeading({ en, ur }: { en: string; ur: string }) {
  return (
    <div className="mb-5 text-center">
      <h1 className="text-xl font-black text-tm-navy">{en}</h1>
      <p lang="ur" dir="rtl" className="mt-0.5 text-sm leading-relaxed text-gray-500">
        {ur}
      </p>
    </div>
  )
}

/** One short help line under a step's fields: English with Urdu beneath. */
export function StepHelp({ en, ur }: { en: string; ur: string }) {
  return (
    <div>
      <p className="text-[11px] leading-relaxed text-gray-500">{en}</p>
      <p lang="ur" dir="rtl" className="text-[11px] leading-relaxed text-gray-500">{ur}</p>
    </div>
  )
}

/**
 * The step's primary button, pinned to the bottom above the safe area. It uses
 * `sticky` (not `position: fixed`): this is the pattern already shipping on the
 * flow's text steps, and it keeps the button above the on-screen keyboard on
 * every platform (a `fixed` bar slides under the iOS keyboard). The step's
 * content scrolls clear of it via the flow's bottom padding. The only thing
 * allowed below the button is one small skip link (§3, §6).
 */
export function StepButton({
  label,
  onClick,
  disabled = false,
  busy = false,
  skip,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  busy?: boolean
  /** Optional small skip text-link, rendered under the button (one shared style). */
  skip?: ReactNode
}) {
  return (
    <div className="sticky bottom-[calc(0.75rem+env(safe-area-inset-bottom))] z-20 space-y-2">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled || busy}
        className="flex min-h-[48px] w-full items-center justify-center rounded-xl bg-tm-navy px-4 text-sm font-black text-white shadow-lg disabled:opacity-40"
      >
        {busy ? '…' : label}
      </button>
      {skip && <div className="text-center">{skip}</div>}
    </div>
  )
}

/** One shared style for every optional skip link (§6). */
export function StepSkip({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="min-h-[40px] text-xs font-bold text-gray-500 underline-offset-2 hover:text-tm-navy hover:underline"
    >
      {children}
    </button>
  )
}
