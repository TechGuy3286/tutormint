'use client'

import { useState } from 'react'
import { Heart, Play } from 'lucide-react'
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
// Messaging is not here yet. Threads land in T5, and a button that opens
// nothing is worse than no button.

export default function ProfileActions({
  tutorId,
  tutorName,
  signedIn,
  isSelf,
  initiallySaved,
}: {
  tutorId: string
  tutorName: string
  signedIn: boolean
  isSelf: boolean
  initiallySaved: boolean
}) {
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
      const res = await fetch('/api/shortlist', {
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
      const res = await fetch('/api/demo/request', {
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

  const btn =
    'inline-flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-xl px-4 text-xs font-bold transition-colors disabled:opacity-60'

  return (
    <>
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-gray-200 bg-white/95 p-3 backdrop-blur sm:static sm:mx-auto sm:mt-4 sm:max-w-3xl sm:rounded-2xl sm:border sm:p-4">
        {notice && (
          <p className="pb-2 text-center text-[11px] font-semibold text-[#334155]">{notice}</p>
        )}
        <div className="mx-auto flex max-w-3xl gap-2">
          <button
            type="button"
            onClick={toggleShortlist}
            disabled={busy}
            aria-pressed={saved}
            className={`${btn} border border-[#d60008] text-[#d60008] hover:bg-red-50`}
          >
            <Heart size={14} className={saved ? 'fill-[#d60008]' : ''} />
            {saved ? 'Shortlisted' : 'Shortlist'}
          </button>
          <button
            type="button"
            onClick={requestDemo}
            disabled={busy}
            className={`${btn} bg-[#d60008] text-white hover:bg-red-700`}
          >
            <Play size={14} className="fill-white" />
            Request demo
          </button>
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
