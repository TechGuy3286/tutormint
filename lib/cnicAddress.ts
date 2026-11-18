// lib/cnicAddress.ts — the server half of the CNIC address reader (owner,
// 18 Nov 2026 — PR-07). Rules and flow: lib/cnicAddressCore.
//
// PRIVACY AND COST, in one place:
//   - only the CNIC BACK image is sent to the Claude API — no name, no id;
//   - the address is never logged (log lines and the backfill report carry
//     counts and outcome words only);
//   - one uploaded image is read at most once (user_documents.address_read_at);
//   - the reading is stored ONLY in address_suggestions (service role). This
//     file writes profiles.address only through a member's own Confirm/Edit,
//     with the member's own session client (memberSaveAddress).
//   - nothing is read when the member already has an address.

import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import { completeWithImage } from '@/lib/ai/anthropic'
import { docImageForVision } from '@/lib/cnicReader'
import { resolveCity } from '@/lib/pkCitiesCore'
import { PK_CITIES } from '@/lib/pkCityData'
import { pageAll } from '@/lib/pageAll'
import {
  ADDRESS_READ_PROMPT,
  ADDRESS_READ_SYSTEM,
  memberSuggestion,
  runAddressRead,
  staffAddress,
  suggestionDecision,
  type AddressReadResult,
  type AddressSuggestion,
  type StaffAddress,
  type SuggestionStatus,
} from '@/lib/cnicAddressCore'

type Admin = NonNullable<ReturnType<typeof createAdminClient>>

const cityOf = (typed: string) => resolveCity(PK_CITIES, typed)?.name ?? null

async function loadSuggestion(admin: Admin, memberId: string): Promise<AddressSuggestion | null> {
  const { data } = await admin.from('address_suggestions').select('address, city, status').eq('user_id', memberId).maybeSingle()
  return data ? { address: data.address as string, city: data.city as string, status: data.status as SuggestionStatus } : null
}

async function loadAddressFacts(admin: Admin, memberId: string): Promise<{ address: string | null; city: string | null; suggestion: AddressSuggestion | null }> {
  const [{ data: p }, suggestion] = await Promise.all([
    admin.from('profiles').select('address, city').eq('id', memberId).maybeSingle(),
    loadSuggestion(admin, memberId),
  ])
  return { address: (p?.address as string | null) ?? null, city: (p?.city as string | null) ?? null, suggestion }
}

/**
 * Read the address from one CNIC BACK document (once per image) and keep it as
 * the member's suggestion. Never throws; never logs the address.
 */
export async function readAddressFromDocument(documentId: string, source: 'upload' | 'backfill' = 'upload'): Promise<AddressReadResult> {
  const admin = createAdminClient()
  if (!admin) return { status: 'unavailable' }
  try {
    const { data: doc } = await admin
      .from('user_documents')
      .select('id, user_id, kind, label, status, original_path, rotation, address_read_at')
      .eq('id', documentId)
      .maybeSingle()
    if (!doc || doc.kind !== 'cnic' || doc.label !== 'back') return { status: 'unavailable' }
    if (doc.status === 'paused') return { status: 'skipped' }
    const memberId = doc.user_id as string
    const decide = async () => {
      const f = await loadAddressFacts(admin, memberId)
      return suggestionDecision({ currentAddress: f.address, existing: f.suggestion?.status ?? null })
    }
    return await runAddressRead({
      decision: decide,
      claim: async () => {
        // One statement: only an unread image is taken.
        const { data: claimed } = await admin
          .from('user_documents')
          .update({ address_read_at: new Date().toISOString() })
          .eq('id', documentId)
          .is('address_read_at', null)
          .select('id')
        return (claimed ?? []).length === 1
      },
      release: async () => {
        await admin.from('user_documents').update({ address_read_at: null }).eq('id', documentId)
      },
      loadImage: () => docImageForVision((doc.original_path as string | null) ?? null, (doc.rotation as number | null) ?? null),
      vision: (image) => completeWithImage({ system: ADDRESS_READ_SYSTEM, prompt: ADDRESS_READ_PROMPT, image, maxTokens: 200, timeoutMs: 25_000 }),
      resolveCity: cityOf,
      save: async (r) => {
        // Checked again at write time: the member may have typed an address
        // while the image was being read.
        if ((await decide()) !== 'save') return
        await admin
          .from('address_suggestions')
          .upsert(
            { user_id: memberId, document_id: documentId, address: r.address, city: r.city, status: 'unconfirmed', source, created_at: new Date().toISOString(), decided_at: null },
            { onConflict: 'user_id' },
          )
      },
    })
  } catch {
    return { status: 'unavailable' }
  }
}

// ------------------------------------------------------------ member side ---

/** What the member's own Home address box needs. */
export async function memberAddressState(memberId: string): Promise<{ address: string | null; suggestion: { address: string; city: string } | null }> {
  const admin = createAdminClient()
  if (!admin) return { address: null, suggestion: null }
  const f = await loadAddressFacts(admin, memberId)
  const s = memberSuggestion(f.address, f.suggestion)
  return { address: f.address, suggestion: s ? { address: s.address, city: s.city } : null }
}

/** The member's Confirm (or Edit) marks the suggestion decided. Service role,
 *  scoped to the member; called after profiles.address was saved. */
export async function markSuggestionDecided(memberId: string, status: 'confirmed' | 'edited'): Promise<void> {
  const admin = createAdminClient()
  if (!admin) return
  await admin
    .from('address_suggestions')
    .update({ status, decided_at: new Date().toISOString() })
    .eq('user_id', memberId)
    .eq('status', 'unconfirmed')
}

/** The pending suggestion, for Confirm. */
export async function pendingSuggestion(memberId: string): Promise<AddressSuggestion | null> {
  const admin = createAdminClient()
  if (!admin) return null
  const f = await loadAddressFacts(admin, memberId)
  return memberSuggestion(f.address, f.suggestion)
}

// ------------------------------------------------------------- staff side ---

/** The masked address and its label, for the admin member page. Never the address. */
export async function staffAddressFor(memberId: string): Promise<StaffAddress> {
  const admin = createAdminClient()
  if (!admin) return null
  const f = await loadAddressFacts(admin, memberId)
  return staffAddress(f.address, f.city, f.suggestion)
}

/** The full address for a logged Show (the route checks the role and writes the
 *  audit row BEFORE calling this). */
export async function addressForReveal(memberId: string): Promise<{ address: string | null; label: string | null }> {
  const admin = createAdminClient()
  if (!admin) return { address: null, label: null }
  const f = await loadAddressFacts(admin, memberId)
  const s = staffAddress(f.address, f.city, f.suggestion)
  if (!s) return { address: null, label: null }
  return { address: s.source === 'member' ? f.address : (f.suggestion?.address ?? null), label: s.label }
}

// --------------------------------------------------------------- backfill ---

const BACKFILL_PARALLEL = 4

export type BackfillTally = { scanned: number; saved: number; none: number; skipped: number; unavailable: number; remaining: number }

/**
 * The one-time backfill (PR-07), in small batches from the 5-minute cron:
 * members (tutor or parent) with an approved CNIC, a CNIC back on record that
 * was never read, and no address. Each image is read once, so the work ends by
 * itself. Images are only read, never changed. Counts only.
 */
export async function runAddressBackfill(opts: { limit?: number; deadlineMs?: number } = {}): Promise<BackfillTally> {
  const tally: BackfillTally = { scanned: 0, saved: 0, none: 0, skipped: 0, unavailable: 0, remaining: 0 }
  const admin = createAdminClient()
  if (!admin || !process.env.ANTHROPIC_API_KEY) return tally
  const limit = opts.limit ?? 12
  const deadline = opts.deadlineMs ?? Date.now() + 30_000
  const backs = await pageAll<Record<string, unknown>>((f, t) =>
    admin
      .from('user_documents')
      .select('id, user_id, status, created_at')
      .eq('kind', 'cnic')
      .eq('label', 'back')
      .is('address_read_at', null)
      .order('id')
      .range(f, t) as never,
  )
  const live = backs.filter((d) => d.status !== 'paused')
  const ids = [...new Set(live.map((d) => d.user_id as string))]
  if (ids.length === 0) return tally
  // Approved CNIC, no address, not erased, not already suggested.
  const people: Record<string, unknown>[] = []
  for (let i = 0; i < ids.length; i += 200) {
    const part = ids.slice(i, i + 200)
    const { data } = await admin.from('profiles').select('id, role, address, cnic_verified_at, erased_at').in('id', part)
    people.push(...(data ?? []))
  }
  const sugg = new Set<string>()
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await admin.from('address_suggestions').select('user_id').in('user_id', ids.slice(i, i + 200))
    for (const r of data ?? []) sugg.add(r.user_id as string)
  }
  const want = new Set(
    people
      .filter((p) => ['tutor', 'parent', 'academy'].includes(p.role as string) && !!p.cnic_verified_at && !p.erased_at && !String(p.address ?? '').trim() && !sugg.has(p.id as string))
      .map((p) => p.id as string),
  )
  // The newest unread back of each member.
  const newest = new Map<string, Record<string, unknown>>()
  for (const d of live) {
    const k = d.user_id as string
    if (!want.has(k)) continue
    const cur = newest.get(k)
    if (!cur || String(d.created_at) > String(cur.created_at)) newest.set(k, d)
  }
  const queue = [...newest.values()]
  tally.remaining = queue.length
  // A few at a time; no new batch starts after the deadline (each read is
  // capped at 25 s, so the cron stays inside its time limit).
  const batch = queue.slice(0, limit)
  for (let i = 0; i < batch.length; i += BACKFILL_PARALLEL) {
    if (Date.now() > deadline) break
    const results = await Promise.all(batch.slice(i, i + BACKFILL_PARALLEL).map((d) => readAddressFromDocument(d.id as string, 'backfill')))
    for (const r of results) {
      tally.scanned++
      if (r.status === 'saved') tally.saved++
      else if (r.status === 'none') tally.none++
      else if (r.status === 'unavailable') tally.unavailable++
      else tally.skipped++
      if (r.status !== 'unavailable') tally.remaining--
    }
  }
  return tally
}
