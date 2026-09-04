'use client'

import { postGated } from '@/lib/gatedFetch'
import { armEscape, submitSignal } from '@/lib/submit'
import { useUpgradeSheet } from '@/components/upgrade/UpgradeProvider'
import { useState } from 'react'
import { Heart, Play, Mail } from 'lucide-react'
import AuthGateModal, { type AuthIntent } from '@/components/AuthGateModal'

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
}: {
  tutorId: string
  tutorName: string
  signedIn: boolean
  isSelf: boolean
  initiallySaved: boolean
  /** False for a tutor viewing another tutor: they have nothing to say here. */
  canMessage: boolean
}) {
  const upgradeSheet = useUpgradeSheet()
  const [saved, setSaved] = useState(initiallySaved)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [gateOpen, setGateOpen] = useState(false)
  const [gateIntent, setGateIntent] = useState<AuthIntent>('shortlist')

  // Your own profile is not something you shortlist or book a demo with.
  if (isSelf) return null

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
    try {
      const res = await fetch('/api/demo/request', { signal: submitSignal(),
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tutorId }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not send your demo request.')
      setNotice(`Demo requested. ${tutorName.split(' ')[0]} will reply with a time.`)
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Could not send your demo request.')
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
          <p className="pb-2 text-center text-[11px] font-semibold text-slate-700">{notice}</p>
        )}
        <div className="mx-auto flex max-w-3xl gap-2">
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
            Request demo
          </button>
          {canMessage && (
            <button
              type="button"
              onClick={message}
              disabled={busy}
              className={`${btn} bg-tm-green-deep text-white hover:bg-tm-green-deep-hover`}
            >
              <Mail size={14} />
              Message
            </button>
          )}
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
