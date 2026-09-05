'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

// The thread's Realtime channel — one Supabase broadcast channel per open
// conversation, `thread:<id>`.
//
// It carries three SIGNALS and no content: 'msg' (a new message landed — the
// receiver pulls it by refreshing the server component, the same transport a
// send already uses), 'seen' (the other side opened the thread — refresh to
// turn a sent tick into a seen tick), and 'typing' (show "X is typing…",
// debounced, never persisted). Nothing about the message itself crosses the
// channel, so even a guessed channel name leaks only "someone is typing", never
// a body — the bodies still come through the RLS-scoped server render.

type SignalEvent = 'msg' | 'seen'

export function useThreadChannel({
  threadId,
  selfName,
  onMessage,
  onSeen,
}: {
  threadId: string
  selfName: string
  onMessage: () => void
  onSeen: () => void
}) {
  const [typingName, setTypingName] = useState<string | null>(null)
  const channelRef = useRef<ReturnType<ReturnType<typeof createClient>['channel']> | null>(null)
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastTypingSent = useRef(0)

  // Keep the callbacks fresh without re-subscribing the channel each render.
  const onMessageRef = useRef(onMessage)
  const onSeenRef = useRef(onSeen)
  onMessageRef.current = onMessage
  onSeenRef.current = onSeen

  useEffect(() => {
    const supabase = createClient()
    const channel = supabase.channel(`thread:${threadId}`, {
      config: { broadcast: { self: false } },
    })
    channel
      .on('broadcast', { event: 'msg' }, () => onMessageRef.current())
      .on('broadcast', { event: 'seen' }, () => onSeenRef.current())
      .on('broadcast', { event: 'typing' }, (m) => {
        const name = (m.payload as { name?: string })?.name || 'Someone'
        setTypingName(name)
        if (typingTimer.current) clearTimeout(typingTimer.current)
        typingTimer.current = setTimeout(() => setTypingName(null), 3500)
      })
      .subscribe()
    channelRef.current = channel

    return () => {
      if (typingTimer.current) clearTimeout(typingTimer.current)
      void supabase.removeChannel(channel)
      channelRef.current = null
      setTypingName(null)
    }
  }, [threadId])

  /** Tell the other side we are typing — debounced to at most once every 1.5s. */
  const notifyTyping = useCallback(() => {
    const now = Date.now()
    if (now - lastTypingSent.current < 1500) return
    lastTypingSent.current = now
    void channelRef.current?.send({ type: 'broadcast', event: 'typing', payload: { name: selfName } })
  }, [selfName])

  /** Broadcast a signal to the other participant. */
  const signal = useCallback((event: SignalEvent) => {
    void channelRef.current?.send({ type: 'broadcast', event })
  }, [])

  return { typingName, notifyTyping, signal }
}
