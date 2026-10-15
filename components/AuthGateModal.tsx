'use client'

import { ArrowLeft, LogIn, UserPlus } from 'lucide-react'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { applyReturnPath, authHref, safeReturnTo } from '@/lib/returnTo'

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
    title: 'Apply for this tuition',
    body: 'Join free to apply. We bring you back to this tuition when you are done.',
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
    body: 'Demo lessons are free. Sign in so the tutor knows who is asking.',
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

/** Read a draft WITHOUT clearing it — a list of cards peeks, and only the card
 *  the draft names clears it (clearDraft) and resumes (owner hotfix, 5 Oct 2026). */
export function peekDraft<T = unknown>(intent: AuthIntent): T | null {
  try {
    const raw = sessionStorage.getItem(DRAFT_PREFIX + intent)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

export function clearDraft(intent: AuthIntent) {
  try {
    sessionStorage.removeItem(DRAFT_PREFIX + intent)
  } catch {
    /* nothing to clear */
  }
}

/** The one-shot "focus the message box" flag the thread page reads on mount
 *  (set by the card / profile Message button before it navigates). */
export const FOCUS_COMPOSER_KEY = 'tutormint_focus_composer'

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
  const isApply = intent === 'apply'

  // Where the guest comes back to. For Apply it is the TUITION page with the
  // Apply-ready flag (owner, 15 Oct 2026), so the button is waiting for them
  // after sign-up (through mobile verification and onboarding) or sign-in.
  const returnTarget = () => {
    const here = typeof window !== 'undefined' ? window.location.pathname + window.location.search : '/'
    const base = next ?? here
    return isApply ? applyReturnPath(base) : (safeReturnTo(base) ?? '/')
  }

  // Carry the role the sign-up form should start on (owner PR33 §3): every
  // gated action here is a PARENT one except applying, which is the tutor's.
  // /login forwards this to its "Create an account" link, so a guest who
  // messages a tutor lands on a sign-up form with Parent pre-selected — even
  // though `next` is that tutor's own page.
  const role = isApply ? 'tutor' : 'parent'

  const go = (page: '/register' | '/login') => {
    if (draft !== undefined) saveDraft(intent, draft)
    router.push(authHref(page, returnTarget(), role))
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

        {isApply ? (
          // Apply (owner, 15 Oct 2026): joining comes FIRST — "Sign in to apply"
          // read as members-only to a visitor who has no account yet.
          <div className="space-y-2 pt-1">
            <button
              type="button"
              onClick={() => go('/register')}
              className="inline-flex w-full min-h-[44px] items-center justify-center gap-2 py-3 bg-tm-red hover:bg-tm-red-hover text-white font-bold text-sm rounded-xl transition-colors"
            >
              <UserPlus aria-hidden size={16} />
              Join free — new tutor
            </button>
            <button
              type="button"
              onClick={() => go('/login')}
              className="inline-flex w-full min-h-[44px] items-center justify-center text-xs font-bold text-tm-navy hover:underline"
            >
              Already have an account? Sign in
            </button>
          </div>
        ) : (
          <div className="space-y-2 pt-1">
            <button
              type="button"
              onClick={() => go('/login')}
              className="inline-flex w-full min-h-[44px] items-center justify-center gap-2 py-3 bg-tm-red hover:bg-tm-red-hover text-white font-bold text-xs rounded-xl transition-colors"
            >
              <LogIn aria-hidden size={14} />
              {copy.cta}
            </button>
            <button
              type="button"
              onClick={() => go('/register')}
              className="inline-flex w-full min-h-[44px] items-center justify-center text-xs font-bold text-tm-navy hover:underline"
            >
              New here? Join free
            </button>
          </div>
        )}

        <button
          type="button"
          onClick={onClose}
          className="inline-flex w-full min-h-[44px] items-center justify-center gap-2 text-xs font-bold text-slate-600 hover:text-slate-800"
        >
          <ArrowLeft aria-hidden size={14} />
          Keep browsing
        </button>

        <p className="text-center text-[11px] text-gray-500">
          Browsing tutors and tuitions is always free.
        </p>
      </div>
    </div>
  )
}
