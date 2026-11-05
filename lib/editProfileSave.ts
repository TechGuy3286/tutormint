// lib/editProfileSave.ts
//
// What each Edit Profile card that saves through /api/profile/save sends, and
// the one client call that sends it. Shared by the tutor Edit Profile page and
// its test (scripts/test-edit-profile-cards.ts), so the test saves exactly what
// the page saves. The route rebuilds the tutor's cached public profile on every
// save (profile_updated → lib/activityLog → revalidateTutorProfile).

export { experienceSavePayload } from '@/lib/experienceEditCore'

type Fetch = (input: string, init?: RequestInit) => Promise<Response>

/** POST a card's payload; throws the server's own message on a refusal. */
export async function postProfileSave(payload: Record<string, unknown>, fetchImpl: Fetch = fetch): Promise<void> {
  const res = await fetchImpl('/api/profile/save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    const j = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(j.error || 'Could not save.')
  }
}

export function jobTypesPayload(jobTypes: string[]) {
  return { tutorProfile: { job_types: jobTypes, teaching_mode: jobTypes[0] ?? null } }
}

export function feePayload(min: number | null, max: number | null) {
  return { tutorProfile: { fee_min_pkr: min, fee_max_pkr: max } }
}

export function subjectsPayload(ids: number[]) {
  return { subjectMasterIds: ids }
}

export function locationPayload(mainCity: string, areasByCity: Record<string, string[]>) {
  return { profile: { city: mainCity }, areasByCity }
}

/** Two names (owner, 5 Nov 2026): the Name on CNIC (left out once it is locked
 *  — the server and the database refuse a change), the optional Display name
 *  (empty = show the Name on CNIC) and the WhatsApp number of the same card. */
export function namesPayload(v: { cnicName: string; displayName: string; whatsapp?: string | null; cnicNameLocked: boolean }) {
  const profile: Record<string, unknown> = { display_name: v.displayName.trim() }
  if (!v.cnicNameLocked) profile.cnic_name = v.cnicName
  if (v.whatsapp !== undefined) profile.whatsapp = v.whatsapp
  return { profile }
}
