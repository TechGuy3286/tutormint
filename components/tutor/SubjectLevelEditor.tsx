'use client'

import { Loader2, Plus, Search, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import { fetchTaxonomyTree, fetchNonLegacyMasters, type TaxonomyNode, type SubjectMaster } from '@/lib/taxonomy'
import { deriveSelections, mergeSubjectSelections } from '@/lib/subjectMerge'
import { useConfirm } from '@/components/ui/ConfirmDialog'

// PR84 — the tutor Settings subject editor, level-first, matching onboarding's
// "subjects once per level" (SubjectsPerLevelStep): pick level(s), then the
// level's subjects (the union across its grades) as searchable chips.
//
// It NEVER changes the saved set on open: `existing` is the immutable saved set,
// the editor derives its initial selection from it, and the FINAL set is the
// merge (lib/subjectMerge) which preserves untouched (and partial-grade) rows.
// The parent saves the merged ids through the same /api/profile/save path.
//
//   • a newly picked subject → added for every grade in that level,
//   • an unpicked subject → removed from every grade,
//   • an untouched subject → its exact existing per-grade rows kept (partials
//     stay partial),
//   • a level the tutor didn't touch → kept exactly,
//   • removing a level (with confirmation, English + Urdu) → its rows removed.

export default function SubjectLevelEditor({
  existing,
  onChange,
}: {
  /** The tutor's saved master ids — IMMUTABLE; the merge is computed against it. */
  existing: number[]
  /** Called with the final merged master ids whenever the selection changes. */
  onChange: (finalIds: number[]) => void
}) {
  const confirm = useConfirm()
  const [tree, setTree] = useState<TaxonomyNode | null>(null)
  const [masters, setMasters] = useState<SubjectMaster[]>([])
  const [loading, setLoading] = useState(true)
  // The selection the merge reads: level (category) -> selected subject names.
  const [selByCat, setSelByCat] = useState<Record<string, string[]>>({})
  // The levels shown, in order. A removed level leaves selByCat (as []) so the
  // merge drops its rows, but disappears from here.
  const [visibleCats, setVisibleCats] = useState<string[]>([])
  const [adding, setAdding] = useState(false)
  const [q, setQ] = useState('')

  useEffect(() => {
    let live = true
    void (async () => {
      const [t, m] = await Promise.all([fetchTaxonomyTree(), fetchNonLegacyMasters()])
      if (!live) return
      const initial = deriveSelections(existing, m)
      setTree(t)
      setMasters(m)
      setSelByCat(initial)
      setVisibleCats(Object.keys(initial))
      setLoading(false)
    })()
    return () => {
      live = false
    }
    // `existing` is read once at mount; re-deriving on a change would clobber
    // the tutor's in-progress edits (and the parent never mutates it).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Recompute the final merged ids whenever the selection changes.
  useEffect(() => {
    if (loading) return
    onChange(mergeSubjectSelections(existing, masters, selByCat))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selByCat, loading])

  const availableCats = useMemo(
    () => (tree ? Object.keys(tree).filter((c) => !visibleCats.includes(c)) : []),
    [tree, visibleCats],
  )

  const query = q.trim().toLowerCase()
  const subjectsFor = (cat: string): string[] => {
    if (!tree || !tree[cat]) return []
    const union = Array.from(new Set(Object.keys(tree[cat]).flatMap((g) => tree[cat][g] ?? []))).sort()
    return query ? union.filter((s) => s.toLowerCase().includes(query)) : union
  }

  const toggle = (cat: string, sub: string) => {
    setSelByCat((prev) => {
      const cur = prev[cat] ?? []
      return { ...prev, [cat]: cur.includes(sub) ? cur.filter((x) => x !== sub) : [...cur, sub] }
    })
  }

  const addLevel = (cat: string) => {
    setSelByCat((prev) => ({ ...prev, [cat]: prev[cat] ?? [] }))
    setVisibleCats((prev) => (prev.includes(cat) ? prev : [...prev, cat]))
    setAdding(false)
  }

  const removeLevel = async (cat: string) => {
    const ok = await confirm({
      title: `Remove ${cat}?`,
      body: `Every subject you teach under ${cat} will be removed. اس لیول کے تمام مضامین ہٹا دیے جائیں گے۔`,
      confirmLabel: 'Remove level',
    })
    if (!ok) return
    // Keep the key as [] so the merge removes its rows; drop it from the view.
    setSelByCat((prev) => ({ ...prev, [cat]: [] }))
    setVisibleCats((prev) => prev.filter((c) => c !== cat))
  }

  if (loading) {
    return (
      <p className="flex items-center gap-2 text-xs text-gray-500">
        <Loader2 size={14} className="animate-spin" aria-hidden /> Loading subjects…
      </p>
    )
  }

  return (
    <div className="space-y-4">
      <p className="flex flex-col leading-tight">
        <span className="text-[11px] font-semibold text-tm-navy">Pick a level, then the subjects you teach in it.</span>
        <span lang="ur" dir="rtl" className="block text-[11px] text-gray-500">
          پہلے لیول منتخب کریں، پھر اس کے مضامین
        </span>
      </p>

      {/* Search across the shown levels' subjects (instant, no button). */}
      {visibleCats.length > 0 && (
        <div className="relative">
          <Search aria-hidden size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search a subject…"
            aria-label="Search subjects"
            className="min-h-[44px] w-full rounded-xl border border-gray-200 bg-tm-bg pl-9 pr-3 text-xs font-medium outline-none focus:border-tm-navy"
          />
        </div>
      )}

      {visibleCats.map((cat) => {
        const subs = subjectsFor(cat)
        const sel = new Set(selByCat[cat] ?? [])
        return (
          <div key={cat} className="space-y-2 rounded-xl border border-gray-200 p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[11px] font-black text-tm-navy">{cat}</p>
              <button
                type="button"
                onClick={() => void removeLevel(cat)}
                className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-bold text-tm-red hover:bg-tm-tint-red"
              >
                <X aria-hidden size={12} /> Remove level
              </button>
            </div>
            {subs.length === 0 ? (
              <p className="text-[11px] text-gray-500">
                {query ? `No subjects match “${q}” here.` : 'No subjects for this level.'}
              </p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {subs.map((sub) => {
                  const on = sel.has(sub)
                  return (
                    <button
                      key={sub}
                      type="button"
                      onClick={() => toggle(cat, sub)}
                      aria-pressed={on}
                      className={`inline-flex min-h-[40px] items-center rounded-xl border px-3 text-[11px] font-bold transition-colors ${
                        on
                          ? 'border-tm-green-deep/30 bg-tm-tint-green text-tm-green-deep'
                          : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                      }`}
                    >
                      {sub}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}

      {/* Add a level. */}
      {availableCats.length > 0 &&
        (adding ? (
          <div className="space-y-2 rounded-xl border border-dashed border-gray-300 p-3">
            <p className="text-[11px] font-bold text-gray-500">Which level do you teach?</p>
            <div className="flex flex-wrap gap-1.5">
              {availableCats.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => addLevel(cat)}
                  className="inline-flex min-h-[40px] items-center rounded-xl border border-gray-200 bg-white px-3 text-[11px] font-bold text-gray-700 hover:bg-gray-50"
                >
                  {cat}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setAdding(false)}
              className="text-[11px] font-bold text-gray-500 hover:text-tm-navy"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-4 text-xs font-bold text-tm-navy hover:border-tm-navy"
          >
            <Plus aria-hidden size={14} /> Add a level
          </button>
        ))}
    </div>
  )
}
