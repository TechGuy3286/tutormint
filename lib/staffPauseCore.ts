// lib/staffPauseCore.ts
//
// PURE rules for "Pause" on the Team page (owner, 11 Nov 2026; migration 229).
//
// Pause = admin access stops at once and every device is signed out; the role
// is KEPT so Resume restores it in one click. While paused (and after "Remove
// from team"): the staff link stops crediting them (new sign-ups credit Admin),
// the tuitions they own and the cities they look after move to the Owner, so
// no follow-up is dropped, and their history stays labelled with their name.
// Only the Owner pauses, resumes or removes; the Owner can never be paused.
//
// Unit-tested by scripts/test-staff-pause.ts.

export type PauseTarget = {
  id: string
  role: string | null
  adminRole: string | null
  pausedAt: string | null
  formerAt?: string | null
}

export const PAUSE_OWNER_ONLY = 'Only the Owner can pause, resume or remove staff.'
export const PAUSE_SELF = 'You cannot pause your own account.'
export const PAUSE_OWNER_TARGET = 'The Owner account cannot be paused.'
export const PAUSE_NOT_STAFF = 'That is not a staff account.'
export const PAUSE_ALREADY = 'This staff member is already paused.'
export const RESUME_NOT_PAUSED = 'This staff member is not paused.'

/** Why this pause is refused, or null when it may go ahead. */
export function pauseProblem(actor: { id: string; adminRole: string | null }, target: PauseTarget | null): string | null {
  if (actor.adminRole !== 'owner') return PAUSE_OWNER_ONLY
  if (!target || target.role !== 'admin' || !target.adminRole) return PAUSE_NOT_STAFF
  if (target.id === actor.id) return PAUSE_SELF
  if (target.adminRole === 'owner') return PAUSE_OWNER_TARGET
  if (target.pausedAt) return PAUSE_ALREADY
  return null
}

/** Why this resume is refused, or null. */
export function resumeProblem(actor: { id: string; adminRole: string | null }, target: PauseTarget | null): string | null {
  if (actor.adminRole !== 'owner') return PAUSE_OWNER_ONLY
  if (!target || target.role !== 'admin' || !target.adminRole) return PAUSE_NOT_STAFF
  if (!target.pausedAt) return RESUME_NOT_PAUSED
  return null
}

/** Is this account a working staff member right now? Paused, suspended and
 *  removed accounts are not — getAdminActor and every staff-link check read it. */
export function staffAccessOpen(p: { role: string | null; adminRole: string | null; suspended?: boolean | null; pausedAt?: string | null }): boolean {
  return p.role === 'admin' && !!p.adminRole && !p.suspended && !p.pausedAt
}

// ------------------------------------------------------------- handover ----

/** What a pause moved to the Owner, kept on profiles.staff_pause_handover so
 *  Resume can give back exactly what nobody has changed since. */
export type PauseHandover = {
  at: string
  ownerId: string
  cities: string[]
  jobs: { jobId: string; source: string | null }[]
}

export function readHandover(v: unknown): PauseHandover | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  if (typeof o.at !== 'string' || typeof o.ownerId !== 'string') return null
  const cities = Array.isArray(o.cities) ? o.cities.filter((c): c is string => typeof c === 'string') : []
  const jobs = Array.isArray(o.jobs)
    ? o.jobs
        .filter((j): j is Record<string, unknown> => !!j && typeof j === 'object' && typeof (j as Record<string, unknown>).jobId === 'string')
        .map((j) => ({ jobId: j.jobId as string, source: typeof j.source === 'string' ? (j.source as string) : null }))
    : []
  return { at: o.at, ownerId: o.ownerId, cities, jobs }
}

/** The rows a Resume may give back: still held by the Owner and untouched
 *  since the pause stamped them. Anything reassigned in between stays. */
export function restorable(
  h: PauseHandover,
  current: {
    cities: { city: string; staffId: string | null; updatedAt: string | null }[]
    jobs: { jobId: string; staffId: string | null; assignedAt: string | null }[]
  },
): { cities: string[]; jobs: { jobId: string; source: string | null }[] } {
  const same = (a: string | null, b: string) => !!a && Date.parse(a) === Date.parse(b)
  const cityNow = new Map(current.cities.map((c) => [c.city, c]))
  const jobNow = new Map(current.jobs.map((j) => [j.jobId, j]))
  return {
    cities: h.cities.filter((c) => {
      const n = cityNow.get(c)
      return !!n && n.staffId === null && same(n.updatedAt, h.at)
    }),
    jobs: h.jobs.filter((j) => {
      const n = jobNow.get(j.jobId)
      return !!n && n.staffId === h.ownerId && same(n.assignedAt, h.at)
    }),
  }
}

/** The card chip on the Team page. */
export function pausedChip(pausedAt: string | null, fmt: (iso: string) => string): string | null {
  return pausedAt ? `Paused · ${fmt(pausedAt)}` : null
}
