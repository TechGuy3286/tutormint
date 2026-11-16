// lib/peopleCountsCheckCore.ts — PURE (owner, 16 Nov 2026 — PR-02).
//
// The People → Tutors self-check. Given the stored People rows (their tags and
// card), the chip counts the page shows (admin_list_page) and the number of
// cards each chip's list returns, it checks that:
//   - every real tutor is in exactly one stage, and the stages add up to All;
//   - in each followed-up stage, every tutor is in exactly one follow-up chip,
//     and Not followed up + 1st + 2nd + 3rd+ add up to the stage;
//   - Tried to pay ⊆ Not followed up (due now);
//   - each chip's count equals the number of cards its list returns;
//   - the badge's follow-up part and the Overview to-do rows equal their chips.
// Used by scripts/test-people-counts.ts (invented data) and the read-only
// production script scripts/report-people-counts-check.ts. Counts only.

import { FOLLOW_STAGES, FU_BUCKETS, FU_TRIED, PIPE_STAGES } from '@/lib/tutorPipelineCore'
import { feePendingDue, type PipeCard } from '@/lib/tutorPipelineCardCore'
import { cardRejectedUninformed } from '@/lib/pipelineRowUpdateCore'

export type CheckRow = { tags: Record<string, unknown>; card: PipeCard | null }

/** A real tutor shown in the chips: not staff/test/deleted, not Not interested. */
export function inChips(r: CheckRow): boolean {
  return r.tags.excluded === false && r.tags.ni !== true
}

const arr = (v: unknown): string[] => (Array.isArray(v) ? (v as unknown[]).map(String) : [])

export type ChipCounts = {
  all: number
  stage: Record<string, number>
  /** Per followed-up stage: not / f1 / f2 / f3 / tried. */
  fu: Record<string, Record<string, number>>
  reuploaded: number
}

/** The chip counts worked out from the stored rows (what SQL should return). */
export function countsFromRows(rows: CheckRow[]): ChipCounts {
  const live = rows.filter(inChips)
  const out: ChipCounts = { all: live.length, stage: {}, fu: {}, reuploaded: 0 }
  for (const s of PIPE_STAGES) out.stage[s] = 0
  for (const s of FOLLOW_STAGES) out.fu[s] = { not: 0, f1: 0, f2: 0, f3: 0, [FU_TRIED]: 0 }
  for (const r of live) {
    const stages = arr(r.tags.stages)
    for (const s of PIPE_STAGES) if (stages.includes(s)) out.stage[s]++
    if (stages.includes('reuploaded')) out.reuploaded++
    const st = stages.find((s) => (FOLLOW_STAGES as readonly string[]).includes(s))
    if (!st) continue
    const fus = arr(r.tags.fus)
    for (const k of [...FU_BUCKETS, FU_TRIED]) if (fus.includes(k)) out.fu[st][k]++
  }
  return out
}

export type Mismatch = { check: string; expected: number; got: number }

/** The structural checks over the stored rows. */
export function structuralMismatches(rows: CheckRow[]): Mismatch[] {
  const out: Mismatch[] = []
  const live = rows.filter(inChips)
  const c = countsFromRows(rows)
  // Exactly one stage each.
  const wrongStage = live.filter((r) => arr(r.tags.stages).filter((s) => (PIPE_STAGES as readonly string[]).includes(s)).length !== 1).length
  if (wrongStage) out.push({ check: 'tutors not in exactly one stage', expected: 0, got: wrongStage })
  const sumStages = PIPE_STAGES.reduce((n, s) => n + c.stage[s], 0)
  if (sumStages !== c.all) out.push({ check: 'stages add up to All', expected: c.all, got: sumStages })
  for (const st of FOLLOW_STAGES) {
    const inStage = live.filter((r) => arr(r.tags.stages).includes(st))
    const wrongFu = inStage.filter((r) => arr(r.tags.fus).filter((f) => (FU_BUCKETS as readonly string[]).includes(f)).length !== 1).length
    if (wrongFu) out.push({ check: `${st}: tutors not in exactly one follow-up chip`, expected: 0, got: wrongFu })
    const sumFu = FU_BUCKETS.reduce((n, b) => n + c.fu[st][b], 0)
    if (sumFu !== c.stage[st]) out.push({ check: `${st}: follow-up chips add up to the stage`, expected: c.stage[st], got: sumFu })
    const triedNotDue = inStage.filter((r) => arr(r.tags.fus).includes(FU_TRIED) && !arr(r.tags.fus).includes('not')).length
    if (triedNotDue) out.push({ check: `${st}: Tried to pay outside Not followed up`, expected: 0, got: triedNotDue })
  }
  // The card and its tags agree (a stale row would not).
  const cardTagDiff = live.filter((r) => r.card && !arr(r.tags.stages).includes(r.card.stage)).length
  if (cardTagDiff) out.push({ check: 'card stage differs from its tag', expected: 0, got: cardTagDiff })
  return out
}

/** The badge's follow-up part / Overview "Fee pending, not followed up": the
 *  Approved · Not followed up chip, worked out from the cards. */
export function feePendingFromRows(rows: CheckRow[]): number {
  return rows.filter((r) => inChips(r) && !!r.card && feePendingDue(r.card)).length
}

/** Overview "Rejected, not informed", from the cards. */
export function rejectedUninformedFromRows(rows: CheckRow[]): number {
  return rows.filter((r) => inChips(r) && !!r.card && cardRejectedUninformed(r.card)).length
}

/** Compare named numbers: every pair that differs. */
export function compare(pairs: [check: string, expected: number, got: number | null | undefined][]): Mismatch[] {
  return pairs.filter(([, e, g]) => (g ?? NaN) !== e).map(([check, expected, got]) => ({ check, expected, got: got ?? NaN }))
}
