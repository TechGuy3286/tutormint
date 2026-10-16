// lib/batchRunCore.ts — PURE. Large admin approvals run in small batches
// (owner, 16 Oct 2026): each batch is its own short request, a failed batch
// never stops the others, and the caller learns exactly what finished and what
// did not. Used by Admin → Locations; tested in scripts/test-indexing-locations.ts.

export function chunk<T>(items: T[], size: number): T[][] {
  const n = Math.max(1, Math.floor(size))
  const out: T[][] = []
  for (let i = 0; i < items.length; i += n) out.push(items.slice(i, i + n))
  return out
}

export type BatchOutcome<T> = { done: T[]; failed: { item: T; error: string }[] }

/**
 * Send `items` in batches of `size`, one batch after another. `send` returns,
 * per batch, which items saved (true) and which did not (an error string). A
 * batch that throws marks all of its items failed with that error and the run
 * carries on. `onProgress(doneCount, total)` is called after every batch.
 */
export async function runBatches<T>(
  items: T[],
  size: number,
  send: (batch: T[]) => Promise<(true | string)[]>,
  onProgress?: (finished: number, total: number) => void,
): Promise<BatchOutcome<T>> {
  const out: BatchOutcome<T> = { done: [], failed: [] }
  let finished = 0
  for (const batch of chunk(items, size)) {
    try {
      const res = await send(batch)
      batch.forEach((item, i) => {
        const r = res[i]
        if (r === true) out.done.push(item)
        else out.failed.push({ item, error: typeof r === 'string' && r ? r : 'Not saved.' })
      })
    } catch (e) {
      const error = e instanceof Error ? e.message : 'That batch did not go through.'
      for (const item of batch) out.failed.push({ item, error })
    }
    finished += batch.length
    onProgress?.(finished, items.length)
  }
  return out
}
