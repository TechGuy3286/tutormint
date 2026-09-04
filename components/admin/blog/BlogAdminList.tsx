'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Eye, MousePointerClick } from 'lucide-react'

import TimeAgo from '@/components/TimeAgo'
import { POST_CLUSTERS, clusterLabel, statusLabel, type PostStatus } from '@/lib/blog'
import type { AdminPostRow } from '@/lib/blogFeed'

// The admin blog list: filters (status, cluster, title search) and infinite
// scroll. Self-fetching — an admin screen is not an organic-search surface, so
// there is no server-render requirement; the page seeds the first page for
// speed and this refetches when a filter changes.

const STATUS_STYLES: Record<PostStatus, string> = {
  draft: 'bg-gray-100 text-gray-600',
  reviewed: 'bg-tm-tint-gold text-tm-gold-ink',
  scheduled: 'bg-tm-tint-navy text-tm-navy',
  published: 'bg-tm-tint-green text-tm-green-deep',
  unpublished: 'bg-tm-tint-red text-tm-red-hover',
}

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'All statuses' },
  { value: 'draft', label: 'Draft' },
  { value: 'reviewed', label: 'Reviewed' },
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'published', label: 'Published' },
  { value: 'unpublished', label: 'Unpublished' },
]

export default function BlogAdminList({
  initialItems,
  initialCursor,
}: {
  initialItems: AdminPostRow[]
  initialCursor: string | null
}) {
  const [items, setItems] = useState<AdminPostRow[]>(initialItems)
  const [cursor, setCursor] = useState<string | null>(initialCursor)
  const [q, setQ] = useState('')
  const [cluster, setCluster] = useState('')
  const [status, setStatus] = useState('')
  const [loading, setLoading] = useState(false)
  const firstRender = useRef(true)

  const fetchPage = useCallback(
    async (reset: boolean) => {
      setLoading(true)
      const qs = new URLSearchParams()
      if (q.trim()) qs.set('q', q.trim())
      if (cluster) qs.set('cluster', cluster)
      if (status) qs.set('status', status)
      if (!reset && cursor) qs.set('cursor', cursor)
      try {
        const r = await fetch(`/api/admin/blog/list?${qs}`, { headers: { accept: 'application/json' } })
        const page = (await r.json()) as { items: AdminPostRow[]; cursor: string | null }
        setItems((prev) => (reset ? page.items : [...prev, ...page.items]))
        setCursor(page.cursor)
      } catch {
        /* leave the list as-is; the filter can be retried */
      } finally {
        setLoading(false)
      }
    },
    [q, cluster, status, cursor],
  )

  // Refetch page 1 when a filter changes (debounced for the text box).
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false
      return
    }
    const t = setTimeout(() => void fetchPage(true), 250)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, cluster, status])

  const select =
    'min-h-[44px] rounded-xl border border-gray-200 bg-white px-3 text-xs font-semibold text-tm-navy'

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search titles…"
          className="min-h-[44px] flex-1 rounded-xl border border-gray-200 bg-white px-3 text-xs text-tm-navy placeholder:text-gray-500"
        />
        <select value={cluster} onChange={(e) => setCluster(e.target.value)} className={select} aria-label="Cluster">
          <option value="">All topics</option>
          {POST_CLUSTERS.map((c) => (
            <option key={c.slug} value={c.slug}>
              {c.label}
            </option>
          ))}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className={select} aria-label="Status">
          {STATUS_OPTIONS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </div>

      {items.length === 0 ? (
        <p className="rounded-2xl border border-gray-200 bg-white p-6 text-center text-xs text-gray-500">
          {loading ? 'Loading…' : 'No posts match.'}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white">
          <table className="w-full min-w-[720px] text-left text-xs">
            <thead className="border-b border-gray-200 text-gray-500">
              <tr>
                <th className="p-3 font-bold">Title</th>
                <th className="p-3 font-bold">Status</th>
                <th className="p-3 font-bold">Topic</th>
                <th className="p-3 font-bold">Audience</th>
                <th className="p-3 font-bold">Author</th>
                <th className="p-3 font-bold">Views</th>
                <th className="p-3 font-bold">CTA</th>
                <th className="p-3 font-bold">Edited</th>
              </tr>
            </thead>
            <tbody>
              {items.map((p) => (
                <tr key={p.id} className="border-b border-gray-100 last:border-0 hover:bg-tm-bg">
                  <td className="max-w-[260px] p-3">
                    <Link href={`/admin/blog/${p.id}`} className="font-bold text-tm-navy hover:underline">
                      {p.title}
                    </Link>
                    <span className="block truncate text-[10px] text-gray-500">/{p.slug}</span>
                  </td>
                  <td className="p-3">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${STATUS_STYLES[p.status]}`}>
                      {statusLabel(p.status)}
                    </span>
                  </td>
                  <td className="p-3 text-gray-600">{clusterLabel(p.cluster)}</td>
                  <td className="p-3 capitalize text-gray-600">{p.audience}</td>
                  <td className="p-3 text-gray-600">{p.authorName ?? '—'}</td>
                  <td className="p-3">
                    <span className="inline-flex items-center gap-1 text-gray-600">
                      <Eye aria-hidden size={12} /> {p.views}
                    </span>
                  </td>
                  <td className="p-3">
                    <span className="inline-flex items-center gap-1 text-gray-600">
                      <MousePointerClick aria-hidden size={12} /> {p.ctaClicks}
                    </span>
                  </td>
                  <td className="p-3 text-gray-500">
                    <TimeAgo iso={p.updatedAt} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {cursor && (
        <div className="flex justify-center">
          <button
            type="button"
            onClick={() => void fetchPage(false)}
            disabled={loading}
            className="inline-flex min-h-[44px] items-center rounded-xl border border-gray-200 bg-white px-5 text-xs font-bold text-tm-navy disabled:opacity-60"
          >
            {loading ? 'Loading…' : 'Load more'}
          </button>
        </div>
      )}
    </div>
  )
}
