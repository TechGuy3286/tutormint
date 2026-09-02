'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

// "Sign in to continue" — the moment a guest attempts a transactional action.
//
// Product philosophy: browsing is free and nobody is asked to sign in until
// they try to apply, post, message, request a demo, shortlist or hire. This
// modal is that moment: it preserves whatever the user had typed, sends them
// to /login?next=, and hands the draft back afterwards.
//
// sessionStorage here holds an unsaved DRAFT only, never login or role state.

export type AuthIntent = 'apply' | 'post' | 'message' | 'demo' | 'shortlist' | 'hire'

const COPY: Record<AuthIntent, { title: string; body: string; cta: string }> = {
  apply: {
    title: 'Sign in to apply',
    body: 'Create a free tutor account to apply for this tuition. Your application is saved.',
    cta: 'Sign in and apply',
  },
  post: {
    title: 'Sign in to post your job',
    body: "Your job details are saved — you'll come straight back to them.",
    cta: 'Sign in and post',
  },
  message: {
    title: 'Sign in to send a message',
    body: 'Messaging happens inside TutorMint so both sides stay protected.',
    cta: 'Sign in to message',
  },
  demo: {
    title: 'Sign in to request a demo',
    body: 'Demo classes are free. Sign in so the tutor knows who is asking.',
    cta: 'Sign in and request',
  },
  shortlist: {
    title: 'Sign in to shortlist',
    body: 'Save tutors to your shortlist and come back to them any time.',
    cta: 'Sign in to save',
  },
  hire: {
    title: 'Sign in to hire',
    body: 'Sign in to your parent account to hire this tutor.',
    cta: 'Sign in to hire',
  },
}

const DRAFT_PREFIX = 'tutormint_draft_'

/** Store an unsaved draft so it survives the round trip through /login. */
export function saveDraft(intent: AuthIntent, draft: unknown) {
  try {
    sessionStorage.setItem(DRAFT_PREFIX + intent, JSON.stringify(draft))
  } catch {
    // Private mode or storage disabled: the draft is a convenience, not a
    // requirement, so losing it must not break the flow.
  }
}

/** Read back and clear a draft saved before sign-in. */
export function takeDraft<T = unknown>(intent: AuthIntent): T | null {
  try {
    const raw = sessionStorage.getItem(DRAFT_PREFIX + intent)
    if (!raw) return null
    sessionStorage.removeItem(DRAFT_PREFIX + intent)
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

export default function AuthGateModal({
  open,
  intent,
  next,
  draft,
  onClose,
}: {
  open: boolean
  intent: AuthIntent
  /** Where to return after signing in. Defaults to the current path. */
  next?: string
  /** Anything the user had already typed or chosen. */
  draft?: unknown
  onClose: () => void
}) {
  const router = useRouter()

  // Escape closes; body scroll locks while open.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [open, onClose])

  if (!open) return null

  const copy = COPY[intent]

  const goToLogin = () => {
    if (draft !== undefined) saveDraft(intent, draft)
    const target = next ?? (typeof window !== 'undefined' ? window.location.pathname : '/')
    router.push(`/login?next=${encodeURIComponent(target)}`)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-tm-black/50 p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="authgate-title"
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-sm bg-white rounded-t-3xl sm:rounded-3xl p-6 space-y-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="space-y-1.5">
          <h2 id="authgate-title" className="text-base font-black text-tm-navy">
            {copy.title}
          </h2>
          <p className="text-xs text-gray-600 leading-relaxed">{copy.body}</p>
        </div>

        <div className="space-y-2 pt-1">
          <button
            onClick={goToLogin}
            className="w-full min-h-[44px] py-3 bg-tm-red hover:bg-tm-red-hover text-white font-bold text-xs uppercase tracking-wider rounded-xl transition-colors"
          >
            {copy.cta}
          </button>
          <button
            onClick={onClose}
            className="w-full min-h-[44px] py-3 bg-tm-bg hover:bg-gray-100 text-slate-700 font-bold text-xs rounded-xl border border-gray-200 transition-colors"
          >
            Keep browsing
          </button>
        </div>

        <p className="text-center text-[11px] text-gray-500">
          Browsing tutors and tuitions is always free.
        </p>
      </div>
    </div>
  )
}
