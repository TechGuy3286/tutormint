// lib/masterSubjectCheck.ts
//
// A tutor's subjects are master-list ids only (owner, 17 Oct 2026). Every route
// that replaces a tutor's subject set calls this before it deletes anything, so
// an id that is not a taxonomy_master row is refused with a plain message
// instead of half-replacing the set or failing on the foreign key.

import { notMasterSubjects } from '@/lib/subjectDisplay'

type Client = {
  from: (t: string) => {
    select: (c: string) => { in: (col: string, v: number[]) => PromiseLike<{ data: unknown; error: unknown }> }
  }
}

/** The ids that are not on the master list ([] when every id is). */
export async function unknownMasterIds(client: unknown, ids: number[]): Promise<number[]> {
  if (ids.length === 0) return []
  const db = client as Client
  const { data, error } = await db.from('taxonomy_master').select('id').in('id', ids)
  // A failed lookup refuses nothing here; the insert's foreign key still guards.
  if (error) return []
  const found = ((data as { id: number }[] | null) ?? []).map((r) => r.id)
  return notMasterSubjects(ids, found)
}
