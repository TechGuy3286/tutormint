// scripts/fakeSupabase.ts — a tiny in-memory stand-in for the Supabase query
// builder, enough for unit tests of server code that takes an injected client
// (from().select/eq/in/order/limit/maybeSingle, insert, update, upsert, delete).
// Never touches a real database.

type Row = Record<string, unknown>
type Result = { data: unknown; error: null | { message: string } }

export function fakeSupabase(seed: Record<string, Row[]> = {}) {
  const tables: Record<string, Row[]> = {}
  for (const [k, v] of Object.entries(seed)) tables[k] = v.map((r) => ({ ...r }))
  let seq = 0

  function builder(table: string) {
    const rows = () => (tables[table] ??= [])
    const filters: ((r: Row) => boolean)[] = []
    let op: 'select' | 'insert' | 'update' | 'upsert' | 'delete' = 'select'
    let payload: Row | Row[] | null = null
    let conflict = 'id'
    let single = false
    let order: { col: string; asc: boolean } | null = null
    let limit: number | null = null

    const run = (): Result => {
      const match = () => rows().filter((r) => filters.every((f) => f(r)))
      if (op === 'select') {
        let out = match()
        if (order) {
          const { col, asc } = order
          out = [...out].sort((a, b) => (String(a[col]) < String(b[col]) ? -1 : 1) * (asc ? 1 : -1))
        }
        if (limit != null) out = out.slice(0, limit)
        return { data: single ? (out[0] ?? null) : out.map((r) => ({ ...r })), error: null }
      }
      if (op === 'insert') {
        const list = Array.isArray(payload) ? payload : [payload as Row]
        for (const r of list) rows().push({ id: r.id ?? `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`, ...r })
        return { data: null, error: null }
      }
      if (op === 'upsert') {
        const list = Array.isArray(payload) ? payload : [payload as Row]
        for (const r of list) {
          const i = rows().findIndex((x) => x[conflict] === r[conflict])
          if (i >= 0) rows()[i] = { ...rows()[i], ...r }
          else rows().push({ ...r })
        }
        return { data: null, error: null }
      }
      if (op === 'update') {
        for (const r of match()) Object.assign(r, payload)
        return { data: null, error: null }
      }
      tables[table] = rows().filter((r) => !filters.every((f) => f(r)))
      return { data: null, error: null }
    }

    const b = {
      select: (_cols?: string) => b,
      eq: (col: string, v: unknown) => (filters.push((r) => r[col] === v), b),
      in: (col: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[col])), b),
      order: (col: string, o?: { ascending?: boolean }) => ((order = { col, asc: o?.ascending !== false }), b),
      limit: (n: number) => ((limit = n), b),
      maybeSingle: () => ((single = true), Promise.resolve(run())),
      single: () => ((single = true), Promise.resolve(run())),
      insert: (p: Row | Row[]) => ((op = 'insert'), (payload = p), b),
      update: (p: Row) => ((op = 'update'), (payload = p), b),
      upsert: (p: Row | Row[], o?: { onConflict?: string }) => ((op = 'upsert'), (payload = p), (conflict = o?.onConflict ?? 'id'), b),
      delete: () => ((op = 'delete'), b),
      then: (res: (r: Result) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(run()).then(res, rej),
    }
    return b
  }

  return { client: { from: builder } as never, tables }
}
