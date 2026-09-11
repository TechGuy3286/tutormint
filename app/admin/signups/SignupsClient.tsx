'use client'

import { useState } from 'react'
import { Mail, MessageCircle, Send, X, AlertTriangle } from 'lucide-react'
import { useToast } from '@/components/ui/Toast'
import { formatDate } from '@/lib/datetime'
import type { AbandonedSignup, SignupStage } from '@/lib/abandonedSignups'

// Types only (import type is erased) so this client file never pulls in the
// server-only lib. The runtime labels/fallbacks live here.

const STAGE_LABEL: Record<SignupStage, string> = {
  email_unconfirmed: 'Email not confirmed',
  profile_unfinished: 'Profile unfinished',
}

// Fallback bodies matching migration 64, so the compose box still works on an
// environment where the templates have not been seeded yet. The
// 'mobile_unverified' stage is gone (owner, 11 Sep 2026) — a mobile signup no
// longer creates an account until it is verified, so there is no such row.
const FALLBACK: Record<SignupStage, string> = {
  email_unconfirmed:
    'Hi {name}, thanks for signing up to TutorMint. Your account is not active yet — please confirm your email address using the link we sent you (check spam too). If it did not arrive, reply and we will help you get in.',
  profile_unfinished:
    'Hi {name}, you are almost set up on TutorMint — your profile just is not finished. Completing it lets parents find you, or lets you start hiring. It takes a few minutes from your dashboard. Reply if you would like a hand.',
}

function firstName(full: string | null): string {
  const f = (full ?? '').trim().split(/\s+/)[0]
  return f || 'there'
}

export default function SignupsClient({
  rows,
  ok,
  templateBodies,
}: {
  rows: AbandonedSignup[]
  ok: boolean
  templateBodies: Record<string, string>
}) {
  const { success, error } = useToast()
  const [selected, setSelected] = useState<AbandonedSignup | null>(null)
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState<Set<string>>(new Set())

  function open(row: AbandonedSignup) {
    const template = templateBodies[row.templateKey] ?? FALLBACK[row.stage]
    setBody(template.replaceAll('{name}', firstName(row.fullName)))
    setSelected(row)
  }

  async function handleSend() {
    if (!selected) return
    const trimmed = body.trim()
    if (trimmed.length < 2) {
      error('Write a message first.')
      return
    }
    setSending(true)
    try {
      const res = await fetch('/api/admin/inbox', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          memberId: selected.userId,
          body: trimmed,
          templateKey: selected.templateKey,
          // The channel the member gave: an email signup gets the in-app +
          // email path; a mobile signup gets a WhatsApp link. Never the other.
          channel: selected.channel === 'whatsapp' ? 'whatsapp' : 'inapp',
        }),
      })
      const data = (await res.json()) as { error?: string; waHref?: string | null }
      if (!res.ok) {
        error(data.error ?? 'Could not send.')
        return
      }
      if (selected.channel === 'whatsapp') {
        if (data.waHref) window.open(data.waHref, '_blank', 'noopener,noreferrer')
        success('WhatsApp opened — send the message there to deliver it.')
      } else {
        success('Message sent by email and in-app.')
      }
      setSent((prev) => new Set(prev).add(selected.userId))
      setSelected(null)
    } catch {
      error('Could not send. Please try again.')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-black text-tm-navy">Abandoned signups</h1>
        <p className="text-xs text-gray-500">
          Accounts that started but never crossed the line. Message them on the channel they gave —
          email for an email signup, WhatsApp for a mobile one. No prices; these are nudges to
          finish, not offers.
        </p>
      </div>

      {!ok && (
        <p className="rounded-xl border border-tm-red/30 bg-tm-tint-red p-4 text-xs font-bold text-tm-red">
          Could not enumerate accounts (SUPABASE_SERVICE_ROLE_KEY missing, or the Auth API refused).
          The list may be incomplete.
        </p>
      )}

      {rows.length === 0 ? (
        <p className="rounded-2xl border border-tm-green-deep/30 bg-tm-tint-green p-6 text-center text-xs font-bold text-tm-green-deep">
          No abandoned signups. Everyone who registered has verified and started their profile.
        </p>
      ) : (
        <>
          <p className="flex items-center gap-2 rounded-xl border border-gray-200 bg-tm-bg p-3 text-[11px] font-semibold text-slate-700">
            <AlertTriangle aria-hidden size={14} className="shrink-0 text-tm-gold-ink" />
            {rows.length} signup{rows.length === 1 ? '' : 's'} stuck. A message goes out as the
            official TutorMint Team, is audit-logged and appears on the member’s timeline.
          </p>

          <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white">
            <table className="w-full text-left text-[11px]">
              <thead className="border-b border-gray-200 text-gray-500">
                <tr>
                  <th className="p-3 font-bold">Contact</th>
                  <th className="p-3 font-bold">Stuck at</th>
                  <th className="p-3 font-bold">Role</th>
                  <th className="p-3 font-bold">Channel</th>
                  <th className="p-3 font-bold">Signed up</th>
                  <th className="p-3 font-bold" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map((r) => (
                  <tr key={r.userId} className="align-middle">
                    <td className="p-3">
                      <span className="block font-semibold text-tm-navy">{r.contact}</span>
                      {r.fullName && <span className="block text-gray-500">{r.fullName}</span>}
                    </td>
                    <td className="p-3">
                      <span className="inline-block rounded-full bg-tm-tint-gold px-2 py-0.5 text-[10px] font-bold text-tm-gold-ink">
                        {STAGE_LABEL[r.stage]}
                        {r.stage === 'profile_unfinished' ? ` · ${r.completion}%` : ''}
                      </span>
                    </td>
                    <td className="p-3 text-slate-700">{r.role ?? '—'}</td>
                    <td className="p-3">
                      <span className="inline-flex items-center gap-1 rounded-full bg-tm-tint-navy px-2 py-0.5 text-[10px] font-bold text-tm-navy">
                        {r.channel === 'whatsapp' ? (
                          <>
                            <MessageCircle aria-hidden size={11} /> WhatsApp
                          </>
                        ) : (
                          <>
                            <Mail aria-hidden size={11} /> Email
                          </>
                        )}
                      </span>
                    </td>
                    <td className="p-3 text-gray-500">
                      {r.createdAt ? formatDate(r.createdAt) : '—'}
                    </td>
                    <td className="p-3 text-right">
                      {sent.has(r.userId) ? (
                        <span className="text-[10px] font-bold text-tm-green-deep">Messaged</span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => open(r)}
                          className="inline-flex min-h-[36px] items-center gap-1 rounded-full bg-tm-red px-3 py-1.5 text-[11px] font-bold text-white hover:bg-tm-red-hover"
                        >
                          <Send aria-hidden size={12} /> Message
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {selected && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-tm-black/40 p-0 sm:items-center sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Compose message"
          onClick={(e) => {
            if (e.target === e.currentTarget && !sending) setSelected(null)
          }}
        >
          <div className="w-full max-w-lg rounded-t-2xl border border-gray-200 bg-white p-4 shadow-lg sm:rounded-2xl">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-black text-tm-navy">
                  Message {selected.fullName || selected.contact}
                </h2>
                <p className="text-[11px] text-gray-500">
                  {STAGE_LABEL[selected.stage]} ·{' '}
                  {selected.channel === 'whatsapp'
                    ? 'sends on WhatsApp — a link opens for you to deliver it'
                    : 'sends by email and in the member’s inbox'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => !sending && setSelected(null)}
                className="shrink-0 rounded-full p-1 text-gray-500 hover:text-tm-navy"
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>

            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={7}
              className="w-full rounded-xl border border-gray-300 p-3 text-xs text-slate-700 focus:border-tm-navy focus:outline-none"
              placeholder="Write your message…"
            />

            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => !sending && setSelected(null)}
                className="min-h-[40px] rounded-full border border-gray-300 px-4 text-xs font-bold text-slate-700 hover:border-tm-navy"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSend}
                disabled={sending}
                className="inline-flex min-h-[40px] items-center gap-1.5 rounded-full bg-tm-red px-4 text-xs font-bold text-white hover:bg-tm-red-hover disabled:opacity-60"
              >
                <Send aria-hidden size={14} />
                {sending
                  ? 'Sending…'
                  : selected.channel === 'whatsapp'
                    ? 'Open WhatsApp'
                    : 'Send'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
