'use client'

// Team inbox → Templates → Review new wording (owner, 28 Oct 2026). One card per
// template: live text, proposed text, a preview with sample data, and Approve /
// Edit then approve / Keep current. "Approve all" approves every template not
// decided yet. Each template's earlier wording is listed with Restore.

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2, History, PencilLine, RotateCcw } from 'lucide-react'
import { adminFetch } from '@/components/admin/adminFetch'
import { useToast } from '@/components/ui/Toast'
import { useConfirm } from '@/components/ui/ConfirmDialog'
import { formatDateTime } from '@/lib/datetime'
import { checkWording, previewText, proposalFor } from '@/lib/templateProposals'
import type { ReviewBoard, ReviewItem, ReviewStatus } from '@/lib/templateReview'

type Filter = 'all' | ReviewStatus

const STATUS_LABEL: Record<ReviewStatus, string> = {
  pending: 'Waiting for your decision',
  approved: 'Approved — live',
  kept: 'Kept current wording',
}
const STATUS_CHIP: Record<ReviewStatus, string> = {
  pending: 'bg-tm-tint-gold text-tm-gold-ink',
  approved: 'bg-tm-tint-green text-tm-green-deep',
  kept: 'bg-tm-tint-navy text-tm-navy',
}
const KIND_LABEL = { whatsapp: 'WhatsApp', team: 'Team inbox', email: 'Email' } as const
const RECIPIENT_LABEL = { parent: 'To Parent', tutor: 'To Tutor', member: 'To Member' } as const

export default function ReviewClient({ board, canDecide }: { board: ReviewBoard; canDecide: boolean }) {
  const toast = useToast()
  const confirm = useConfirm()
  const router = useRouter()
  const [filter, setFilter] = useState<Filter>('pending')
  const [busyAll, setBusyAll] = useState(false)
  const counts = useMemo(() => {
    const c = { all: board.items.length, pending: 0, approved: 0, kept: 0 }
    for (const i of board.items) c[i.status]++
    return c
  }, [board.items])
  const shown = board.items.filter((i) => filter === 'all' || i.status === filter)

  async function approveAll() {
    const ok = await confirm({
      title: `Approve all ${counts.pending} waiting templates?`,
      body: 'Each one goes live with its proposed wording. The current wording is kept in its history, and you can restore it at any time.',
      confirmLabel: 'Approve all',
      cancelLabel: 'Cancel',
      destructive: false,
    })
    if (!ok) return
    setBusyAll(true)
    const { ok: done, data } = await adminFetch<{ error?: string; approved?: number; skipped?: { key: string; why: string }[] }>(
      '/api/admin/templates/review',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'approve_all' }) },
    )
    setBusyAll(false)
    if (!done) return toast.error(data?.error ?? 'That did not save. Please try again.')
    toast.success(`${data.approved ?? 0} templates approved.`)
    for (const s of data.skipped ?? []) toast.error(`Not approved: ${s.key} — ${s.why}`)
    router.refresh()
  }

  return (
    <div className="mx-auto max-w-6xl space-y-4 px-4 py-6">
      <header className="space-y-2">
        <h1 className="text-xl font-black text-tm-navy">Review new wording</h1>
        <p className="text-sm text-slate-700">
          Every member message rewritten in simple English. Nothing changes until you approve it. The current wording stays in each template&rsquo;s
          history, so you can restore it.
        </p>
        <p className="text-xs text-gray-600">
          Previews use sample data. The support line uses the number in settings: <span className="font-mono text-tm-navy">{board.support}</span>.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="Filter templates">
        {(['pending', 'approved', 'kept', 'all'] as Filter[]).map((f) => (
          <button
            key={f}
            type="button"
            role="tab"
            aria-selected={filter === f}
            onClick={() => setFilter(f)}
            className={`min-h-[40px] rounded-full border px-4 text-xs font-bold ${filter === f ? 'border-tm-navy bg-tm-navy text-white' : 'border-gray-200 bg-white text-slate-700'}`}
          >
            {f === 'all' ? 'All' : f === 'pending' ? 'Waiting' : f === 'approved' ? 'Approved' : 'Kept current'} ({counts[f]})
          </button>
        ))}
        {canDecide && counts.pending > 0 && (
          <button
            type="button"
            disabled={busyAll}
            onClick={() => void approveAll()}
            className="ms-auto inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-tm-green-deep px-5 text-sm font-bold text-white hover:bg-tm-green-deep-hover disabled:opacity-60"
          >
            <CheckCircle2 aria-hidden size={16} /> {busyAll ? 'Approving…' : `Approve all (${counts.pending})`}
          </button>
        )}
      </div>
      {!canDecide && <p className="rounded-lg bg-tm-tint-navy px-3 py-2 text-xs text-tm-navy">View only — only the Owner approves new wording.</p>}

      {shown.length === 0 && <p className="rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-600">Nothing here.</p>}
      <div className="space-y-4">
        {shown.map((item) => (
          <ReviewCard key={item.key} item={item} canDecide={canDecide} support={board.support} />
        ))}
      </div>

      {board.notRewritten.length > 0 && (
        <section className="rounded-xl border border-gray-200 bg-white p-4 text-xs text-slate-700">
          <p className="font-bold text-tm-navy">Not rewritten</p>
          <ul className="mt-1 list-disc space-y-1 ps-5">
            {board.notRewritten.map((n) => (
              <li key={n.key}>
                <code>{n.key}</code> — {n.why}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

function TextBox({ label, subject, body, tone }: { label: string; subject?: string | null; body: string; tone: 'live' | 'new' | 'preview' }) {
  const ground = tone === 'preview' ? 'bg-tm-tint-green' : tone === 'new' ? 'bg-tm-tint-navy' : 'bg-tm-bg'
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-bold uppercase tracking-wide text-slate-700">{label}</p>
      <pre className={`mt-1 whitespace-pre-wrap break-words rounded-lg ${ground} px-3 py-2 font-sans text-xs leading-relaxed text-slate-800`}>
        {subject ? `Subject: ${subject}\n\n` : ''}
        {body || '(empty)'}
      </pre>
    </div>
  )
}

function ReviewCard({ item, canDecide, support }: { item: ReviewItem; canDecide: boolean; support: string }) {
  const toast = useToast()
  const confirm = useConfirm()
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [body, setBody] = useState(item.proposedBody)
  const [subject, setSubject] = useState(item.proposedSubject ?? '')
  const proposal = proposalFor(item.key)
  const editProblems = useMemo(
    () => (proposal && editing ? checkWording({ ...proposal, body, subject: proposal.kind === 'email' ? subject : undefined }, item.kind === 'email' ? null : item.liveBody) : []),
    [proposal, editing, body, subject, item.kind, item.liveBody],
  )

  async function post(payload: object, label: string, done: string) {
    setBusy(label)
    const { ok, data } = await adminFetch<{ error?: string; problems?: string[] }>('/api/admin/templates/review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    setBusy(null)
    if (!ok) {
      toast.error([data?.error ?? 'That did not save. Please try again.', ...(data?.problems ?? [])].join('\n'))
      return false
    }
    toast.success(done)
    router.refresh()
    return true
  }

  const approve = () => post({ action: 'approve', key: item.key }, 'approve', `${item.title}: approved. The new wording is live.`)
  const approveEdited = async () => {
    const ok = await post(
      { action: 'approve', key: item.key, body, subject: item.kind === 'email' ? subject : null },
      'edit',
      `${item.title}: your edited wording is live.`,
    )
    if (ok) setEditing(false)
  }
  const keep = () => post({ action: 'keep', key: item.key }, 'keep', `${item.title}: the current wording stays.`)
  const restore = async (historyId: string, when: string) => {
    const ok = await confirm({
      title: 'Restore this earlier wording?',
      body: `The wording saved ${when} goes live again. The current wording is kept in the history.`,
      confirmLabel: 'Restore',
      cancelLabel: 'Cancel',
      destructive: false,
    })
    if (ok) await post({ action: 'restore', historyId }, `restore-${historyId}`, `${item.title}: earlier wording restored.`)
  }

  return (
    <article className="rounded-2xl border border-gray-200 bg-white p-4" data-template={item.key}>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-black text-tm-navy">{item.title}</h2>
        <span className="rounded bg-tm-bg px-1.5 py-0.5 text-[10px] font-bold text-slate-700">{KIND_LABEL[item.kind]}</span>
        <span className="rounded bg-tm-tint-navy px-1.5 py-0.5 text-[10px] font-bold text-tm-navy">{RECIPIENT_LABEL[item.recipient]}</span>
        <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${STATUS_CHIP[item.status]}`}>{STATUS_LABEL[item.status]}</span>
        {item.edited && <span className="rounded bg-tm-tint-gold px-1.5 py-0.5 text-[10px] font-bold text-tm-gold-ink">Edited</span>}
        <code className="ms-auto text-[10px] text-gray-500">{item.key}</code>
      </div>
      {item.decidedAt && (
        <p className="mt-1 text-[11px] text-gray-600">
          {item.status === 'approved' ? 'Approved' : 'Kept'} {formatDateTime(item.decidedAt)}
          {item.decidedByName ? ` by ${item.decidedByName}` : ''}
        </p>
      )}
      {item.missing && <p className="mt-2 rounded-lg bg-tm-tint-red px-3 py-2 text-xs text-tm-red">This template is not set up in the database, so it cannot be approved.</p>}
      {item.problems.length > 0 && (
        <ul className="mt-2 list-disc rounded-lg bg-tm-tint-red px-6 py-2 text-xs text-tm-red">
          {item.problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}

      <div className="mt-3 grid gap-3 lg:grid-cols-3">
        <TextBox label="Live now" subject={item.kind === 'email' ? null : item.liveSubject} body={item.kind === 'email' ? item.liveBody : item.liveBody} tone="live" />
        <TextBox label="Proposed" subject={item.proposedSubject} body={item.proposedBody + (item.button ? `\n\n(button: ${item.button})` : '')} tone="new" />
        <TextBox label="Preview with sample data" body={item.proposedPreview} tone="preview" />
      </div>

      {editing && (
        <div className="mt-3 space-y-2 rounded-xl border border-tm-navy/30 bg-tm-bg p-3">
          {item.kind === 'email' && (
            <label className="block text-xs font-bold text-slate-700">
              Subject
              <input value={subject} onChange={(e) => setSubject(e.target.value)} className="mt-1 min-h-[40px] w-full rounded-lg border border-gray-200 px-3 text-xs font-normal" />
            </label>
          )}
          <label className="block text-xs font-bold text-slate-700">
            Wording
            <textarea rows={9} value={body} onChange={(e) => setBody(e.target.value)} className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 font-mono text-xs font-normal" />
          </label>
          <p className="text-[11px] text-gray-600">Placeholders: {item.placeholders.map((p) => `{${p}}`).join(' ')}</p>
          {editProblems.length > 0 ? (
            <ul className="list-disc ps-5 text-xs text-tm-red">
              {editProblems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          ) : (
            <p className="text-xs font-bold text-tm-green-deep">Follows the writing rules.</p>
          )}
          <TextBox label="Preview of your edit" body={previewText(body, support)} tone="preview" />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy !== null || editProblems.length > 0}
              onClick={() => void approveEdited()}
              className="min-h-[44px] rounded-xl bg-tm-green-deep px-4 text-xs font-bold text-white disabled:opacity-50"
            >
              {busy === 'edit' ? 'Saving…' : 'Approve my edit'}
            </button>
            <button type="button" onClick={() => setEditing(false)} className="min-h-[44px] rounded-xl border border-gray-200 px-4 text-xs font-bold text-slate-700">
              Cancel
            </button>
          </div>
        </div>
      )}

      {canDecide && !item.missing && !editing && (
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy !== null || item.problems.length > 0 || item.isLive}
            onClick={() => void approve()}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-tm-green-deep px-4 text-xs font-bold text-white hover:bg-tm-green-deep-hover disabled:opacity-50"
          >
            <CheckCircle2 aria-hidden size={14} /> {busy === 'approve' ? 'Approving…' : item.isLive ? 'Live now' : 'Approve'}
          </button>
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => setEditing(true)}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-tm-navy px-4 text-xs font-bold text-tm-navy"
          >
            <PencilLine aria-hidden size={14} /> Edit then approve
          </button>
          <button
            type="button"
            disabled={busy !== null || item.status === 'kept'}
            onClick={() => void keep()}
            className="inline-flex min-h-[44px] items-center rounded-xl border border-gray-200 px-4 text-xs font-bold text-slate-700 disabled:opacity-50"
          >
            {busy === 'keep' ? 'Saving…' : 'Keep current'}
          </button>
        </div>
      )}

      {item.history.length > 0 && (
        <details className="mt-3 rounded-xl border border-gray-200 p-3">
          <summary className="flex cursor-pointer items-center gap-1.5 text-xs font-bold text-tm-navy">
            <History aria-hidden size={14} /> Earlier wording ({item.history.length})
          </summary>
          <ul className="mt-2 space-y-2">
            {item.history.map((h) => (
              <li key={h.id} className="rounded-lg bg-tm-bg p-2 text-xs">
                <p className="text-[11px] text-gray-600">
                  Replaced {formatDateTime(h.savedAt)}
                  {h.savedByName ? ` by ${h.savedByName}` : ''} ({h.action === 'approve' ? 'new wording approved' : h.action === 'restore' ? 'restored' : 'edited'})
                </p>
                <pre className="mt-1 whitespace-pre-wrap break-words font-sans text-slate-800">
                  {h.body == null ? '(the built-in email wording)' : `${h.subject && item.kind === 'email' ? `Subject: ${h.subject}\n\n` : ''}${h.body}`}
                </pre>
                {canDecide && (
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => void restore(h.id, formatDateTime(h.savedAt))}
                    className="mt-1 inline-flex min-h-[40px] items-center gap-1 rounded-lg border border-gray-200 bg-white px-3 font-bold text-slate-700"
                  >
                    <RotateCcw aria-hidden size={13} /> Restore
                  </button>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </article>
  )
}
