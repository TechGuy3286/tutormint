'use client'

import { ArrowLeft, ExternalLink, Loader2, MessageCircle, MessagesSquare, X } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'

import Avatar from '@/components/Avatar'
import ConversationList from '@/components/messages/ConversationList'
import Conversation from '@/components/messages/Conversation'
import type { ThreadRow } from '@/lib/messaging'
import type { GateReason } from '@/lib/gate'

// The desktop messages dock (PR 4 §2). Desktop only (>=1024px) — a collapsed
// "Messages" bar bottom-right that opens a panel with two tabs, Messages and
// Support.
//
// It adds NO messaging logic: the Messages tab renders the SAME ConversationList
// (with onSelect to open in place) and the SAME Conversation the full inbox uses,
// fed by /api/messages/thread/[id], which reuses the inbox's own server functions
// (masking, reply-only, entitlements). "Open full inbox" links to the real page.
//
// Hidden on the inbox page itself (§2.3) and on the onboarding/verify/payment
// screens (§2.5); mounted only for signed-in parents/tutors, and only inside the
// (site) chrome, so it never shows in admin or for logged-out visitors.

type ThreadData = {
  header: {
    id: string
    otherId: string
    otherName: string
    otherAvatar: string | null
    otherRole: string | null
    otherSlug: string | null
    jobTitle: string | null
  }
  items: unknown[]
  cursor: string | null
  canShareContact: boolean
  suspended: boolean
  canAttach: boolean
  selfName: string
  contactReason: GateReason
  quickReplies: string[]
}

export default function MessagesDock({
  role,
  basePath,
  initialUnread,
  supportHref,
}: {
  role: 'tutor' | 'parent'
  basePath: string
  initialUnread: number
  supportHref: string | null
}) {
  const pathname = usePathname() ?? ''
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<'messages' | 'support'>('messages')
  const [unread, setUnread] = useState(initialUnread)

  const [list, setList] = useState<{ items: ThreadRow[]; cursor: string | null } | null>(null)
  const [listErr, setListErr] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [thread, setThread] = useState<ThreadData | null>(null)
  const [threadLoading, setThreadLoading] = useState(false)

  // Hidden where the full inbox already IS the screen, and in the flows (§2.3, §2.5).
  const hidden =
    pathname.startsWith(basePath) ||
    pathname.startsWith('/tutor/onboarding') ||
    pathname.startsWith('/tutor/complete-profile') ||
    pathname.startsWith('/tutor/verify') ||
    pathname.startsWith('/pay')

  const refreshUnread = useCallback(async () => {
    try {
      const r = await fetch('/api/messages/unread', { headers: { accept: 'application/json' } })
      if (r.ok) setUnread((await r.json()).count ?? 0)
    } catch {
      /* keep the last count */
    }
  }, [])

  // Refresh the badge on focus (the inbox's realtime lives inside a conversation;
  // this is the "refresh on focus" the spec asks for otherwise, §2.4).
  useEffect(() => {
    const onFocus = () => void refreshUnread()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [refreshUnread])

  const loadList = useCallback(async () => {
    setListErr(false)
    try {
      const r = await fetch('/api/messages/threads', { headers: { accept: 'application/json' } })
      if (!r.ok) throw new Error(String(r.status))
      setList((await r.json()) as { items: ThreadRow[]; cursor: string | null })
    } catch {
      setListErr(true)
    }
  }, [])

  // On open: load the list (once) and refresh the badge (§2.4).
  useEffect(() => {
    if (!open) return
    void refreshUnread()
    if (!list) void loadList()
  }, [open, list, loadList, refreshUnread])

  const openThread = useCallback(async (id: string) => {
    setSelected(id)
    setThread(null)
    setThreadLoading(true)
    try {
      const r = await fetch(`/api/messages/thread/${id}`, { headers: { accept: 'application/json' } })
      if (r.ok) {
        setThread((await r.json()) as ThreadData)
        // Opening a thread clears its unread server-side on the full page; here we
        // just re-sync the badge shortly after.
        setTimeout(() => void refreshUnread(), 1200)
      }
    } finally {
      setThreadLoading(false)
    }
  }, [refreshUnread])

  if (hidden) return null

  // Collapsed bar — desktop only.
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={unread > 0 ? `Messages, ${unread} unread` : 'Messages'}
        className="fixed bottom-0 right-6 z-40 hidden items-center gap-2 rounded-t-2xl border border-b-0 border-gray-200 bg-white px-4 py-2.5 shadow-lg transition-colors hover:bg-gray-50 lg:flex"
      >
        <MessagesSquare size={18} className="text-tm-navy" aria-hidden />
        <span className="text-xs font-black text-tm-navy">Messages</span>
        {unread > 0 && (
          <span className="inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-tm-red px-1.5 text-[10px] font-black text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>
    )
  }

  return (
    // Messages keeps a fixed height and scrolls inside; Support sizes to its
    // content so the panel is not tall and half-empty (owner PR5b §2.1).
    <div
      className="fixed bottom-0 right-6 z-40 hidden w-[380px] flex-col overflow-hidden rounded-t-2xl border border-b-0 border-gray-200 bg-white shadow-2xl lg:flex"
      style={tab === 'messages' ? { height: '520px' } : undefined}
    >
      {/* header + tabs. Active tab: navy fill, white text; inactive plain. Both
          the same height, so switching does not shift the layout (§2.2). */}
      <div className="flex items-center justify-between border-b border-gray-200 px-3 py-2">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setTab('messages')}
            className={`rounded-lg px-3 py-1.5 text-xs font-black ${tab === 'messages' ? 'bg-tm-navy text-white' : 'text-gray-500 hover:text-tm-navy'}`}
          >
            Messages
          </button>
          <button
            type="button"
            onClick={() => setTab('support')}
            className={`rounded-lg px-3 py-1.5 text-xs font-black ${tab === 'support' ? 'bg-tm-navy text-white' : 'text-gray-500 hover:text-tm-navy'}`}
          >
            Support
          </button>
        </div>
        <button type="button" onClick={() => setOpen(false)} aria-label="Close messages" className="grid h-8 w-8 place-items-center rounded-lg text-gray-500 hover:bg-gray-100">
          <X size={16} aria-hidden />
        </button>
      </div>

      {tab === 'messages' ? (
        // The list stays MOUNTED and the open conversation is an overlay ON TOP
        // of it, bounded by this panel (`relative` + the panel's overflow-hidden).
        // Keeping the list mounted is what preserves its scroll position when the
        // reader taps Back (§2.5) — no unmount, no restore to get wrong — and the
        // absolute overlay guarantees nothing renders outside the panel (§2.6).
        <div className="relative flex min-h-0 flex-1 flex-col">
          {listErr ? (
            <div className="grid flex-1 place-items-center gap-2 p-6 text-center">
              <p className="text-xs font-bold text-tm-navy">Could not load your messages.</p>
              <button type="button" onClick={() => void loadList()} className="min-h-[40px] rounded-xl border border-gray-200 px-4 text-xs font-bold text-tm-navy hover:border-tm-navy">Try again</button>
            </div>
          ) : list ? (
            <ConversationList
              initial={list.items}
              initialCursor={list.cursor}
              basePath={basePath}
              activeId={selected}
              onSelect={openThread}
              emptyHint={role === 'tutor' ? 'Parents who message you first appear here.' : 'Message any tutor from their profile.'}
            />
          ) : (
            <div className="grid flex-1 place-items-center"><Loader2 className="animate-spin text-gray-500" aria-hidden /></div>
          )}

          {/* The list's own "Open full inbox" (§2.4) — shown under the list, and
              covered by the overlay while a conversation is open. */}
          {!selected && (
            <div className="border-t border-gray-200 p-2 text-center">
              <Link href={basePath} className="inline-flex min-h-[40px] items-center justify-center gap-1.5 text-[11px] font-bold text-tm-navy hover:underline">
                Open full inbox <ExternalLink size={12} aria-hidden />
              </Link>
            </div>
          )}

          {/* ---------------------------------------------- conversation view -- */}
          {selected && (
            <div className="absolute inset-0 z-10 flex flex-col bg-white">
              {thread ? (
                <>
                  {/* Header: back to the list, the other person's avatar + name
                      (name links to their public profile/card), and an icon that
                      opens THIS conversation in the full inbox — never floating
                      over the messages (§2.1, §2.4). */}
                  <div className="flex items-center gap-2 border-b border-gray-200 px-2 py-2">
                    <button
                      type="button"
                      onClick={() => { setSelected(null); setThread(null) }}
                      aria-label="Back to conversations"
                      className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-tm-navy hover:bg-gray-100"
                    >
                      <ArrowLeft size={16} aria-hidden />
                    </button>
                    <Avatar
                      name={thread.header.otherName}
                      src={thread.header.otherAvatar}
                      seed={thread.header.otherId}
                      className="h-8 w-8 shrink-0 text-[10px]"
                      decorative
                    />
                    {(() => {
                      const href =
                        thread.header.otherRole === 'tutor' && thread.header.otherSlug
                          ? `/tutor/${thread.header.otherSlug}`
                          : thread.header.otherRole === 'parent'
                            ? `/parent/${thread.header.otherId}`
                            : null
                      return href ? (
                        <Link href={href} className="truncate text-sm font-black text-tm-navy hover:underline">
                          {thread.header.otherName}
                        </Link>
                      ) : (
                        <span className="truncate text-sm font-black text-tm-navy">{thread.header.otherName}</span>
                      )
                    })()}
                    <div className="min-w-0 flex-1" />
                    <Link
                      href={`${basePath}/${thread.header.id}`}
                      aria-label="Open this conversation in the full inbox"
                      title="Open in full inbox"
                      className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-gray-500 hover:bg-gray-100 hover:text-tm-navy"
                    >
                      <ExternalLink size={15} aria-hidden />
                    </Link>
                  </div>
                  {/* Conversation fills the rest and scrolls on its own, opening
                      at the newest message; its composer stays pinned at the
                      bottom (§2.2, §2.3). */}
                  <Conversation
                    threadId={thread.header.id}
                    otherId={thread.header.otherId}
                    otherName={thread.header.otherName}
                    otherAvatar={thread.header.otherAvatar}
                    initial={thread.items as never}
                    initialCursor={thread.cursor}
                    canShareContact={thread.canShareContact}
                    suspended={thread.suspended}
                    selfName={thread.selfName}
                    canAttach={thread.canAttach}
                    contactReason={thread.contactReason}
                    quickReplies={thread.quickReplies}
                  />
                </>
              ) : (
                // Loading (or failed to load) a conversation: a back arrow is
                // always available so the reader is never stuck.
                <>
                  <div className="flex items-center gap-2 border-b border-gray-200 px-2 py-2">
                    <button
                      type="button"
                      onClick={() => { setSelected(null); setThread(null) }}
                      aria-label="Back to conversations"
                      className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-tm-navy hover:bg-gray-100"
                    >
                      <ArrowLeft size={16} aria-hidden />
                    </button>
                  </div>
                  {threadLoading ? (
                    <div className="grid flex-1 place-items-center">
                      <Loader2 className="animate-spin text-gray-500" aria-hidden />
                    </div>
                  ) : (
                    <div className="grid flex-1 place-items-center gap-2 p-6 text-center">
                      <p className="text-xs font-bold text-tm-navy">Could not open this conversation.</p>
                      <button
                        type="button"
                        onClick={() => void openThread(selected)}
                        className="min-h-[40px] rounded-xl border border-gray-200 px-4 text-xs font-bold text-tm-navy hover:border-tm-navy"
                      >
                        Try again
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      ) : (
        // No flex-1 / fixed height here — the Support panel is only as tall as
        // this content (§2.1).
        <div className="flex flex-col gap-4 p-6 text-center">
          <MessageCircle size={28} className="mx-auto text-tm-green-deep" aria-hidden />
          <div className="space-y-1">
            <p className="text-sm font-black text-tm-navy">Need help?</p>
            <p className="text-xs leading-relaxed text-gray-500">Message our team on WhatsApp and we&rsquo;ll get back to you.</p>
          </div>
          {supportHref && (
            <a
              href={supportHref}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-tm-green-deep px-4 text-sm font-bold text-white transition-colors hover:bg-tm-green-deep-hover"
            >
              <MessageCircle size={16} aria-hidden />
              Chat with TutorMint support on WhatsApp
            </a>
          )}
        </div>
      )}
    </div>
  )
}
