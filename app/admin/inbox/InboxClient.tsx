'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Send, Pencil, ShieldCheck } from 'lucide-react'
import { adminFetch } from '@/components/admin/adminFetch'
import { useToast } from '@/components/ui/Toast'
import { formatDateTime } from '@/lib/datetime'
import type { AdminMessage, AdminTemplate, InboxThread } from '@/lib/adminMessaging'

const TEAM = 'TutorMint Team'

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
  conversation,
  canEditTemplates,
}: {
  threads: InboxThread[]
  templates: AdminTemplate[]
  selectedId: string | null
  selectedName: string
  conversation: AdminMessage[]
  canEditTemplates: boolean
}) {
  const router = useRouter()
  const toast = useToast()

  const [templateKey, setTemplateKey] = useState('')
  const [jobTitle, setJobTitle] = useState('')
  const [reason, setReason] = useState('')
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [showTemplates, setShowTemplates] = useState(false)

  const chosen = templates.find((t) => t.key === templateKey) ?? null
  const needsJob = !!chosen && chosen.body.includes('{job_title}')
  const needsReason = !!chosen && chosen.body.includes('{reason}')

  const applyTemplate = (key: string) => {
    setTemplateKey(key)
    const t = templates.find((x) => x.key === key)
    if (t) setBody(fill(t.body, { name: selectedName || 'there', jobTitle, reason }))
  }

  // Keep the {job_title}/{reason} substitutions live as the admin fills them.
  const refill = (nextJob: string, nextReason: string) => {
    if (chosen) setBody(fill(chosen.body, { name: selectedName || 'there', jobTitle: nextJob, reason: nextReason }))
  }

  const send = async () => {
    if (!selectedId) return
    setBusy(true)
    try {
      const { ok, data } = await adminFetch<{ error?: string }>('/api/admin/inbox', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ memberId: selectedId, body: body.trim(), templateKey: templateKey || null }),
      })
      if (!ok) throw new Error(data.error ?? 'Could not send.')
      toast.success('Message sent. The member has been notified.')
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
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-black text-tm-navy">Team inbox</h1>
          <p className="text-xs text-gray-500">Official messages to members, and their replies.</p>
        </div>
        {canEditTemplates && (
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

      {showTemplates && <TemplatesEditor templates={templates} />}

      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        {/* --------------------------------------------------- thread list --- */}
        <nav className="space-y-1.5" aria-label="Conversations">
          {threads.length === 0 ? (
            <p className="rounded-2xl border border-gray-200 bg-white p-4 text-xs text-gray-500">
              No conversations yet. Open a member and send the first message.
            </p>
          ) : (
            threads.map((t) => (
              <Link
                key={t.memberId}
                href={`/admin/inbox?to=${t.memberId}`}
                className={`block rounded-2xl border p-3 transition-colors ${
                  t.memberId === selectedId
                    ? 'border-tm-navy bg-white'
                    : 'border-gray-200 bg-white hover:border-tm-navy'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-xs font-black text-tm-navy">{t.memberName}</span>
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
              </Link>
            ))
          )}
        </nav>

        {/* --------------------------------------------------- conversation --- */}
        <section className="space-y-3 rounded-2xl border border-gray-200 bg-white p-4">
          {!selectedId ? (
            <p className="text-xs text-gray-500">Pick a conversation, or open a member to start one.</p>
          ) : (
            <>
              <div className="flex items-center gap-2 border-b border-gray-100 pb-2">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-tm-navy text-white">
                  <ShieldCheck aria-hidden size={14} />
                </span>
                <div className="min-w-0">
                  <Link
                    href={`/admin/users/${selectedId}`}
                    className="block truncate text-sm font-black text-tm-navy hover:underline"
                  >
                    {selectedName}
                  </Link>
                  <p className="text-[10px] text-gray-500">You reply as {TEAM}.</p>
                </div>
              </div>

              <ol className="max-h-[46vh] space-y-2 overflow-y-auto">
                {conversation.length === 0 ? (
                  <li className="text-[11px] text-gray-500">No messages yet.</li>
                ) : (
                  conversation.map((m) => {
                    const fromTeam = m.direction === 'out'
                    return (
                      <li key={m.id} className={`flex ${fromTeam ? 'justify-end' : 'justify-start'}`}>
                        <div
                          className={`max-w-[85%] space-y-1 rounded-2xl px-3 py-2 ${
                            fromTeam ? 'rounded-tr-sm bg-tm-tint-navy' : 'rounded-tl-sm border border-gray-200 bg-tm-bg'
                          }`}
                        >
                          <p className="text-[10px] font-black uppercase tracking-wide text-slate-600">
                            {fromTeam ? TEAM : selectedName}
                          </p>
                          <p className="whitespace-pre-wrap text-xs leading-relaxed text-slate-700">{m.body}</p>
                          <p className="text-[10px] text-slate-600">{formatDateTime(m.createdAt)}</p>
                        </div>
                      </li>
                    )
                  })
                )}
              </ol>

              {/* ----------------------------------------------- compose --- */}
              <div className="space-y-2 border-t border-gray-100 pt-3">
                <select
                  value={templateKey}
                  onChange={(e) => applyTemplate(e.target.value)}
                  className="min-h-[44px] w-full rounded-xl border border-gray-200 bg-white px-3 text-xs font-semibold"
                >
                  <option value="">Start from a template…</option>
                  {templates.map((t) => (
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
                  rows={4}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder={`Write to ${selectedName || 'this member'} — edit the template freely before sending.`}
                  className="w-full rounded-xl border border-gray-200 bg-tm-bg px-3 py-2 text-sm outline-none focus:border-tm-navy focus:bg-white"
                />
                <button
                  type="button"
                  onClick={send}
                  disabled={busy || body.trim().length < 2}
                  className="inline-flex min-h-[44px] w-full items-center justify-center gap-1.5 rounded-xl bg-tm-red px-5 text-xs font-bold text-white hover:bg-tm-red-hover disabled:opacity-50"
                >
                  <Send aria-hidden size={14} />
                  {busy ? 'Sending…' : `Send as ${TEAM}`}
                </button>
              </div>
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
