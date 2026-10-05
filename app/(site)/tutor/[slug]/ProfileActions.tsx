'use client'

import Link from 'next/link'
import { postGated } from '@/lib/gatedFetch'
import { armEscape, submitSignal } from '@/lib/submit'
import { useUpgradeSheet } from '@/components/upgrade/UpgradeProvider'
import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Heart, Play, MessageCircle } from 'lucide-react'
import AuthGateModal, { clearDraft, peekDraft, FOCUS_COMPOSER_KEY, type AuthIntent } from '@/components/AuthGateModal'
import HireButton from '@/components/parent/HireButton'

// The transactional actions on a public profile.
//
// Sticky at the bottom on mobile -- the primary action must be reachable
// without scrolling back up a long profile -- and a normal inline bar from sm.
//
// Guests are not blocked from the page, only from the action: the sign-in
// modal opens at the moment they press, with the tutor kept as a draft so they
// come back to the same place. Nobody is asked to register to read a profile.
//
// Messaging is live from T5. Who may OPEN a conversation is decided in
// lib/messaging.ts, and the refusal text it returns is shown as-is: an
// unverified parent is told to verify rather than just told no.

export default function ProfileActions({
  tutorId,
  tutorName,
  signedIn,
  isSelf,
  initiallySaved,
  canMessage,
  isParent = false,
  hired = false,
}: {
  tutorId: string
  tutorName: string
  signedIn: boolean
  isSelf: boolean
  initiallySaved: boolean
  /** False for a tutor viewing another tutor: they have nothing to say here. */
  canMessage: boolean
  /** The viewer is a signed-in parent — they get the Hire button (§2.1). */
  isParent?: boolean
  /** This parent has already hired this tutor — the button shows "Hired" (§2.3). */
  hired?: boolean
}) {
  const upgradeSheet = useUpgradeSheet()
  const [saved, setSaved] = useState(initiallySaved)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  // A link to similar tutors when a request is refused at the tutor's monthly
  // limit — so the parent is never a dead end (PR54 Part B).
  const [noticeHref, setNoticeHref] = useState<string | null>(null)
  const [gateOpen, setGateOpen] = useState(false)
  const [gateIntent, setGateIntent] = useState<AuthIntent>('shortlist')
  const searchParams = useSearchParams()
  const resumeMessage = searchParams?.get('message') === '1'
  const resumeDemo = searchParams?.get('demo') === '1'

  // Resume (owner hotfix, 5 Oct 2026): after sign-up the kept draft names this
  // tutor; after verification the return URL carries ?message=1. Either reopens
  // the message flow once. Hooks run before the isSelf early return.
  useEffect(() => {
    if (!signedIn || isSelf) return
    const stripParam = (name: string) => {
      try {
        const url = new URL(window.location.href)
        url.searchParams.delete(name)
        window.history.replaceState(null, '', url.toString())
      } catch {
        /* leave the URL */
      }
    }
    const m = peekDraft<{ tutorId?: string }>('message')
    if (canMessage && (m?.tutorId === tutorId || resumeMessage)) {
      if (m?.tutorId === tutorId) clearDraft('message')
      if (resumeMessage) stripParam('message')
      void message()
      return
    }
    // The same round trip for a demo (owner, 5 Oct 2026): the kept sign-up
    // draft, or ?demo=1 from the verification step.
    const d = peekDraft<{ tutorId?: string }>('demo')
    if (d?.tutorId === tutorId || resumeDemo) {
      if (d?.tutorId === tutorId) clearDraft('demo')
      if (resumeDemo) stripParam('demo')
      void requestDemo()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn, canMessage, isSelf, tutorId])

  // Your own profile (owner, 5 Oct 2026): the buttons stay, greyed out and
  // disabled, with one line — so a tutor sees the page as parents see it. The
  // server refuses self-shortlist / self-demo / self-message regardless.
  if (isSelf) {
    const dead =
      'inline-flex min-h-[44px] flex-1 cursor-not-allowed items-center justify-center gap-1.5 rounded-xl bg-gray-200 px-4 text-xs font-bold text-slate-600'
    return (
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-gray-200 bg-white/95 p-3 backdrop-blur sm:static sm:mx-auto sm:mt-4 sm:max-w-3xl sm:rounded-2xl sm:border sm:p-4">
        <div className="mx-auto flex max-w-3xl flex-wrap gap-2">
          <button type="button" disabled className={dead}>
            <Heart size={14} /> Shortlist
          </button>
          <button type="button" disabled className={dead}>
            <Play size={14} /> Request demo
          </button>
          <button type="button" disabled className={dead}>
            <MessageCircle size={14} /> Message
          </button>
        </div>
        <p className="pt-2 text-center text-[11px] font-semibold text-gray-500">This is your profile, as parents see it.</p>
      </div>
    )
  }

  const gate = (intent: AuthIntent) => {
    setGateIntent(intent)
    setGateOpen(true)
  }

  const toggleShortlist = async () => {
    if (!signedIn) return gate('shortlist')
    setBusy(true)
    setNotice(null)
    try {
      const res = await fetch('/api/shortlist', { signal: submitSignal(),
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tutorId, action: saved ? 'remove' : 'add' }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not update your shortlist.')
      setSaved(json.saved)
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Could not update your shortlist.')
    } finally {
      setBusy(false)
    }
  }

  const requestDemo = async () => {
    if (!signedIn) return gate('demo')
    setBusy(true)
    setNotice(null)
    setNoticeHref(null)
    try {
      // Same gated call as Message (owner, 5 Oct 2026): an unverified parent's
      // refusal opens the verification gate with the way back to this tutor.
      const r = await postGated<{ id: string }>('/api/demo/request', { tutorId }, upgradeSheet?.showGate)
      if (!r.ok) {
        if (!r.gated) {
          setNotice(r.error)
          setNoticeHref(r.similarHref ?? null)
        }
        return
      }
      setNotice(`Demo requested. ${tutorName.split(' ')[0]} will reply with a time.`)
    } finally {
      setBusy(false)
    }
  }

  const message = async () => {
    if (!signedIn) return gate('message')
    setBusy(true)
    setNotice(null)
    const r = await postGated<{ threadId: string }>(
      '/api/messages/thread',
      { otherId: tutorId },
      upgradeSheet?.showGate,
    )
    if (r.ok) {
      // A full navigation, so the spinner is meant to end with the page. It is
      // still given a deadline: a browser that blocks or loses the assignment
      // would otherwise leave this button disabled with the thread already
      // created and no way to reach it.
      const href = `/messages/${r.data.threadId}`
      try {
        sessionStorage.setItem(FOCUS_COMPOSER_KEY, '1') // the thread page focuses the box
      } catch {
        /* storage unavailable — the thread still opens */
      }
      armEscape(() => {
        setBusy(false)
        setNotice('Your conversation is ready — open Messages to continue.')
      })
      window.location.href = href
      return
    }
    if (!r.gated) setNotice(r.error)
    setBusy(false)
  }

  const btn =
    'inline-flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-xl px-4 text-xs font-bold transition-colors disabled:opacity-60'

  return (
    <>
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-gray-200 bg-white/95 p-3 backdrop-blur sm:static sm:mx-auto sm:mt-4 sm:max-w-3xl sm:rounded-2xl sm:border sm:p-4">
        {notice && (
          <p className="pb-2 text-center text-[11px] font-semibold text-slate-700">
            {notice}
            {noticeHref && (
              <>
                {' '}
                <Link href={noticeHref} className="font-bold text-tm-red hover:underline">
                  See similar tutors
                </Link>
              </>
            )}
          </p>
        )}
        <div className="mx-auto flex max-w-3xl flex-wrap gap-2">
          <button
            type="button"
            onClick={toggleShortlist}
            disabled={busy}
            aria-pressed={saved}
            className={`${btn} border border-tm-red text-tm-red hover:bg-tm-tint-red`}
          >
            <Heart size={14} className={saved ? 'fill-tm-red' : ''} />
            {saved ? 'Shortlisted' : 'Shortlist'}
          </button>
          <button
            type="button"
            onClick={requestDemo}
            disabled={busy}
            className={`${btn} bg-tm-red text-white hover:bg-tm-red-hover`}
          >
            <Play size={14} className="fill-white" />
            {/* A signed-in parent reads "Demo lesson" (matches the tile, §2.1);
                a guest keeps "Request demo". */}
            {isParent ? 'Demo lesson' : 'Request demo'}
          </button>
          {canMessage && (
            <button
              type="button"
              onClick={message}
              disabled={busy}
              className={`${btn} bg-tm-navy text-white hover:bg-tm-navy-hover`}
            >
              <MessageCircle size={14} />
              Message
            </button>
          )}
          {/* Hire, for a signed-in parent (§2.1). Non-Featured → the Featured
              upgrade sheet; Featured → the existing hire flow. */}
          {isParent && <HireButton hired={hired} className="flex-1 min-w-0" />}
        </div>
      </div>

      <AuthGateModal
        open={gateOpen}
        intent={gateIntent}
        draft={{ tutorId, tutorName }}
        onClose={() => setGateOpen(false)}
      />
    </>
  )
}
