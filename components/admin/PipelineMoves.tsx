'use client'

// The People card moves at once (owner, 15 Nov 2026). Staff logged a
// follow-up and the card sat in "Not followed up" until the summary caught up,
// so they contacted the same tutor twice. The server now rewrites that row in
// the same request (lib/tutorPipeline updatePipelineRow); this provider moves
// the card on screen straight away:
//
//   - begin(): the card is hidden from the current chip as soon as the save is
//     sent, when the action is expected to move it (a follow-up in a follow-up
//     chip, "Not interested");
//   - done(): the route sends back the card before and after — the chip counts
//     shift by the difference, and the card comes back only if it still
//     belongs in this chip;
//   - fail(): the card returns (the caller shows the error).
//
// When the page's server data arrives (router.refresh) the local shifts are
// dropped — the server counts are already right. Outside People (the member
// page) the hook is a no-op.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

import { cardInView, chipCountShift, shiftCounts, type ChipView } from '@/lib/pipelineRowUpdateCore'
import type { PipeCard } from '@/lib/tutorPipelineCardCore'

export type Moved = { prev: PipeCard; next: PipeCard }

type Ctx = {
  view: ChipView
  /** The card leaves the chip now (pending); `leaves` = the action is expected to move it. */
  begin: (memberId: string, leaves: boolean) => void
  done: (memberId: string, moved: Moved | null | undefined) => void
  fail: (memberId: string) => void
  hidden: ReadonlySet<string>
  /** The chip row counts, shifted. */
  counts: (param: string, server: Record<string, number> | undefined) => Record<string, number>
  /** How many cards left the list on this page since the last server data. */
  gone: number
  /** The card as the server just saved it (PR-02): a card that stays in the
   *  view shows its new follow-up line at once, before the refresh arrives. */
  cardFor: (memberId: string, server: PipeCard) => PipeCard
}

const NOOP: Pick<Ctx, 'begin' | 'done' | 'fail'> & { view: ChipView | null } = {
  view: null,
  begin: () => {},
  done: () => {},
  fail: () => {},
}

const PipelineMovesContext = createContext<Ctx | null>(null)

export function PipelineMovesProvider({ view, version, children }: { view: ChipView; version: string; children: ReactNode }) {
  const [hidden, setHidden] = useState<Set<string>>(() => new Set())
  const [shift, setShift] = useState<{ stage: Record<string, number>; fu: Record<string, number> }>({ stage: {}, fu: {} })
  const [gone, setGone] = useState(0)
  const [cards, setCards] = useState<Map<string, PipeCard>>(() => new Map())
  const pending = useRef<Set<string>>(new Set())

  // Fresh server data: its counts and rows are already right — drop local work
  // except saves still in flight.
  useEffect(() => {
    setShift({ stage: {}, fu: {} })
    setGone(0)
    setCards(new Map())
    setHidden(new Set(pending.current))
  }, [version])

  const begin = useCallback((memberId: string, leaves: boolean) => {
    pending.current.add(memberId)
    if (leaves) setHidden((h) => new Set(h).add(memberId))
  }, [])

  const done = useCallback(
    (memberId: string, moved: Moved | null | undefined) => {
      pending.current.delete(memberId)
      if (!moved) {
        // No card back (not a People row yet): let the refresh place it.
        setHidden((h) => {
          const n = new Set(h)
          n.delete(memberId)
          return n
        })
        return
      }
      setCards((m) => new Map(m).set(memberId, moved.next))
      const stays = cardInView(moved.next, view)
      const wasIn = cardInView(moved.prev, view)
      setHidden((h) => {
        const n = new Set(h)
        if (stays) n.delete(memberId)
        else n.add(memberId)
        return n
      })
      if (wasIn && !stays) setGone((g) => g + 1)
      if (!wasIn && stays) setGone((g) => g - 1)
      const s = chipCountShift(moved.prev, moved.next, view)
      setShift((cur) => ({ stage: shiftCounts(cur.stage, s.stage), fu: shiftCounts(cur.fu, s.fu) }))
    },
    [view],
  )

  const fail = useCallback((memberId: string) => {
    pending.current.delete(memberId)
    setHidden((h) => {
      const n = new Set(h)
      n.delete(memberId)
      return n
    })
  }, [])

  const counts = useCallback(
    (param: string, server: Record<string, number> | undefined) => {
      const add = param === 'stage' ? shift.stage : param === 'fu' ? shift.fu : null
      if (!add) return server ?? {}
      const out = { ...(server ?? {}) }
      for (const [k, n] of Object.entries(add)) out[k] = Math.max(0, (out[k] ?? 0) + n)
      return out
    },
    [shift],
  )

  const cardFor = useCallback((memberId: string, server: PipeCard) => cards.get(memberId) ?? server, [cards])

  const value = useMemo<Ctx>(() => ({ view, begin, done, fail, hidden, counts, gone, cardFor }), [view, begin, done, fail, hidden, counts, gone, cardFor])
  return <PipelineMovesContext.Provider value={value}>{children}</PipelineMovesContext.Provider>
}

/** For a grid: what is hidden and the shifted counts (null outside People). */
export function usePipelineGrid(): Ctx | null {
  return useContext(PipelineMovesContext)
}

/** For an action button: begin / done / fail, and whether the action moves the card out of this chip. */
export function usePipelineMove(): Pick<Ctx, 'begin' | 'done' | 'fail'> & { view: ChipView | null } {
  return useContext(PipelineMovesContext) ?? NOOP
}

/** Expected to leave the view: a follow-up while a follow-up chip is chosen. */
export function followUpLeaves(view: ChipView | null): boolean {
  return !!view?.fu
}

/** Expected to leave the view: "Not interested" (or its Undo) on a list that shows one side only. */
export function notInterestedLeaves(view: ChipView | null): boolean {
  return view?.ni !== undefined && view !== null
}

/** The server's cards without the ones that just moved out of this chip (the
 *  ONLY thing the server-paged grid takes away itself — owner, 15 Nov 2026). */
export function withoutMoved<T extends { memberId?: string | null }>(items: T[], moves: Ctx | null): T[] {
  if (!moves || moves.hidden.size === 0) return items
  return items.filter((x) => !(x.memberId && moves.hidden.has(x.memberId)))
}
