'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

import { adminFetch } from '@/components/admin/adminFetch'
import { useAdminReadOnly } from '@/components/admin/ReadOnly'
import { useConfirm } from '@/components/ui/ConfirmDialog'
import { useToast } from '@/components/ui/Toast'

// "Held activity" (PR-08, owner 18 Nov 2026) — Owner only; the page renders it
// only for the Owner and the route refuses everyone else. A parent account that
// made more than 20 shortlists, or more than 20 message/demo attempts, inside an
// hour is held from the tutor teasers by default. Release lets its activity
// count again; Keep held keeps it out. The account itself is never changed.

export type HeldView = {
  parentId: string
  name: string
  status: 'held' | 'released' | 'kept'
  detected: string
  shortlists: number
  attempts: number
  heldEvents: number
}

const STATUS: Record<HeldView['status'], { label: string; cls: string }> = {
  held: { label: 'Held', cls: 'bg-tm-tint-red text-tm-red' },
  kept: { label: 'Kept held', cls: 'bg-tm-tint-navy text-tm-navy' },
  released: { label: 'Released', cls: 'bg-tm-tint-green text-tm-green-deep' },
}

const BTN = 'inline-flex min-h-[44px] items-center justify-center rounded-xl px-4 text-xs font-bold disabled:opacity-50'

export default function HeldActivityPanel({ rows }: { rows: HeldView[] }) {
  const router = useRouter()
  const toast = useToast()
  const confirm = useConfirm()
  const readOnly = useAdminReadOnly()
  const [busy, setBusy] = useState<string | null>(null)

  const decide = async (r: HeldView, action: 'release' | 'keep') => {
    if (action === 'release') {
      const ok = await confirm({
        title: 'Release this account?',
        body: `${r.name}'s shortlists and contact attempts will count in tutor teasers again.`,
        confirmLabel: 'Release',
      })
      if (!ok) return
    }
    setBusy(r.parentId)
    const { ok, data } = await adminFetch<{ error?: string }>('/api/admin/held-activity', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, parentId: r.parentId }),
    })
    setBusy(null)
    if (!ok) return toast.error(data?.error ?? 'That did not save. Please try again.')
    toast.success(action === 'release' ? 'Released — its activity counts again.' : 'Kept held.')
    router.refresh()
  }

  return (
    <section className="space-y-2 rounded-2xl border border-gray-200 bg-white p-3" aria-labelledby="held-activity">
      <h3 id="held-activity" className="text-sm font-black text-tm-navy">
        Held activity
      </h3>
      <p className="text-xs text-gray-600">
        Parent accounts with more than 20 shortlists or more than 20 message or demo requests in one hour. Their activity is kept out of
        tutor teasers until you release it. The account itself is not changed.
      </p>
      {rows.length === 0 ? (
        <p className="text-xs text-gray-600">Nothing held. An account appears here on its own if it bursts — no action needed now.</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => (
            <li key={r.parentId} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-tm-bg p-2">
              <div className="min-w-0">
                <a href={`/admin/users/${r.parentId}/activity?from=/admin/whatsapp-updates`} className="text-sm font-black text-tm-navy hover:underline">
                  {r.name}
                </a>
                <p className="text-[11px] text-gray-600">
                  {r.shortlists} shortlists · {r.attempts} message or demo requests in one hour · found {r.detected} · {r.heldEvents} events not used
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${STATUS[r.status].cls}`}>{STATUS[r.status].label}</span>
                {!readOnly && r.status !== 'released' && (
                  <button type="button" disabled={busy === r.parentId} onClick={() => void decide(r, 'release')} className={`${BTN} bg-tm-green-deep text-white`}>
                    Release
                  </button>
                )}
                {!readOnly && r.status !== 'kept' && (
                  <button type="button" disabled={busy === r.parentId} onClick={() => void decide(r, 'keep')} className={`${BTN} border border-tm-navy text-tm-navy`}>
                    Keep held
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
