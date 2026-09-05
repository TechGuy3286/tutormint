'use client'

import { COMPOSER_HINT, isSendKey } from '@/lib/composerKeys'
import { reportSilentFailure } from '@/lib/silentFailure'
import { submitSignal } from '@/lib/submit'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Ban,
  Check,
  CheckCheck,
  ChevronUp,
  Copy,
  Flag,
  Loader2,
  Lock,
  Paperclip,
  Reply,
  Send,
  ShieldAlert,
  Trash2,
  X,
} from 'lucide-react'
import { postGated } from '@/lib/gatedFetch'
import { useUpgradeSheet } from '@/components/upgrade/UpgradeProvider'
import UpgradeTrigger from '@/components/upgrade/UpgradeTrigger'
import { useToast } from '@/components/ui/Toast'
import { useConfirm } from '@/components/ui/ConfirmDialog'
import Avatar from '@/components/Avatar'
import { formatDate, formatDateTime, pkDayKey } from '@/lib/datetime'
import type { GateReason } from '@/lib/gate'
import type { ThreadMessage, MessageReplyRef } from '@/lib/messaging'
import { useThreadChannel } from '@/components/messages/useThreadChannel'

// The right pane: one conversation, oldest at the top, and the composer.
//
// Bodies arrive ALREADY MASKED when the pair may not exchange numbers -- the
// digits never reach this component. A chat is read downwards and paged upwards;
// the newest window is server-rendered and older windows are PREPENDED, holding
// the scroll position by measuring the container before and after.
//
// Part 2 adds, all WhatsApp-familiar: replies (quote above the composer), seen
// ticks (read_at → double tick), a typing indicator (Realtime broadcast, no
// persistence), a per-message menu (Copy · Reply · Report · Delete for me),
// photo attachments gated by contact rights, and — for a tutor — quick-reply
// chips. New-message delivery moved from a plain refresh to the same Realtime
// channel: a send broadcasts 'msg' and the other side refreshes.

const REPORT_REASONS: { value: string; label: string }[] = [
  { value: 'harassment', label: 'Harassment or abuse' },
  { value: 'spam', label: 'Spam' },
  { value: 'inappropriate_content', label: 'Inappropriate content' },
  { value: 'off_platform_payment', label: 'Asking to pay off TutorMint' },
  { value: 'fake_profile', label: 'Fake or misleading' },
  { value: 'other', label: 'Something else' },
]

type MenuState = { id: string; mine: boolean; body: string; hasBody: boolean; x: number; y: number }
type Pending = { path: string; w: number; h: number; bytes: number; url: string }

export default function Conversation({
  threadId,
  otherId,
  otherName,
  otherAvatar,
  initial,
  initialCursor,
  canShareContact,
  suspended,
  upgradeHref,
  selfName,
  canAttach,
  contactReason,
  quickReplies,
}: {
  threadId: string
  otherId: string
  otherName: string
  otherAvatar: string | null
  initial: ThreadMessage[]
  initialCursor: string | null
  canShareContact: boolean
  suspended: boolean
  upgradeHref: string
  /** The viewer's own name, for the typing broadcast. */
  selfName: string
  /** May this member attach a photo (same rule as seeing contact details). */
  canAttach: boolean
  /** The upsell reason for a member who cannot attach. */
  contactReason: GateReason
  /** The tutor's quick-reply chips. Empty for a parent. */
  quickReplies: string[]
}) {
  const router = useRouter()
  const upgradeSheet = useUpgradeSheet()
  const toast = useToast()
  const confirm = useConfirm()

  const [older, setOlder] = useState<ThreadMessage[]>([])
  const [cursor, setCursor] = useState<string | null>(initialCursor)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [deletedLocally, setDeletedLocally] = useState<string[]>([])

  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const [reply, setReply] = useState<MessageReplyRef | null>(null)
  const [pending, setPending] = useState<Pending | null>(null)
  const [uploading, setUploading] = useState(false)
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [reportId, setReportId] = useState<string | null>(null)
  const [lightbox, setLightbox] = useState<ThreadMessage | null>(null)

  const scroller = useRef<HTMLDivElement | null>(null)
  const bottom = useRef<HTMLDivElement | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const fileInput = useRef<HTMLInputElement | null>(null)
  const longPress = useRef<ReturnType<typeof setTimeout> | null>(null)

  const messages = [...older, ...initial].filter((m) => !deletedLocally.includes(m.id))

  // ------------------------------------------------------------- realtime ---
  const markRead = useCallback(() => {
    void fetch('/api/messages/read', {
      signal: submitSignal(),
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ threadId }),
    }).catch(() => {})
  }, [threadId])

  // `signal` is returned below but referenced inside onMessage; a ref bridges
  // that so the callback can broadcast 'seen' without a declaration-order snag.
  const signalRef = useRef<((event: 'msg' | 'seen') => void) | null>(null)

  const { typingName, notifyTyping, signal } = useThreadChannel({
    threadId,
    selfName,
    // A new message landed: pull it (server render is the transport) and, since
    // this pane is open in front of the reader, mark it read and tell the other
    // side so their tick turns double.
    onMessage: () => {
      router.refresh()
      markRead()
      signalRef.current?.('seen')
    },
    // The other side opened the thread: refresh so our sent ticks become seen.
    onSeen: () => router.refresh(),
  })
  signalRef.current = signal

  // --------------------------------------------------------------- read ----
  // On mount, not during the server render: Next prefetches links, and clearing
  // the unread dot for a conversation somebody only hovered over is worse than
  // clearing it a beat late.
  useEffect(() => {
    markRead()
    router.refresh()
    signal('seen')
    // Once per conversation. router/signal are stable and re-running would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId])

  // ------------------------------------------------------------- scroll ----
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' })
  }, [threadId])

  useEffect(
    () => () => {
      if (pending) URL.revokeObjectURL(pending.url)
    },
    [pending],
  )

  const loadOlder = useCallback(async () => {
    if (!cursor || loadingOlder) return
    setLoadingOlder(true)
    const el = scroller.current
    const before = el ? el.scrollHeight - el.scrollTop : 0
    try {
      const r = await fetch(
        `/api/messages/history?threadId=${threadId}&cursor=${encodeURIComponent(cursor)}`,
        { signal: submitSignal(), headers: { accept: 'application/json' } },
      )
      if (!r.ok) throw new Error(String(r.status))
      const page = (await r.json()) as { items: ThreadMessage[]; cursor: string | null }
      setOlder((prev) => [...page.items, ...prev])
      setCursor(page.cursor)
      requestAnimationFrame(() => {
        if (el) el.scrollTop = el.scrollHeight - before
      })
    } catch (e) {
      reportSilentFailure('Conversation.loadOlder', e)
    } finally {
      setLoadingOlder(false)
    }
  }, [cursor, loadingOlder, threadId])

  const send = async () => {
    const body = draft.trim()
    if (!body && !pending) return
    setBusy(true)
    setError(null)
    const payload: Record<string, unknown> = { threadId, body }
    if (reply) payload.replyTo = reply.id
    if (pending) payload.attachment = { path: pending.path, w: pending.w, h: pending.h, bytes: pending.bytes }
    const r = await postGated('/api/messages', payload, upgradeSheet?.showGate)
    if (r.ok) {
      setDraft('')
      setReply(null)
      if (pending) URL.revokeObjectURL(pending.url)
      setPending(null)
      toast.success('Message sent.')
      router.refresh()
      signal('msg')
      requestAnimationFrame(() => bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }))
    } else if (!r.gated) {
      setError(r.error)
      toast.error(r.error)
    }
    setBusy(false)
  }

  // ---------------------------------------------------------- attachments ---
  const pickPhoto = () => fileInput.current?.click()

  const onPhotoChosen = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-picking the same file
    if (!file) return
    if (!['image/jpeg', 'image/png'].includes(file.type)) {
      toast.error('Send a JPG or PNG.')
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error('That photo is larger than 5 MB.')
      return
    }
    setUploading(true)
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch('/api/messages/media', { method: 'POST', body: form, signal: submitSignal() })
      const json = await res.json()
      if (!res.ok) {
        toast.error(json.error ?? 'Could not upload that photo.')
        return
      }
      setPending({ path: json.path, w: json.w, h: json.h, bytes: json.bytes, url: URL.createObjectURL(file) })
    } catch {
      toast.error('Could not upload that photo.')
    } finally {
      setUploading(false)
    }
  }

  // ------------------------------------------------------- message actions ---
  const openMenu = (m: ThreadMessage, x: number, y: number) => {
    setMenu({ id: m.id, mine: m.mine, body: m.body, hasBody: m.body.trim().length > 0, x, y })
  }

  const copyMessage = async () => {
    if (!menu) return
    try {
      await navigator.clipboard.writeText(menu.body)
      toast.success('Copied.')
    } catch {
      toast.error('Could not copy.')
    }
    setMenu(null)
  }

  const startReply = () => {
    if (!menu) return
    setReply({ id: menu.id, snippet: menu.body.slice(0, 90), mine: menu.mine })
    setMenu(null)
    textareaRef.current?.focus()
  }

  const deleteForMe = async () => {
    if (!menu) return
    const id = menu.id
    setMenu(null)
    const ok = await confirm({
      title: 'Delete this message for you?',
      body: 'It disappears from your side of the conversation. The other person still sees it.',
      confirmLabel: 'Delete for me',
    })
    if (!ok) return
    try {
      const res = await fetch('/api/messages/delete', {
        signal: submitSignal(),
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageId: id }),
      })
      const json = await res.json()
      if (res.ok) {
        setDeletedLocally((prev) => [...prev, id])
        setOlder((prev) => prev.filter((m) => m.id !== id))
        toast.success('Message deleted for you.')
        router.refresh()
      } else {
        toast.error(json.error ?? 'Could not delete that.')
      }
    } catch {
      toast.error('Could not delete that.')
    }
  }

  const submitReport = async (reason: string) => {
    const id = reportId
    if (!id) return
    setReportId(null)
    try {
      const res = await fetch('/api/messages/report', {
        signal: submitSignal(),
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageId: id, reason }),
      })
      const json = await res.json()
      if (res.ok) toast.success(json.message ?? 'Reported. Our team will review it.')
      else toast.error(json.error ?? 'Could not report.')
    } catch {
      toast.error('Could not report.')
    }
  }

  const block = async () => {
    setMenuOpen(false)
    const ok = await confirm({
      title: `Block ${otherName}?`,
      body: 'Neither of you will be able to message or apply to the other. You can unblock later.',
      confirmLabel: 'Block',
    })
    if (!ok) return
    setBusy(true)
    try {
      const res = await fetch('/api/blocks', {
        signal: submitSignal(),
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: otherId }),
      })
      const json = await res.json()
      if (res.ok) {
        setNotice(`${otherName} is blocked. Neither of you can message or apply to the other.`)
        toast.success(`${otherName} is blocked.`)
      } else {
        toast.error(json.error ?? 'Could not block.')
      }
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  const anyMasked = messages.some((m) => m.masked)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-5">
        {cursor && (
          <div className="pb-3 text-center">
            <button
              type="button"
              onClick={() => void loadOlder()}
              disabled={loadingOlder}
              className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border border-gray-200 bg-white px-4 text-[11px] font-bold text-tm-navy transition-colors hover:border-tm-navy disabled:text-gray-500"
            >
              {loadingOlder ? (
                <Loader2 size={13} className="animate-spin" aria-hidden />
              ) : (
                <ChevronUp size={13} aria-hidden />
              )}
              Load earlier messages
            </button>
          </div>
        )}

        {notice && (
          <p className="mb-3 rounded-xl border border-gray-200 bg-white p-3 text-[11px] font-semibold text-slate-700">
            {notice}
          </p>
        )}

        {messages.length === 0 ? (
          <p className="py-10 text-center text-xs text-gray-500">
            No messages yet. Say hello — messages stay inside TutorMint so both sides are protected.
          </p>
        ) : (
          <ol className="space-y-1">
            {messages.map((m, i) => {
              const prev = i > 0 ? messages[i - 1] : null
              const showDay = !prev || pkDayKey(m.createdAt) !== pkDayKey(prev.createdAt)
              const startsRun = !prev || prev.mine !== m.mine || showDay
              return (
                <li key={m.id} className="space-y-1">
                  {showDay && (
                    <p className="py-3 text-center text-[10px] font-bold uppercase tracking-wide text-gray-500">
                      {formatDate(m.createdAt)}
                    </p>
                  )}
                  <div className={`flex items-end gap-2 ${m.mine ? 'justify-end' : 'justify-start'}`}>
                    {!m.mine &&
                      (startsRun ? (
                        <Avatar
                          name={otherName}
                          src={otherAvatar}
                          seed={otherId}
                          className="h-7 w-7 shrink-0 text-[10px]"
                          ring=""
                          decorative
                        />
                      ) : (
                        <span aria-hidden className="h-7 w-7 shrink-0" />
                      ))}
                    <div
                      onContextMenu={(e) => {
                        e.preventDefault()
                        openMenu(m, e.clientX, e.clientY)
                      }}
                      onTouchStart={(e) => {
                        const t = e.touches[0]
                        const x = t.clientX
                        const y = t.clientY
                        longPress.current = setTimeout(() => openMenu(m, x, y), 500)
                      }}
                      onTouchEnd={() => longPress.current && clearTimeout(longPress.current)}
                      onTouchMove={() => longPress.current && clearTimeout(longPress.current)}
                      className={`max-w-[80%] space-y-1 rounded-2xl px-3 py-2 sm:max-w-[68%] ${
                        m.mine
                          ? 'rounded-br-md bg-tm-tint-navy text-tm-navy'
                          : 'rounded-bl-md border border-gray-200 bg-white text-slate-700'
                      }`}
                    >
                      {m.replyTo && (
                        <div
                          className={`rounded-lg border-l-2 px-2 py-1 text-[10px] leading-snug ${
                            m.mine
                              ? 'border-tm-navy/40 bg-white/50 text-tm-navy/80'
                              : 'border-gray-300 bg-tm-bg text-gray-500'
                          }`}
                        >
                          <span className="font-bold">{m.replyTo.mine ? 'You' : otherName}</span>
                          <span className="line-clamp-2 whitespace-pre-wrap break-words">
                            {m.replyTo.snippet || 'Photo'}
                          </span>
                        </div>
                      )}

                      {m.attachment && (
                        <button
                          type="button"
                          onClick={() => setLightbox(m)}
                          className="block overflow-hidden rounded-lg"
                          aria-label="View photo"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element -- participant-served attachment */}
                          <img
                            src={`/api/messages/media/${m.id}`}
                            alt="Shared photo"
                            loading="lazy"
                            className="max-h-64 w-auto max-w-full rounded-lg object-cover"
                          />
                        </button>
                      )}

                      {m.body.trim().length > 0 && (
                        <p className="whitespace-pre-wrap break-words text-xs leading-relaxed">{m.body}</p>
                      )}

                      <p
                        className={`flex items-center gap-1 text-[10px] ${
                          m.mine ? 'justify-end text-tm-navy/70' : 'text-gray-500'
                        }`}
                      >
                        {formatDateTime(m.createdAt)}
                        {m.mine &&
                          (m.readAt ? (
                            <CheckCheck size={12} aria-label="Seen" className="text-tm-green-deep" />
                          ) : (
                            <Check size={12} aria-label="Sent" className="text-tm-navy/50" />
                          ))}
                      </p>
                    </div>
                  </div>
                </li>
              )
            })}
          </ol>
        )}

        {typingName && (
          <p className="mt-2 px-1 text-[11px] italic text-gray-500" aria-live="polite">
            {typingName} is typing…
          </p>
        )}

        {anyMasked && !canShareContact && (
          <p className="mt-3 flex items-start gap-2 rounded-xl bg-tm-tint-gold p-3 text-[11px] leading-relaxed text-tm-gold-ink">
            <Lock size={14} className="mt-px shrink-0" aria-hidden />
            <span>
              Phone numbers are hidden in this conversation.{' '}
              <Link href={upgradeHref} className="font-bold underline">
                Upgrade
              </Link>{' '}
              to see contact details once both sides can share them.
            </span>
          </p>
        )}

        <div ref={bottom} aria-hidden />
      </div>

      <div className="border-t border-gray-200 bg-white/95 px-4 py-3 backdrop-blur sm:px-5">
        <div className="space-y-2">
          {error && <p className="text-[11px] font-bold text-tm-red">{error}</p>}

          {suspended ? (
            <p className="flex items-start gap-2 rounded-xl bg-tm-tint-red p-3 text-[11px] leading-relaxed text-tm-red">
              <ShieldAlert size={14} className="mt-px shrink-0" aria-hidden />
              <span>
                Your account is suspended, so you cannot send messages.{' '}
                <Link href="/support" className="font-bold underline">
                  Contact support
                </Link>{' '}
                to have it reviewed.
              </span>
            </p>
          ) : (
            <div className="space-y-2">
              {/* The message being replied to, quoted above the composer. */}
              {reply && (
                <div className="flex items-start gap-2 rounded-xl border border-gray-200 bg-tm-bg p-2">
                  <Reply size={13} className="mt-0.5 shrink-0 text-gray-500" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="text-[10px] font-bold text-tm-navy">
                      Replying to {reply.mine ? 'yourself' : otherName}
                    </p>
                    <p className="truncate text-[11px] text-gray-500">{reply.snippet || 'Photo'}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setReply(null)}
                    aria-label="Cancel reply"
                    className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-gray-500 hover:bg-white"
                  >
                    <X size={14} aria-hidden />
                  </button>
                </div>
              )}

              {/* A photo staged for sending. */}
              {pending && (
                <div className="flex items-center gap-2 rounded-xl border border-gray-200 bg-tm-bg p-2">
                  {/* eslint-disable-next-line @next/next/no-img-element -- local preview */}
                  <img src={pending.url} alt="Photo to send" className="h-12 w-12 rounded-lg object-cover" />
                  <span className="flex-1 text-[11px] font-semibold text-tm-navy">Photo ready to send</span>
                  <button
                    type="button"
                    onClick={() => {
                      URL.revokeObjectURL(pending.url)
                      setPending(null)
                    }}
                    aria-label="Remove photo"
                    className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-gray-500 hover:bg-white"
                  >
                    <X size={15} aria-hidden />
                  </button>
                </div>
              )}

              {/* Tutor quick replies: tap to insert, never to send. */}
              {quickReplies.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {quickReplies.map((q, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => {
                        setDraft((d) => (d.trim() ? `${d.trim()} ${q}` : q))
                        textareaRef.current?.focus()
                      }}
                      className="rounded-full border border-gray-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-tm-navy transition-colors hover:border-tm-navy"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              )}

              <div className="flex items-end gap-2">
                <input
                  ref={fileInput}
                  type="file"
                  accept="image/jpeg,image/png"
                  onChange={onPhotoChosen}
                  className="hidden"
                />
                {canAttach ? (
                  <button
                    type="button"
                    onClick={pickPhoto}
                    disabled={uploading || busy}
                    aria-label="Attach a photo"
                    className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-gray-200 text-tm-navy transition-colors hover:border-tm-navy disabled:text-gray-300"
                  >
                    {uploading ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Paperclip size={16} aria-hidden />}
                  </button>
                ) : (
                  <UpgradeTrigger
                    reason={contactReason}
                    className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-gray-200 text-gray-300"
                  >
                    <Paperclip size={16} aria-hidden />
                    <span className="sr-only">Upgrade to send photos</span>
                  </UpgradeTrigger>
                )}

                <textarea
                  ref={textareaRef}
                  value={draft}
                  onChange={(e) => {
                    setDraft(e.target.value)
                    notifyTyping()
                  }}
                  onKeyDown={(e) => {
                    if (!isSendKey(e)) return
                    e.preventDefault()
                    if (!busy && (draft.trim() || pending)) void send()
                  }}
                  rows={1}
                  placeholder="Write a message"
                  aria-label="Message"
                  aria-describedby="composer-hint"
                  className="min-h-[44px] flex-1 resize-none rounded-xl border border-gray-200 bg-white px-3 py-3 text-xs outline-none focus:border-tm-red"
                />
                <button
                  type="button"
                  onClick={send}
                  disabled={busy || (!draft.trim() && !pending)}
                  aria-label="Send message"
                  className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl bg-tm-green-deep px-4 text-white disabled:bg-gray-300"
                >
                  <Send size={16} aria-hidden />
                </button>
              </div>
              <p id="composer-hint" className="text-[10px] text-gray-500">
                {COMPOSER_HINT}
              </p>
            </div>
          )}

          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              aria-expanded={menuOpen}
              className="inline-flex min-h-[44px] items-center gap-1 text-[11px] font-bold text-gray-500"
            >
              <ShieldAlert size={12} aria-hidden />
              Safety
            </button>
            {menuOpen && (
              <button
                type="button"
                onClick={block}
                disabled={busy}
                className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-tm-red px-3 text-[11px] font-bold text-tm-red"
              >
                <Ban aria-hidden size={14} />
                Block {otherName.split(' ')[0]}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* The per-message menu. A full-screen catcher closes it on any outside tap. */}
      {menu && (
        <div className="fixed inset-0 z-[120]" onClick={() => setMenu(null)}>
          <div
            role="menu"
            onClick={(e) => e.stopPropagation()}
            style={{
              top: Math.min(menu.y, typeof window !== 'undefined' ? window.innerHeight - 220 : menu.y),
              left: Math.min(menu.x, typeof window !== 'undefined' ? window.innerWidth - 190 : menu.x),
            }}
            className="absolute w-44 overflow-hidden rounded-xl border border-gray-200 bg-white py-1 shadow-xl"
          >
            {menu.hasBody && (
              <button
                type="button"
                onClick={copyMessage}
                className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-xs font-semibold text-slate-700 hover:bg-tm-bg"
              >
                <Copy size={14} aria-hidden className="text-gray-500" /> Copy
              </button>
            )}
            <button
              type="button"
              onClick={startReply}
              className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-xs font-semibold text-slate-700 hover:bg-tm-bg"
            >
              <Reply size={14} aria-hidden className="text-gray-500" /> Reply
            </button>
            {!menu.mine && (
              <button
                type="button"
                onClick={() => {
                  setReportId(menu.id)
                  setMenu(null)
                }}
                className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-xs font-semibold text-slate-700 hover:bg-tm-bg"
              >
                <Flag size={14} aria-hidden className="text-gray-500" /> Report
              </button>
            )}
            <button
              type="button"
              onClick={deleteForMe}
              className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-xs font-semibold text-tm-red hover:bg-tm-tint-red"
            >
              <Trash2 size={14} aria-hidden /> Delete for me
            </button>
          </div>
        </div>
      )}

      {/* Report reason picker — the confirm step for a report. */}
      {reportId && (
        <div
          className="fixed inset-0 z-[120] flex items-end justify-center bg-tm-black/50 p-4 sm:items-center"
          onClick={() => setReportId(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Report message"
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm space-y-2 rounded-2xl bg-white p-5 shadow-xl"
          >
            <h2 className="text-sm font-black text-tm-navy">Report this message</h2>
            <p className="text-[11px] text-gray-500">Tell us what is wrong. Our team reviews every report.</p>
            <div className="space-y-1 pt-1">
              {REPORT_REASONS.map((r) => (
                <button
                  key={r.value}
                  type="button"
                  onClick={() => void submitReport(r.value)}
                  className="flex w-full items-center gap-2 rounded-xl border border-gray-200 px-3 py-2.5 text-left text-xs font-semibold text-slate-700 hover:border-tm-navy"
                >
                  <Flag size={13} aria-hidden className="text-gray-500" />
                  {r.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setReportId(null)}
              className="mt-1 inline-flex min-h-[44px] w-full items-center justify-center rounded-xl border border-gray-200 text-xs font-bold text-tm-navy hover:border-tm-navy"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Full-size photo. */}
      {lightbox && (
        <div
          className="fixed inset-0 z-[120] flex items-center justify-center bg-tm-black/80 p-4"
          onClick={() => setLightbox(null)}
        >
          <button
            type="button"
            aria-label="Close photo"
            className="absolute right-4 top-4 grid h-11 w-11 place-items-center rounded-full bg-white/10 text-white"
          >
            <X size={20} aria-hidden />
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element -- participant-served attachment */}
          <img
            src={`/api/messages/media/${lightbox.id}`}
            alt="Shared photo"
            onClick={(e) => e.stopPropagation()}
            className="max-h-full max-w-full rounded-lg object-contain"
          />
        </div>
      )}
    </div>
  )
}
