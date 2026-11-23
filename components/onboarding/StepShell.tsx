'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { ArrowLeft } from 'lucide-react'
import type { ProgressDash } from '@/lib/onboarding/progressCore'

// The ONE shell for every step of the NEW onboarding (PR106-G3c §1). Full-screen
// overlay on EVERY size (plain ground, no site navbar/footer/bell/avatar behind
// it), a minimal header (TutorMint logo ONLY — the leave-midway link was removed
// in PR106-G5 §1.1 so a tutor finishes the flow, going Back if needed, with
// progress saved each step), progress dots, the step heading (English, with an
// Urdu line only when it explains), the step's fields, and ONE bottom button.
//
// The button is position: FIXED (not sticky) and is lifted above the on-screen
// keyboard using window.visualViewport: when the keyboard opens the visual
// viewport shrinks, and we set the bar's `bottom` to the keyboard inset so it
// stays visible right above the input. Content carries bottom padding so it can
// scroll fully clear of the bar.

/** Tracks the on-screen keyboard inset (px from the layout-viewport bottom). */
function useKeyboardInset(): number {
  const [inset, setInset] = useState(0)
  useEffect(() => {
    const vv = typeof window !== 'undefined' ? window.visualViewport : null
    if (!vv) return
    const update = () => {
      // How much the visual viewport is shrunk from the layout viewport bottom —
      // i.e. the keyboard height (0 when closed).
      const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop)
      setInset(kb)
    }
    update()
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    return () => {
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
    }
  }, [])
  return inset
}

export type ShellProgress = {
  dashes: ProgressDash[]
  /** "9 of 16 steps done" — the same number as every other card. */
  line: string
  /** A done dash opens its step (PR-17 C.4). */
  onJump?: (step: ProgressDash['step']) => void
}

export function StepShell({
  heading,
  headingUr,
  progress,
  onBack,
  backDisabled,
  children,
  buttonLabel,
  onNext,
  nextDisabled = false,
  nextHint,
  busy = false,
  hideButton = false,
  wide = false,
  onSaveLater,
}: {
  heading: string
  headingUr?: string
  progress: ShellProgress
  onBack: () => void
  backDisabled: boolean
  children: ReactNode
  buttonLabel: string
  onNext: () => void
  nextDisabled?: boolean
  /** Shown under the buttons while Next is disabled: what is missing (C.5). */
  nextHint?: string
  busy?: boolean
  hideButton?: boolean
  /** Laptop (≥1024 px): a wider two-column window that fits 768 px tall
   *  (owner, 2 Nov 2026). Phones are unchanged. */
  wide?: boolean
  /** "Save and finish later" — every finished step is already saved; this
   *  goes to the dashboard (C.5). Hidden when not given. */
  onSaveLater?: () => void
}) {
  const kb = useKeyboardInset()

  return (
    <div className="fixed inset-0 z-[60] overflow-y-auto bg-tm-bg">
      <div className={`mx-auto flex min-h-full max-w-[480px] flex-col px-4 pb-40 ${wide ? 'lg:max-w-[960px] lg:pb-36' : ''}`} data-wide={wide ? '' : undefined}>
        {/* header */}
        <header className="sticky top-0 z-10 -mx-4 bg-tm-bg px-4 pb-2 pt-4">
          <div className="mb-2 flex items-center justify-between gap-3">
            <span className="text-base font-black text-tm-navy">
              Tutor<span className="text-tm-red">Mint</span>
            </span>
            <span className="text-xs font-bold text-slate-700" data-progress-line="">{progress.line}</span>
          </div>
          {/* One dash per item — the same items as "X of 16 steps done". A done
              dash opens its step; the current one is outlined. */}
          <ol className="flex gap-1" aria-label={progress.line}>
            {progress.dashes.map((d) => {
              const cls = `block h-1.5 w-full rounded-full ${d.done ? 'bg-tm-navy' : d.current ? 'bg-tm-navy/50' : 'bg-gray-200'}`
              return (
                <li key={d.key} className="flex-1" data-dash={d.key} data-done={d.done ? '' : undefined} data-current={d.current ? '' : undefined}>
                  {d.done && progress.onJump && !d.current ? (
                    <button
                      type="button"
                      onClick={() => progress.onJump?.(d.step)}
                      aria-label={`Edit: ${d.label}`}
                      className="flex h-6 w-full items-center"
                    >
                      <span className={cls} />
                    </button>
                  ) : (
                    <span className="flex h-6 w-full items-center" aria-current={d.current ? 'step' : undefined} aria-label={`${d.label}${d.done ? ' — done' : ''}`}>
                      <span className={cls} />
                    </span>
                  )}
                </li>
              )
            })}
          </ol>
        </header>

        <main className={`flex-1 pt-4 ${wide ? 'lg:pt-2' : ''}`}>
          <div className={`mb-5 text-center ${wide ? 'lg:mb-3' : ''}`}>
            <h1 className="text-xl font-black text-tm-navy">{heading}</h1>
            {headingUr && (
              <p lang="ur" dir="rtl" className="tm-ur-cap text-xl font-bold leading-snug text-gray-500">
                {headingUr}
              </p>
            )}
          </div>
          {children}
        </main>
      </div>

      {/* The truly-fixed bar: Back + Next, lifted above the keyboard, flush to
          the bottom with the safe area inside it (PR-17 C.5 / G.1). */}
      <div
        className="tm-bottom-bar fixed inset-x-0 z-20 border-t border-gray-200 bg-white px-4"
        data-sticky-bar=""
        style={{
          bottom: kb,
          paddingTop: 10,
          paddingBottom: kb > 0 ? 10 : 'calc(10px + env(safe-area-inset-bottom))',
        }}
      >
        <div className={`mx-auto max-w-[480px] space-y-1.5 ${wide ? 'lg:max-w-[960px]' : ''}`}>
          <div className={`grid gap-2 ${hideButton ? 'grid-cols-1' : 'grid-cols-[minmax(0,1fr)_minmax(0,2fr)]'}`}>
            <button
              type="button"
              onClick={onBack}
              disabled={backDisabled}
              className="flex min-h-[48px] items-center justify-center gap-1.5 rounded-xl border-2 border-tm-navy bg-white px-3 text-sm font-black text-tm-navy disabled:border-gray-200 disabled:text-gray-500"
            >
              <ArrowLeft aria-hidden size={16} />
              Back
            </button>
            {!hideButton && (
              <button
                type="button"
                onClick={onNext}
                disabled={nextDisabled || busy}
                aria-describedby={nextDisabled && nextHint ? 'tm-next-hint' : undefined}
                className="flex min-h-[48px] w-full items-center justify-center rounded-xl bg-tm-navy px-4 text-sm font-black text-white disabled:opacity-40"
              >
                {busy ? '…' : buttonLabel}
              </button>
            )}
          </div>
          {!hideButton && nextDisabled && nextHint && (
            <p id="tm-next-hint" className="text-center text-[11px] font-semibold text-slate-700" data-next-hint="">
              {nextHint}
            </p>
          )}
          {onSaveLater && (
            <button
              type="button"
              onClick={onSaveLater}
              className="mx-auto block min-h-[32px] px-2 text-[11px] font-bold text-tm-navy underline-offset-2 hover:underline"
            >
              Save and finish later
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
