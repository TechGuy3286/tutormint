'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { ArrowLeft } from 'lucide-react'

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

export function StepShell({
  heading,
  headingUr,
  stepIndex,
  stepTotal,
  onBack,
  backDisabled,
  children,
  buttonLabel,
  onNext,
  nextDisabled = false,
  busy = false,
  hideButton = false,
}: {
  heading: string
  headingUr?: string
  stepIndex: number
  stepTotal: number
  onBack: () => void
  backDisabled: boolean
  children: ReactNode
  buttonLabel: string
  onNext: () => void
  nextDisabled?: boolean
  busy?: boolean
  hideButton?: boolean
}) {
  const kb = useKeyboardInset()

  return (
    <div className="fixed inset-0 z-[60] overflow-y-auto bg-tm-bg">
      <div className="mx-auto flex min-h-full max-w-[480px] flex-col px-4 pb-28">
        {/* header */}
        <header className="sticky top-0 z-10 -mx-4 bg-tm-bg px-4 pb-2 pt-4">
          <div className="mb-2 flex items-center gap-3">
            <span className="text-base font-black text-tm-navy">
              Tutor<span className="text-tm-red">Mint</span>
            </span>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onBack}
              disabled={backDisabled}
              aria-label="Back"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-gray-200 bg-white text-tm-navy disabled:opacity-30"
            >
              <ArrowLeft size={18} />
            </button>
            <div className="min-w-0 flex-1">
              <div className="flex gap-1">
                {Array.from({ length: stepTotal }).map((_, i) => (
                  <span
                    key={i}
                    className={`h-1.5 flex-1 rounded-full ${i < stepIndex ? 'bg-tm-navy' : i === stepIndex ? 'bg-tm-navy/60' : 'bg-gray-200'}`}
                  />
                ))}
              </div>
            </div>
          </div>
        </header>

        <main className="flex-1 pt-6">
          <div className="mb-5 text-center">
            <h1 className="text-xl font-black text-tm-navy">{heading}</h1>
            {headingUr && (
              <p lang="ur" dir="rtl" className="mt-0.5 text-sm leading-relaxed text-gray-500">
                {headingUr}
              </p>
            )}
          </div>
          {children}
        </main>
      </div>

      {/* The truly-fixed button, lifted above the keyboard. */}
      {!hideButton && (
        <div
          className="fixed inset-x-0 z-20 border-t border-gray-200 bg-white px-4"
          style={{
            bottom: kb,
            paddingTop: 12,
            paddingBottom: kb > 0 ? 12 : 'calc(12px + env(safe-area-inset-bottom))',
          }}
        >
          <div className="mx-auto max-w-[480px] space-y-2">
            <button
              type="button"
              onClick={onNext}
              disabled={nextDisabled || busy}
              className="flex min-h-[48px] w-full items-center justify-center rounded-xl bg-tm-navy px-4 text-sm font-black text-white disabled:opacity-40"
            >
              {busy ? '…' : buttonLabel}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
