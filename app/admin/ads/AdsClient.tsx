'use client'
import { Pause, Trash2, Undo2 } from 'lucide-react'

import { submitSignal } from '@/lib/submit'

import FileUpload from '@/components/FileUpload'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import InfiniteFooter from '@/components/InfiniteFooter'
import { formatDate } from '@/lib/datetime'
import { useInfinite } from '@/lib/useInfinite'
import { useToast } from '@/components/ui/Toast'
import { useConfirm } from '@/components/ui/ConfirmDialog'
import type { QueueAdRow } from '@/lib/adminQueues'

// The ads screen: a create form and a list with per-ad analytics.
//
// Cards, not a table, at every width: each ad carries a creative, a date
// window, a weight and three actions, none of which survive being squeezed
// into a column at 360px.

export type AdRow = QueueAdRow

const AUDIENCES = [
  { code: 'parents', label: 'Parents (browse tutors, parent dashboard)' },
  { code: 'tutors', label: 'Tutors (browse tuitions)' },
  { code: 'both', label: 'Everyone' },
]

const EMPTY = {
  title: '',
  clientName: '',
  description: '',
  targetUrl: '',
  audience: 'both',
  weight: '1',
  startsAt: '',
  endsAt: '',
}

export default function AdsClient({
  ads,
  initialCursor,
  total,
}: {
  ads: AdRow[]
  initialCursor: string | null
  total: number
}) {
  const router = useRouter()
  const more = useInfinite<AdRow>({
    endpoint: '/api/admin/queues/ads',
    params: {},
    initialCursor,
    storageKey: 'tm:more:admin-ads',
  })
  const all = [...ads, ...more.items]
  const [form, setForm] = useState(EMPTY)
  const [file, setFile] = useState<File | null>(null)
  const [creating, setCreating] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const toast = useToast()
  const confirm = useConfirm()

  const post = async (body: FormData, id: string) => {
    setBusy(id)
    setError(null)
    try {
      const res = await fetch('/api/admin/ads', { signal: submitSignal(), method: 'POST', body })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'That did not work.')
      router.refresh()
      return json
    } catch (e) {
      const message = e instanceof Error ? e.message : 'That did not work.'
      setError(message)
      toast.error(message)
      return null
    } finally {
      setBusy(null)
    }
  }

  const create = async () => {
    const fd = new FormData()
    fd.set('action', 'create')
    for (const [k, v] of Object.entries(form)) fd.set(k, v)
    if (file) fd.set('image', file)
    const json = await post(fd, 'new')
    if (json) {
      setForm(EMPTY)
      setFile(null)
      setCreating(false)
      toast.success('Advertisement created as a draft.')
    }
  }

  const setStatus = async (id: string, status: string) => {
    const fd = new FormData()
    fd.set('action', 'status')
    fd.set('adId', id)
    fd.set('status', status)
    const json = await post(fd, id)
    if (json) toast.success(status === 'active' ? 'Advertisement is live.' : 'Advertisement paused.')
    return json
  }

  const remove = async (id: string, title: string) => {
    const ok = await confirm({
      title: `Delete “${title}”?`,
      body: 'Its impression and click history goes with it. This cannot be undone.',
      confirmLabel: 'Delete',
    })
    if (!ok) return
    const fd = new FormData()
    fd.set('action', 'delete')
    fd.set('adId', id)
    const json = await post(fd, id)
    if (json) toast.success('Advertisement deleted.')
    return json
  }

  return (
    <div className="space-y-5">
      <header className="space-y-1">
        <p className="text-xs leading-relaxed text-gray-500">
          Banners only. Ads never appear as tutor cards and never enter search ranking — ranking is
          sold through plans. Slots: after every 8 browse results, the parent dashboard, and the
          tutor dashboard (house creatives only). The homepage carries none.
        </p>
      </header>

      {error && (
        <p className="rounded-xl border border-tm-red/30 bg-tm-tint-red p-3 text-xs font-bold text-tm-red">
          {error}
        </p>
      )}

      {creating ? (
        <section className="space-y-3 rounded-2xl border border-gray-200 bg-white p-4">
          <h2 className="text-sm font-black text-tm-navy">New advertisement</h2>

          <Field label="Title">
            <input
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              className="min-h-[44px] w-full rounded-xl border border-gray-200 px-3 text-xs font-semibold"
            />
          </Field>

          <Field label="Advertiser (shown next to “Sponsored”)">
            <input
              value={form.clientName}
              onChange={(e) => setForm({ ...form, clientName: e.target.value })}
              className="min-h-[44px] w-full rounded-xl border border-gray-200 px-3 text-xs font-semibold"
            />
          </Field>

          <Field label="Body text">
            <textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              rows={2}
              className="w-full rounded-xl border border-gray-200 p-3 text-xs"
            />
          </Field>

          <Field label="Creative (image)">
            {/* Admin sees the creative before an advertiser's banner goes into
                rotation, which is the one place a wrong file is public. */}
            <FileUpload
              label="Ad creative"
              acceptLabel="JPG or PNG"
              onFile={(f) => setFile(f)}
            />
          </Field>

          <Field label="Destination URL">
            <input
              value={form.targetUrl}
              onChange={(e) => setForm({ ...form, targetUrl: e.target.value })}
              placeholder="https://example.com/…"
              className="min-h-[44px] w-full rounded-xl border border-gray-200 px-3 text-xs font-semibold"
            />
          </Field>

          <Field label="Audience">
            <select
              value={form.audience}
              onChange={(e) => setForm({ ...form, audience: e.target.value })}
              className="min-h-[44px] w-full rounded-xl border border-gray-200 bg-white px-3 text-xs font-semibold"
            >
              {AUDIENCES.map((a) => (
                <option key={a.code} value={a.code}>
                  {a.label}
                </option>
              ))}
            </select>
          </Field>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="Weight (share of rotation)">
              <input
                type="number"
                min={1}
                max={100}
                value={form.weight}
                onChange={(e) => setForm({ ...form, weight: e.target.value })}
                className="min-h-[44px] w-full rounded-xl border border-gray-200 px-3 text-xs font-semibold"
              />
            </Field>
            <Field label="Starts">
              <input
                type="date"
                value={form.startsAt}
                onChange={(e) => setForm({ ...form, startsAt: e.target.value })}
                className="min-h-[44px] w-full rounded-xl border border-gray-200 px-3 text-xs font-semibold"
              />
            </Field>
            <Field label="Ends">
              <input
                type="date"
                value={form.endsAt}
                onChange={(e) => setForm({ ...form, endsAt: e.target.value })}
                className="min-h-[44px] w-full rounded-xl border border-gray-200 px-3 text-xs font-semibold"
              />
            </Field>
          </div>

          <p className="rounded-xl bg-tm-bg p-3 text-[11px] leading-relaxed text-gray-500">
            New ads are created as drafts. Nothing appears on a public page until you set it live.
          </p>

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={create}
              disabled={busy === 'new' || form.title.trim().length < 3}
              className="inline-flex items-center gap-1.5 min-h-[44px] rounded-xl bg-tm-black px-4 text-xs font-bold text-white disabled:bg-gray-300"
            >
              {busy === 'new' ? 'Saving…' : 'Create as draft'}
            </button>
            <button
              type="button"
              onClick={() => setCreating(false)}
              className="inline-flex items-center justify-center gap-1.5 min-h-[44px] rounded-xl border border-gray-200 px-4 text-xs font-bold text-slate-700"
            >
              <Undo2 aria-hidden size={13} />
              Cancel
            </button>
          </div>
        </section>
      ) : (
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="min-h-[44px] w-full rounded-xl bg-tm-black px-4 text-xs font-bold text-white sm:w-auto sm:px-6"
        >
          New advertisement
        </button>
      )}

      {all.length === 0 ? (
        <p className="rounded-2xl border border-gray-200 bg-white p-6 text-center text-xs text-gray-500">
          No advertisements yet. Empty slots show a TutorMint house creative.
        </p>
      ) : (
        <ul className="space-y-3">
          {all.map((a) => {
            const ctr = a.impressions > 0 ? ((a.clicks / a.impressions) * 100).toFixed(1) : '—'
            return (
              <li key={a.id} className="space-y-3 rounded-2xl border border-gray-200 bg-white p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-black text-tm-navy">{a.title}</p>
                    <p className="truncate text-[11px] text-gray-500">
                      {a.clientName || 'No advertiser named'} · {a.audience} · weight {a.weight}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-wide ${
                      a.live
                        ? 'bg-tm-tint-green text-tm-green-deep'
                        : a.expired
                          ? 'bg-gray-100 text-gray-700'
                          : 'bg-tm-tint-gold text-tm-gold-ink'
                    }`}
                  >
                    {a.live ? 'live' : a.expired ? 'expired' : a.status}
                  </span>
                </div>

                {a.imageUrl && (
                  // eslint-disable-next-line @next/next/no-img-element -- the
                  // same reasoning as the slot itself: an uploaded creative is
                  // not run through the image optimiser.
                  <img
                    src={a.imageUrl}
                    alt=""
                    className="h-24 w-full rounded-xl object-cover"
                  />
                )}

                <dl className="grid grid-cols-3 gap-2 text-[11px]">
                  <Stat label="Impressions" value={a.impressions.toLocaleString('en-PK')} />
                  <Stat label="Clicks" value={a.clicks.toLocaleString('en-PK')} />
                  <Stat label="CTR" value={ctr === '—' ? '—' : `${ctr}%`} />
                </dl>

                <p className="text-[11px] text-gray-500">
                  {formatDate(a.startsAt)} →{' '}
                  {a.endsAt ? formatDate(a.endsAt) : 'no end date'}
                  {a.targetUrl ? ` · ${a.targetUrl}` : ''}
                </p>

                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {a.status !== 'active' ? (
                    <button
                      type="button"
                      disabled={busy === a.id || a.expired}
                      onClick={() => setStatus(a.id, 'active')}
                      className="min-h-[44px] rounded-xl bg-tm-green-deep px-3 text-xs font-bold text-white disabled:bg-gray-300"
                    >
                      {a.expired ? 'Expired' : 'Set live'}
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={busy === a.id}
                      onClick={() => setStatus(a.id, 'paused')}
                      className="inline-flex items-center justify-center gap-1.5 min-h-[44px] rounded-xl border border-gray-200 px-3 text-xs font-bold text-slate-700"
                    >
                      <Pause aria-hidden size={13} />
                      Pause
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={busy === a.id}
                    onClick={() => remove(a.id, a.title)}
                    className="inline-flex items-center justify-center gap-1.5 min-h-[44px] rounded-xl border border-gray-200 px-3 text-xs font-bold text-tm-red"
                  >
                    <Trash2 aria-hidden size={13} />
                    Delete
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {all.length > 0 && (
        <InfiniteFooter
          state={more.state}
          done={more.done}
          loadMore={more.loadMore}
          sentinel={more.sentinel}
          loadedCount={all.length}
          total={total}
          noun="advertisements"
        />
      )}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-[11px] font-bold text-gray-500">{label}</span>
      {children}
    </label>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10px] font-bold uppercase tracking-wide text-gray-500">{label}</dt>
      <dd className="text-sm font-black text-tm-navy">{value}</dd>
    </div>
  )
}
