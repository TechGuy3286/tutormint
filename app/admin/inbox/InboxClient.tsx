'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Send, Pencil, ShieldCheck, MessageCircle } from 'lucide-react'
import { adminFetch } from '@/components/admin/adminFetch'
import { useToast } from '@/components/ui/Toast'
import { useAdminReadOnly } from '@/components/admin/ReadOnly'
import { formatDateTime } from '@/lib/datetime'
import type { AdminMessage, AdminTemplate, InboxThread } from '@/lib/adminMessaging'
import { INBOX_TAG_CLASS, type InboxTag } from '@/lib/inboxTags'
import { isAppTemplateKey } from '@/lib/applicationTemplatesCore'
import { composeOffers } from '@/lib/templateRetireCore'
import RetiredTemplates from '@/components/admin/RetiredTemplates'
import { groupTemplateInfo } from '@/lib/templateRules'
import ApplicationTemplates from './ApplicationTemplates'
import { completeCommon } from '@/lib/templateFill'
import { composeLink, type ComposeRole } from '@/lib/composeLinks'

const TEAM = 'TutorMint Team'

// The step-1 status pill (PR94 Part 3): English with Urdu underneath, one colour
// per status. Small enough to sit under a member's name in the list and header.
function StatusPill({ tag }: { tag: InboxTag }) {
  return (
    <span className={`mt-0.5 inline-block rounded-md px-1.5 py-0.5 text-[10px] font-bold leading-tight ${INBOX_TAG_CLASS[tag.tone]}`}>
      {tag.label}
      <span lang="ur" dir="rtl" className="block text-[9px] font-medium opacity-80">
        {tag.labelUr}
      </span>
    </span>
  )
}

function fill(body: string, vars: { name: string; jobTitle: string; reason: string }): string {
  return body
    .replace(/\{name\}/g, vars.name)
    .replace(/\{job_title\}/g, vars.jobTitle)
    .replace(/\{reason\}/g, vars.reason)
}

export default function InboxClient({
  threads,
  templates,
  selectedId,
  selectedName,
  selectedHasMobile,
  conversation,
  canEditTemplates,
  suggestedTemplateKey = '',
  supportDisplay,
  isOwner = false,
  initialShowTemplates = false,
  selectedRole = null,
}: {
  threads: InboxThread[]
  templates: AdminTemplate[]
  selectedId: string | null
  selectedName: string
  /** Whether the member has a mobile — decides if WhatsApp is offered. */
  selectedHasMobile: boolean
  conversation: AdminMessage[]
  canEditTemplates: boolean
  /** The support WhatsApp number from settings, as a person reads it. */
  supportDisplay: string
  isOwner?: boolean
  /** ?templates=1 opens the editor with the Applications group. */
  initialShowTemplates?: boolean
  /** The template the selected member's status tag maps to (PR105 §6) — preselected. */
  suggestedTemplateKey?: string
  /** The selected member's role — picks the link a template carries. */
  selectedRole?: ComposeRole
}) {
  const router = useRouter()
  const toast = useToast()
  const readOnly = useAdminReadOnly()

  // Preselect the template that matches this member's status tag (PR105 §6). The
  // component remounts on each member navigation (the page is force-dynamic), so
  // these initialisers run fresh per selected member.
  // Every template's common placeholders ({first_name}, the one link, the support
  // number) fill here too (owner, 28 Oct 2026 — the simple-English rewrite).
  const fillFor = (t: AdminTemplate, vars: { name: string; jobTitle: string; reason: string }) =>
    completeCommon(fill(t.body, vars), { name: selectedName, link: composeLink(t.key, selectedRole), supportWhatsapp: supportDisplay })
  const suggested = templates.find((t) => t.key === suggestedTemplateKey) ?? null
  const [templateKey, setTemplateKey] = useState(() => (suggested ? suggestedTemplateKey : ''))
  const [jobTitle, setJobTitle] = useState('')
  const [reason, setReason] = useState('')
  const [body, setBody] = useState(() =>
    suggested ? fillFor(suggested, { name: selectedName || 'there', jobTitle: '', reason: '' }) : '',
  )
  const [busy, setBusy] = useState(false)
  const [showTemplates, setShowTemplates] = useState(initialShowTemplates)
  // Newest message at the bottom, in view (owner, 11 Nov 2026).
  const historyRef = useRef<HTMLOListElement>(null)
  useEffect(() => {
    const el = historyRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [selectedId, conversation.length])

  const chosen = templates.find((t) => t.key === templateKey) ?? null
  const needsJob = !!chosen && chosen.body.includes('{job_title}')
  const needsReason = !!chosen && chosen.body.includes('{reason}')

  const applyTemplate = (key: string) => {
    setTemplateKey(key)
    const t = templates.find((x) => x.key === key)
    if (t) setBody(fillFor(t, { name: selectedName || 'there', jobTitle, reason }))
  }

  // Keep the {job_title}/{reason} substitutions live as the admin fills them.
  const refill = (nextJob: string, nextReason: string) => {
    if (chosen) setBody(fillFor(chosen, { name: selectedName || 'there', jobTitle: nextJob, reason: nextReason }))
  }

  const send = async (channel: 'inapp' | 'whatsapp') => {
    if (!selectedId) return
    setBusy(true)
    try {
      const { ok, data } = await adminFetch<{ error?: string; waHref?: string | null }>('/api/admin/inbox', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          memberId: selectedId,
          body: body.trim(),
          templateKey: templateKey || null,
          channel,
        }),
      })
      if (!ok) throw new Error(data.error ?? 'Could not send.')
      if (channel === 'whatsapp') {
        // The message is recorded and logged; the admin still sends it in
        // WhatsApp itself. Open the pre-filled chat in a new tab.
        if (data.waHref) window.open(data.waHref, '_blank', 'noopener')
        toast.success('Logged. WhatsApp opened with the message — press send there.')
      } else {
        toast.success('Message sent. The member has been notified.')
      }
      setBody('')
      setTemplateKey('')
      setJobTitle('')
      setReason('')
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not send.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div data-inbox="" className="min-w-0 space-y-4">
      <header className={`flex flex-wrap items-center justify-between gap-2 ${selectedId ? 'max-lg:hidden' : ''}`}>
        <div>
          <h1 className="text-lg font-black text-tm-navy">Team inbox</h1>
          <p className="text-xs text-gray-500">Official messages to members, and their replies.</p>
        </div>
        {canEditTemplates && !readOnly && (
          <button
            type="button"
            onClick={() => setShowTemplates((s) => !s)}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-gray-200 px-4 text-xs font-bold text-tm-navy hover:border-tm-navy"
          >
            <Pencil aria-hidden size={14} />
            {showTemplates ? 'Hide templates' : 'Edit templates'}
          </button>
        )}
      </header>

      {showTemplates && (
        <div className="min-w-0 space-y-3 [overflow-wrap:anywhere]">
          {isOwner && (
            <Link
              href="/admin/inbox/review"
              className="flex min-h-[44px] items-center justify-between gap-2 rounded-xl border border-tm-green-deep/40 bg-tm-tint-green px-4 py-2 text-sm font-bold text-tm-green-deep"
            >
              Review new wording — every member message rewritten in simple English, waiting for your approval
              <span aria-hidden>→</span>
            </Link>
          )}
          <ApplicationTemplates templates={templates} supportDisplay={supportDisplay} isOwner={isOwner} defaultOpen={initialShowTemplates} />
          <ApplicationTemplates templates={templates} supportDisplay={supportDisplay} isOwner={isOwner} group="follow_ups" />
          <ApplicationTemplates templates={templates} supportDisplay={supportDisplay} isOwner={isOwner} group="parents" />
          <ApplicationTemplates templates={templates} supportDisplay={supportDisplay} isOwner={isOwner} group="status" />
          <ApplicationTemplates templates={templates} supportDisplay={supportDisplay} isOwner={isOwner} group="share" />
          <ApplicationTemplates templates={templates} supportDisplay={supportDisplay} isOwner={isOwner} group="social" />
          <ApplicationTemplates templates={templates} supportDisplay={supportDisplay} isOwner={isOwner} group="rereview" />
          {/* The Consent group ("Ask parent") is inactive since 27 Oct 2026. */}
          <TemplatesEditor templates={templates.filter((t) => !t.retired && !groupTemplateInfo(t.key))} />
          <RetiredTemplates templates={templates.filter((t) => t.retired)} />
        </div>
      )}

      <div className="grid min-w-0 gap-4 lg:grid-cols-[280px_1fr]">
        {/* --------------------------------------------------- thread list --- */}
        <nav className={`min-w-0 space-y-1.5 ${selectedId ? 'max-lg:hidden' : ''}`} aria-label="Conversations">
          {threads.length === 0 ? (
            <p className="rounded-2xl border border-gray-200 bg-white p-4 text-xs text-gray-500">
              No conversations yet. Open a member and send the first message.
            </p>
          ) : (
            threads.map((t) => (
              <Link
                key={t.memberId}
                href={`/admin/inbox?to=${t.memberId}`}
                className={`block min-w-0 rounded-2xl border p-3 transition-colors ${
                  t.memberId === selectedId
                    ? 'border-tm-navy bg-white'
                    : 'border-gray-200 bg-white hover:border-tm-navy'
                }`}
              >
                <div className="flex min-w-0 items-center justify-between gap-2">
                  <span className="min-w-0 truncate text-xs font-black text-tm-navy">{t.memberName}</span>
                  {t.unreadFromMember > 0 && (
                    <span className="shrink-0 rounded-full bg-tm-red px-1.5 text-[10px] font-black text-white">
                      {t.unreadFromMember}
                    </span>
                  )}
                </div>
                <p className="truncate text-[11px] text-gray-500">
                  {t.lastDirection === 'in' ? '↩ ' : ''}
                  {t.lastBody}
                </p>
                {t.tag && <StatusPill tag={t.tag} />}
              </Link>
            ))
          )}
        </nav>

        {/* --------------------------------------------------- conversation --- */}
        <section
          data-inbox-chat=""
          className={`min-w-0 rounded-2xl border border-gray-200 bg-white lg:space-y-3 lg:p-4 ${
            selectedId
              ? 'max-lg:fixed max-lg:inset-0 max-lg:z-40 max-lg:flex max-lg:flex-col max-lg:rounded-none max-lg:border-0'
              : 'p-4 max-lg:hidden'
          }`}
        >
          {!selectedId ? (
            <p className="text-xs text-gray-500">Pick a conversation, or open a member to start one.</p>
          ) : (
            <>
              <div className="flex min-w-0 shrink-0 items-center gap-2 border-b border-gray-100 pb-2 max-lg:px-3 max-lg:pt-2">
                <Link
                  href="/admin/inbox"
                  aria-label="Back to conversations"
                  className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-tm-navy hover:bg-tm-tint-navy lg:hidden"
                >
                  <ArrowLeft aria-hidden size={18} />
                </Link>
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-tm-navy text-white max-lg:hidden">
                  <ShieldCheck aria-hidden size={14} />
                </span>
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/admin/users/${selectedId}`}
                    className="block truncate text-sm font-black text-tm-navy hover:underline"
                  >
                    {selectedName}
                  </Link>
                  {(() => {
                    const tag = threads.find((t) => t.memberId === selectedId)?.tag
                    return tag ? <StatusPill tag={tag} /> : null
                  })()}
                  <p className="text-[10px] text-gray-500 max-lg:hidden">You reply as {TEAM}.</p>
                </div>
              </div>

              <ol
                ref={historyRef}
                data-inbox-history=""
                className="min-w-0 space-y-2 overflow-y-auto overscroll-contain lg:max-h-[46vh] max-lg:min-h-0 max-lg:flex-1 max-lg:px-3 max-lg:py-3"
              >
                {conversation.length === 0 ? (
                  <li className="text-[11px] text-gray-500">No messages yet.</li>
                ) : (
                  conversation.map((m) => {
                    const fromTeam = m.direction === 'out'
                    return (
                      <li key={m.id} className={`flex ${fromTeam ? 'justify-end' : 'justify-start'}`}>
                        <div
                          className={`min-w-0 max-w-[85%] space-y-1 rounded-2xl px-3 py-2 ${
                            fromTeam ? 'rounded-tr-sm bg-tm-tint-navy' : 'rounded-tl-sm border border-gray-200 bg-tm-bg'
                          }`}
                        >
                          <p className="text-[10px] font-black uppercase tracking-wide text-slate-600">
                            {fromTeam ? TEAM : selectedName}
                          </p>
                          <p className="whitespace-pre-wrap break-words text-xs leading-relaxed text-slate-700 [overflow-wrap:anywhere]">{m.body}</p>
                          <p className="text-[10px] text-slate-600">{formatDateTime(m.createdAt)}</p>
                        </div>
                      </li>
                    )
                  })
                )}
              </ol>

              {/* ----------------------------------------------- compose --- */}
              {!readOnly && <div data-inbox-compose="" className="min-w-0 shrink-0 space-y-2 border-t border-gray-100 pt-3 max-lg:bg-white max-lg:px-3 max-lg:pb-[max(0.75rem,env(safe-area-inset-bottom))]">
                <select
                  value={templateKey}
                  onChange={(e) => applyTemplate(e.target.value)}
                  className="min-h-[44px] w-full min-w-0 max-w-full rounded-xl border border-gray-200 bg-white px-3 text-xs font-semibold"
                >
                  <option value="">Start from a template…</option>
                  {templates.filter((t) => composeOffers(t) && !isAppTemplateKey(t.key)).map((t) => (
                    <option key={t.key} value={t.key}>
                      {t.title}
                    </option>
                  ))}
                </select>

                {needsJob && (
                  <input
                    value={jobTitle}
                    onChange={(e) => {
                      setJobTitle(e.target.value)
                      refill(e.target.value, reason)
                    }}
                    placeholder="Tuition title (fills {job_title})"
                    className="min-h-[44px] w-full rounded-xl border border-gray-200 px-3 text-xs"
                  />
                )}
                {needsReason && (
                  <input
                    value={reason}
                    onChange={(e) => {
                      setReason(e.target.value)
                      refill(jobTitle, e.target.value)
                    }}
                    placeholder="Reason (fills {reason})"
                    className="min-h-[44px] w-full rounded-xl border border-gray-200 px-3 text-xs"
                  />
                )}

                <textarea
                  rows={3}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder={`Write to ${selectedName || 'this member'} — edit the template freely before sending.`}
                  className="block w-full min-w-0 rounded-xl border border-gray-200 bg-tm-bg px-3 py-2 text-sm outline-none focus:border-tm-navy focus:bg-white lg:min-h-[104px]"
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => send('inapp')}
                    disabled={busy || body.trim().length < 2}
                    data-inapp-send=""
                    className="inline-flex min-h-[44px] min-w-0 flex-1 items-center justify-center gap-1.5 rounded-xl bg-tm-navy px-3 text-center text-xs font-bold text-white hover:bg-tm-navy-hover disabled:opacity-50 lg:px-5"
                  >
                    <Send aria-hidden size={14} />
                    {busy ? 'Sending…' : 'In-app + email'}
                  </button>
                  {/* WhatsApp — the platform's live channel. Only when the
                      member has a mobile on file (never a number they did not
                      give). It records and logs the message like the other
                      channel, then opens WhatsApp for the admin to send. */}
                  {selectedHasMobile && (
                    <button
                      type="button"
                      onClick={() => send('whatsapp')}
                      disabled={busy || body.trim().length < 2}
                      className="inline-flex min-h-[44px] min-w-0 flex-1 items-center justify-center gap-1.5 rounded-xl bg-tm-green-deep px-3 text-center text-xs font-bold text-white hover:bg-tm-green-deep-hover disabled:opacity-50 lg:px-5"
                    >
                      <MessageCircle aria-hidden size={14} />
                      Send on WhatsApp
                    </button>
                  )}
                </div>
                <p className="text-[10px] text-gray-500 max-lg:hidden">
                  Sent as {TEAM}. WhatsApp opens a pre-filled chat you send yourself; every send is
                  recorded in this thread and the audit log.
                </p>
              </div>}
            </>
          )}
        </section>
      </div>
    </div>
  )
}

function TemplatesEditor({ templates }: { templates: AdminTemplate[] }) {
  const toast = useToast()
  const [edited, setEdited] = useState<Record<string, AdminTemplate>>({})
  const [busy, setBusy] = useState<string | null>(null)

  const draft = (key: string): AdminTemplate =>
    edited[key] ?? templates.find((t) => t.key === key)!

  const setField = (key: string, field: keyof AdminTemplate, value: string) =>
    setEdited((e) => ({ ...e, [key]: { ...draft(key), [field]: value } }))

  const save = async (key: string) => {
    setBusy(key)
    try {
      const t = draft(key)
      const { ok, data } = await adminFetch<{ error?: string }>('/api/admin/inbox', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: t.key, title: t.title, subject: t.subject, body: t.body }),
      })
      if (!ok) throw new Error(data.error ?? 'Could not save.')
      toast.success('Template saved.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-3 rounded-2xl border border-gray-200 bg-white p-4">
      <p className="text-xs font-black text-tm-navy">Other templates</p>
      <p className="text-[11px] text-gray-500">
        Placeholders {'{name}'}, {'{job_title}'} and {'{reason}'} fill in when you send.
      </p>
      {templates.map((t) => {
        const d = draft(t.key)
        return (
          <details key={t.key} className="rounded-xl border border-gray-200 p-3">
            <summary className="cursor-pointer text-xs font-black text-tm-navy">{t.title}</summary>
            <div className="space-y-2 pt-2">
              <input
                value={d.title}
                onChange={(e) => setField(t.key, 'title', e.target.value)}
                className="min-h-[40px] w-full rounded-lg border border-gray-200 px-3 text-xs"
                aria-label="Title"
              />
              <input
                value={d.subject}
                onChange={(e) => setField(t.key, 'subject', e.target.value)}
                className="min-h-[40px] w-full rounded-lg border border-gray-200 px-3 text-xs"
                aria-label="Email subject"
              />
              <textarea
                rows={4}
                value={d.body}
                onChange={(e) => setField(t.key, 'body', e.target.value)}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-xs"
                aria-label="Body"
              />
              <button
                type="button"
                onClick={() => save(t.key)}
                disabled={busy === t.key}
                className="inline-flex min-h-[40px] items-center rounded-lg bg-tm-black px-4 text-xs font-bold text-white disabled:opacity-50"
              >
                {busy === t.key ? 'Saving…' : 'Save template'}
              </button>
            </div>
          </details>
        )
      })}
    </div>
  )
}

