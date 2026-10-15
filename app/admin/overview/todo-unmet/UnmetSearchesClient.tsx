'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Check, Copy, Megaphone, School } from 'lucide-react'

import { adminFetch } from '@/components/admin/adminFetch'
import { useAdminReadOnly } from '@/components/admin/ReadOnly'
import ThreeWayReview from '@/components/admin/ThreeWayReview'
import { useToast } from '@/components/ui/Toast'
import { formatDateTime } from '@/lib/datetime'
import { filterTargets, hiringPost, whatsappShareLink, type DoneRow, type UnmetCard, type WordTarget } from '@/lib/unmetSearchCore'

// The cards of Overview → Unmet searches (owner, 11 Oct 2026). Each To review
// card can: add the searched text as a Search word (then the search is run again
// and the card says what it finds now), open a ready-to-copy hiring post for its
// city, or be marked done with an optional note. The Partner sees the cards with
// no buttons; the server refuses their writes anyway.

const INPUT = 'min-h-[44px] w-full rounded-xl border border-gray-200 bg-white px-3 text-sm text-slate-800 focus:border-tm-navy focus:outline-none'
const BUTTON = 'inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl bg-tm-navy px-4 text-xs font-bold text-white hover:bg-tm-navy-hover disabled:opacity-60'
const GHOST = 'inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border border-gray-200 bg-white px-4 text-xs font-bold text-slate-700 hover:border-tm-navy disabled:opacity-60'
const LABEL = 'block text-[11px] font-bold text-gray-600'
const KIND_LABEL: Record<WordTarget['kind'], string> = { subject: 'Subject', school: 'School', level: 'Level', city: 'City' }

type Panel = 'word' | 'post' | 'done'
type Found = { tutors: number; tuitions: number }

const resultsWord = (n: number) => `${n} result${n === 1 ? '' : 's'}`

export default function UnmetSearchesClient({
  tab,
  cards,
  done,
  targets,
  template,
  levels = [],
  canAddSubject = false,
  joinLink = null,
}: {
  /** The viewer's own join link, filled into {join_link} (owner, 15 Oct 2026). */
  joinLink?: string | null
  tab: 'review' | 'done'
  cards: UnmetCard[]
  done: DoneRow[]
  targets: WordTarget[]
  template: string
  /** Levels a new subject can be added under. */
  levels?: { slug: string; name: string }[]
  canAddSubject?: boolean
}) {
  const router = useRouter()
  const toast = useToast()
  const readOnly = useAdminReadOnly()
  const [open, setOpen] = useState<{ key: string; panel: Panel } | null>(null)
  const [busy, setBusy] = useState(false)
  const [word, setWord] = useState('')
  const [find, setFind] = useState('')
  const [pick, setPick] = useState<WordTarget | null>(null)
  const [note, setNote] = useState('')
  const [post, setPost] = useState('')
  const [found, setFound] = useState<Record<string, Found & { word: string; target: string }>>({})

  const options = useMemo(() => filterTargets(targets, find, 24), [targets, find])

  const show = (c: UnmetCard, panel: Panel) => {
    setOpen({ key: c.key, panel })
    setWord(c.key.slice(0, 40))
    setFind('')
    setPick(null)
    setNote('')
    setPost(c.city ? hiringPost(template, c.city, joinLink) : '')
  }

  const addWord = async (c: UnmetCard) => {
    if (!pick) {
      toast.error('Choose what this word means from the list first.')
      return
    }
    setBusy(true)
    const { ok, data } = await adminFetch<{ error?: string; word?: string; target?: string; now?: Found }>('/api/admin/unmet-searches/search-word', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: c.query, word, kind: pick.kind, slug: pick.slug }),
    })
    setBusy(false)
    if (!ok || !data?.now) {
      toast.error(data?.error ?? 'That did not save. Please try again.')
      return
    }
    setFound((f) => ({ ...f, [c.key]: { ...data.now!, word: data.word ?? word, target: data.target ?? pick.name } }))
    setOpen(null)
    toast.success(`Search word added. Now finds ${resultsWord(data.now.tutors + data.now.tuitions)}.`)
  }

  // The three review actions (owner, 13 Oct 2026), shared with Locations.
  const [subjectLevel, setSubjectLevel] = useState('')
  const reviewOptions = useMemo(() => targets.map((t) => ({ id: `${t.kind}|${t.slug}`, label: t.name, hint: KIND_LABEL[t.kind] })), [targets])

  const addSynonym = async (c: UnmetCard, optionId: string) => {
    const cut = optionId.indexOf('|')
    const kind = optionId.slice(0, cut)
    const slug = optionId.slice(cut + 1)
    const target = targets.find((t) => t.kind === kind && t.slug === slug)
    setBusy(true)
    const { ok, data } = await adminFetch<{ error?: string; word?: string; target?: string; now?: Found }>('/api/admin/unmet-searches/search-word', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: c.query, word: c.key.slice(0, 40), kind, slug }),
    })
    setBusy(false)
    if (!ok || !data?.now) {
      toast.error(data?.error ?? 'That did not save. Please try again.')
      return
    }
    setFound((f) => ({ ...f, [c.key]: { ...data.now!, word: data.word ?? c.key, target: data.target ?? target?.name ?? '' } }))
    toast.success(`Synonym added. Now finds ${resultsWord(data.now.tutors + data.now.tuitions)}.`)
  }

  const addSubject = async (c: UnmetCard, name: string) => {
    setBusy(true)
    const { ok, data } = await adminFetch<{ error?: string; subject?: string; level?: string }>('/api/admin/unmet-searches/subject', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: c.query, name, levelSlug: subjectLevel }),
    })
    setBusy(false)
    if (!ok) {
      toast.error(data?.error ?? 'That did not save. Please try again.')
      return
    }
    toast.success(`${data?.subject ?? name} added at ${data?.level ?? 'that level'}.`)
    router.refresh()
  }

  const ignore = async (c: UnmetCard) => {
    setBusy(true)
    const { ok, data } = await adminFetch<{ error?: string }>('/api/admin/unmet-searches/done', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: c.query, note: null, kind: 'ignored' }),
    })
    setBusy(false)
    if (!ok) {
      toast.error(data?.error ?? 'That did not save. Please try again.')
      return
    }
    toast.success('Ignored. It is hidden from this list, not deleted.')
    router.refresh()
  }

  // "Link to school" (owner, 13 Oct 2026): the text is a school's name, so it
  // is never added as a subject. The card leaves To review, linked to the school.
  const linkSchool = async (c: UnmetCard) => {
    setBusy(true)
    const { ok, data } = await adminFetch<{ error?: string; school?: string }>('/api/admin/unmet-searches/done', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: c.query, note: null, kind: 'school' }),
    })
    setBusy(false)
    if (!ok) {
      toast.error(data?.error ?? 'That did not save. Please try again.')
      return
    }
    toast.success(`Linked to ${data?.school ?? 'the school'}.`)
    router.refresh()
  }

  const markDone = async (c: UnmetCard) => {
    setBusy(true)
    const { ok, data } = await adminFetch<{ error?: string }>('/api/admin/unmet-searches/done', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: c.query, note: note || null }),
    })
    setBusy(false)
    if (!ok) {
      toast.error(data?.error ?? 'That did not save. Please try again.')
      return
    }
    setOpen(null)
    toast.success('Marked done.')
    router.refresh()
  }

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      toast.success('Copied.')
    } catch {
      toast.error('Copying did not work. Select the text and copy it by hand.')
    }
  }

  if (tab === 'done') {
    return done.length === 0 ? (
      <p className="rounded-2xl border border-gray-200 bg-white p-4 text-xs text-gray-600">Nothing has been marked done in the last 30 days.</p>
    ) : (
      <ul className="grid gap-2 sm:grid-cols-2">
        {done.map((d) => (
          <li key={d.id} className="space-y-1 rounded-2xl border border-gray-200 bg-white p-3">
            <p className="break-words text-sm font-black text-tm-navy">&ldquo;{d.query}&rdquo;</p>
            <p className="text-[11px] text-slate-700">
              {d.searches} search{d.searches === 1 ? '' : 'es'} · done by {d.done_by_name ?? d.done_by_email ?? 'staff'} · {formatDateTime(d.done_at)}
            </p>
            {d.note && <p className="break-words text-[11px] text-gray-600">Note: {d.note}</p>}
          </li>
        ))}
      </ul>
    )
  }

  if (cards.length === 0) {
    return <p className="rounded-2xl border border-gray-200 bg-white p-4 text-xs text-gray-600">No unmet searches to review. Every search in the last 7 days found something, or has been marked done.</p>
  }

  return (
    <ul className="grid gap-2 sm:grid-cols-2">
      {cards.map((c) => {
        const isOpen = open?.key === c.key
        const got = found[c.key]
        const browse = `/browse/${c.surfaces.includes('tuitions') && !c.surfaces.includes('tutors') ? 'tuitions' : 'tutors'}?q=${encodeURIComponent(c.query)}`
        return (
          <li key={c.key} className="space-y-2 rounded-2xl border border-gray-200 bg-white p-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="min-w-0 break-words text-sm font-black text-tm-navy">&ldquo;{c.query}&rdquo;</p>
              <span className="flex flex-wrap items-center gap-1.5">
                {c.schoolMatch && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-tm-tint-green px-2 py-0.5 text-[11px] font-bold text-tm-green-deep">
                    <School aria-hidden size={12} /> School
                  </span>
                )}
                <span className="inline-flex items-center rounded-full bg-tm-tint-navy px-2 py-0.5 text-[11px] font-bold text-tm-navy">
                  {c.count} time{c.count === 1 ? '' : 's'}
                </span>
              </span>
            </div>
            {c.schoolMatch && (
              <p className="break-words text-[11px] text-slate-700">
                This is a school&rsquo;s name: {c.schoolMatch.name}.{' '}
                {c.schoolMatch.href ? (
                  <Link href={c.schoolMatch.href} target="_blank" rel="noopener noreferrer" className="font-bold text-tm-red underline">
                    Open the school&rsquo;s page
                  </Link>
                ) : (
                  'No open post names it yet, so it has no page.'
                )}
              </p>
            )}
            <p className="break-words text-[11px] text-slate-700">
              {[c.city ? `City ${c.city}` : null, c.level ? `Level ${c.level}` : null, c.subject ? `Subject ${c.subject}` : null, c.school ? `School ${c.school}` : null]
                .filter(Boolean)
                .join(' · ') || 'Nothing in this search was understood'}
            </p>
            <p className="text-[11px] text-gray-600">
              {c.surfaces.join(' + ')} · {c.roles.join(', ')} · last {formatDateTime(c.last)} ·{' '}
              <Link href={browse} target="_blank" rel="noopener noreferrer" className="font-bold text-tm-red underline">
                Open the search
              </Link>
            </p>
            {got && (
              <p className="rounded-xl bg-tm-tint-green p-2 text-[11px] font-bold text-tm-green-deep" role="status">
                &ldquo;{got.word}&rdquo; now means {got.target}. Now finds {resultsWord(got.tutors + got.tuitions)} ({got.tutors} tutor{got.tutors === 1 ? '' : 's'}, {got.tuitions} tuition
                {got.tuitions === 1 ? '' : 's'}).
              </p>
            )}

            {!readOnly && !isOpen && (
              <ThreeWayReview
                labels={{ add: 'Add as new subject', same: 'Add as synonym of…', ignore: 'Ignore', nameLabel: 'Subject name', findPlaceholder: 'Find a subject, school, level or city' }}
                options={reviewOptions}
                suggested={{ action: 'same', name: c.query.slice(0, 60) }}
                busy={busy}
                addReady={!!subjectLevel}
                addExtra={
                  <label className="block space-y-1">
                    <span className={LABEL}>Level it is taught at</span>
                    <select value={subjectLevel} onChange={(e) => setSubjectLevel(e.target.value)} className={INPUT}>
                      <option value="">Choose a level</option>
                      {levels.map((l) => (
                        <option key={l.slug} value={l.slug}>
                          {l.name}
                        </option>
                      ))}
                    </select>
                  </label>
                }
                // A school is never added as a subject.
                onAdd={canAddSubject && !c.schoolMatch ? (name) => void addSubject(c, name) : undefined}
                onSame={(id) => void addSynonym(c, id)}
                onIgnore={() => void ignore(c)}
              />
            )}

            {!readOnly && !isOpen && (
              <div className="flex flex-wrap gap-2">
                {c.schoolMatch && (
                  <button type="button" disabled={busy} onClick={() => void linkSchool(c)} className={BUTTON}>
                    <School aria-hidden size={14} /> Link to school
                  </button>
                )}
                {c.city && (
                  <button type="button" onClick={() => show(c, 'post')} className={GHOST}>
                    <Megaphone aria-hidden size={14} /> Hiring post for {c.city}
                  </button>
                )}
                <button type="button" onClick={() => show(c, 'done')} className={GHOST}>
                  <Check aria-hidden size={14} /> Mark done
                </button>
              </div>
            )}

            {!readOnly && isOpen && open!.panel === 'word' && (
              <div className="space-y-2 rounded-xl border border-gray-100 bg-tm-bg p-3">
                <label className="block">
                  <span className={LABEL}>Search word</span>
                  <input value={word} onChange={(e) => setWord(e.target.value)} maxLength={40} className={INPUT} />
                </label>
                <label className="block">
                  <span className={LABEL}>It means (subject, school, level or city)</span>
                  <input value={find} onChange={(e) => setFind(e.target.value)} placeholder="Type to find" className={INPUT} />
                </label>
                <ul className="max-h-48 space-y-1 overflow-y-auto" role="listbox" aria-label="What the word means">
                  {options.map((t) => {
                    const on = pick?.kind === t.kind && pick.slug === t.slug
                    return (
                      <li key={`${t.kind}-${t.slug}`}>
                        <button
                          type="button"
                          role="option"
                          aria-selected={on}
                          onClick={() => setPick(t)}
                          className={`flex min-h-[44px] w-full items-center justify-between gap-2 rounded-xl border px-3 text-left text-xs font-bold ${
                            on ? 'border-tm-navy bg-tm-navy text-white' : 'border-gray-200 bg-white text-slate-700 hover:border-tm-navy'
                          }`}
                        >
                          <span className="min-w-0 break-words">{t.name}</span>
                          <span className={on ? 'text-white' : 'text-gray-600'}>{KIND_LABEL[t.kind]}</span>
                        </button>
                      </li>
                    )
                  })}
                  {options.length === 0 && <li className="text-[11px] text-gray-600">Nothing matches. Try another spelling.</li>}
                </ul>
                <div className="flex flex-wrap gap-2">
                  <button type="button" disabled={busy} onClick={() => void addWord(c)} className={BUTTON}>
                    {busy ? 'Saving…' : 'Save search word'}
                  </button>
                  <button type="button" onClick={() => setOpen(null)} className={GHOST}>
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {!readOnly && isOpen && open!.panel === 'post' && c.city && (
              <div className="space-y-2 rounded-xl border border-gray-100 bg-tm-bg p-3">
                <label className="block">
                  <span className={LABEL}>Hiring post for {c.city} (Facebook and WhatsApp groups)</span>
                  <textarea value={post} onChange={(e) => setPost(e.target.value)} rows={5} className={`${INPUT} py-2`} />
                </label>
                <p className="text-[11px] text-gray-600">The wording is the &ldquo;Hiring post for a city&rdquo; template in Team inbox → Templates.</p>
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => void copy(post)} className={BUTTON}>
                    <Copy aria-hidden size={14} /> Copy
                  </button>
                  <a href={whatsappShareLink(post)} target="_blank" rel="noopener noreferrer" className={GHOST}>
                    Share on WhatsApp
                  </a>
                  <button type="button" onClick={() => setOpen(null)} className={GHOST}>
                    Close
                  </button>
                </div>
              </div>
            )}

            {!readOnly && isOpen && open!.panel === 'done' && (
              <div className="space-y-2 rounded-xl border border-gray-100 bg-tm-bg p-3">
                <label className="block">
                  <span className={LABEL}>Note (optional)</span>
                  <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} className={INPUT} />
                </label>
                <div className="flex flex-wrap gap-2">
                  <button type="button" disabled={busy} onClick={() => void markDone(c)} className={BUTTON}>
                    {busy ? 'Saving…' : 'Mark done'}
                  </button>
                  <button type="button" onClick={() => setOpen(null)} className={GHOST}>
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </li>
        )
      })}
    </ul>
  )
}
