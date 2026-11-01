// lib/staffTenureCore.ts
//
// PURE. Staff joining dates on the Team cards (owner, 2 Nov 2026, Part G).
//   "Joined: <date, time> · added by <name>"  — staff_tenure, else the first
//      staff.create / staff.grant_existing audit row
//   "<Role> since <date>"                    — the latest staff.role_change to
//      the current role, else the joining date
//   "Left: <date>"                            — profiles.former_staff_at
// Where nothing is recorded: "Joined: not recorded" (the Owner may set it).

export type TenureAudit = { action: string; createdAt: string; actorName: string | null; detail?: Record<string, unknown> | null }

export type TenureStored = { joinedAt: string; joinedByName: string | null; source: 'staff.create' | 'staff.grant_existing' | 'set' }

export type TenureView = {
  joinedLine: string
  joinedRecorded: boolean
  joinedSource: 'staff.create' | 'staff.grant_existing' | 'set' | null
  roleSinceLine: string | null
  leftLine: string | null
}

const JOIN_ACTIONS = new Set(['staff.create', 'staff.grant_existing'])

/** "22 Sep 2026, 1:26 pm" in Pakistan time. */
export function pkDateTime(iso: string): string {
  const d = new Date(iso)
  const date = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Karachi' })
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Karachi' }).toLowerCase()
  return `${date}, ${time}`
}
export function pkDateOnly(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Karachi' })
}

/** The joining record a backfill would store: the first join audit row. */
export function joinFromAudit(rows: TenureAudit[]): TenureStored | null {
  const first = [...rows].filter((r) => JOIN_ACTIONS.has(r.action)).sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0]
  if (!first) return null
  return { joinedAt: first.createdAt, joinedByName: first.actorName, source: first.action as TenureStored['source'] }
}

export function tenureView(input: {
  stored: TenureStored | null
  audit: TenureAudit[]
  adminRole: string | null
  roleLabel: string | null
  formerAt: string | null
}): TenureView {
  const join = input.stored ?? joinFromAudit(input.audit)
  const joinedLine = join
    ? `Joined: ${pkDateTime(join.joinedAt)}${join.source === 'set' ? ' · date set by the Owner' : join.joinedByName ? ` · added by ${join.joinedByName}` : ''}`
    : 'Joined: not recorded'
  let roleSinceLine: string | null = null
  if (input.adminRole && input.roleLabel) {
    const change = [...input.audit]
      .filter((r) => r.action === 'staff.role_change' && (r.detail?.to ?? null) === input.adminRole)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
    const since = change?.createdAt ?? join?.joinedAt ?? null
    roleSinceLine = since ? `${input.roleLabel} since ${pkDateOnly(since)}` : null
  }
  return {
    joinedLine,
    joinedRecorded: !!join,
    joinedSource: join?.source ?? null,
    roleSinceLine,
    leftLine: input.formerAt ? `Left: ${pkDateOnly(input.formerAt)}` : null,
  }
}

/** A typed "Set date" value (YYYY-MM-DD, optional HH:MM, Pakistan time) → ISO,
 *  or null when it is not a real date or is in the future. */
export function parseSetDate(date: string, time: string | null | undefined, nowMs = Date.now()): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim())
  if (!m) return null
  const t = /^(\d{1,2}):(\d{2})$/.exec((time ?? '').trim() || '12:00')
  if (!t) return null
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const [h, mi] = [Number(t[1]), Number(t[2])]
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null
  const ms = Date.UTC(y, mo - 1, d, h - 5, mi) // Pakistan is UTC+5, no DST
  const back = new Date(ms + 5 * 3600_000)
  if (back.getUTCDate() !== d || back.getUTCMonth() !== mo - 1) return null
  if (ms > nowMs || y < 2020) return null
  return new Date(ms).toISOString()
}
