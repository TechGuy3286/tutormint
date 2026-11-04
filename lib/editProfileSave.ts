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
