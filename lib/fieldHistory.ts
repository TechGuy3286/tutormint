import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'

// PR83 (Part C) — best-effort recorder for changes to a tutor's "step 1" fields.
//
// Every write goes through the SERVICE ROLE (tutor_field_history has no write
// policy — members can never insert), and is BEST-EFFORT: it never throws and
// never blocks the save that triggered it. The table is additive and may not
// exist yet when this code first deploys, so a missing table (or any other
// failure) is simply swallowed. Callers record old→new for a field; staff edits
// must pass a reason, a member's own change passes none.
//
// Values are stored display-ready (already masked / summarised): a CNIC is
// stored showing only its last 4 digits (maskCnicHistory), images are stored as
// a file reference (a document id or avatar path), and subjects as a readable
// label list. So the admin history view renders what it is given without having
// to unmask or resolve anything, and the table never accumulates full CNICs.

export type Step1Field =
  | 'mobile'
  | 'cnic_number'
  | 'cnic_front'
  | 'cnic_back'
  | 'profile_picture'
  | 'selfie'
  | 'subjects'
  | 'city'
  | 'areas'

export type FieldChange = {
  tutorId: string
  field: Step1Field
  oldValue?: string | null
  newValue?: string | null
  /** The profile id of whoever made the change (a staff member or the tutor). */
  changedBy: string
  changedByRole: 'tutor' | 'staff'
  /** Their email, stored on the row so an entry survives account deletion. */
  changedByEmail?: string | null
  /** Required for a staff edit; null for a member's own change. */
  reason?: string | null
}

/** Show only the last 4 digits of a CNIC (the rest masked) — the value that is
 *  stored in history and shown in the admin view. */
export function maskCnicHistory(cnic: string | null | undefined): string {
  const digits = (cnic ?? '').replace(/\D/g, '')
  if (digits.length <= 4) return digits ? `••••${digits.slice(-4)}` : '••••'
  return '•'.repeat(digits.length - 4) + digits.slice(-4)
}

/** Record one or more field changes. Never throws; never blocks the save. */
export async function recordFieldChanges(changes: FieldChange[]): Promise<void> {
  if (changes.length === 0) return
  try {
    const admin = createAdminClient()
    if (!admin) return
    // Drop no-op entries (old === new) so history reflects real changes only.
    const rows = changes
      .filter((c) => (c.oldValue ?? null) !== (c.newValue ?? null))
      .map((c) => ({
        tutor_id: c.tutorId,
        field: c.field,
        old_value: c.oldValue ?? null,
        new_value: c.newValue ?? null,
        changed_by: c.changedBy,
        changed_by_role: c.changedByRole,
        changed_by_email: c.changedByEmail ?? null,
        reason: c.reason ?? null,
      }))
    if (rows.length === 0) return
    // A missing table returns { error } (code 42P01) rather than throwing; we
    // ignore it — this is best-effort and additive.
    await admin.from('tutor_field_history').insert(rows)
  } catch {
    // Never let history recording break a save.
  }
}

/** Record a MEMBER's own change to their step-1 fields (changed_by_role
 *  'tutor'), but only when the account is actually a tutor — a parent changing
 *  their city is not a tutor step-1 change and does not belong here. One extra
 *  role read, fully guarded; best-effort like recordFieldChanges. */
export async function recordTutorSelfChanges(
  userId: string,
  changes: Array<Pick<FieldChange, 'field' | 'oldValue' | 'newValue'>>,
): Promise<void> {
  if (changes.length === 0) return
  try {
    const admin = createAdminClient()
    if (!admin) return
    const { data } = await admin.from('profiles').select('role, email').eq('id', userId).maybeSingle()
    if (!data || data.role !== 'tutor') return
    await recordFieldChanges(
      changes.map((c) => ({
        ...c,
        tutorId: userId,
        changedBy: userId,
        changedByRole: 'tutor' as const,
        changedByEmail: (data.email as string | null) ?? null,
        reason: null,
      })),
    )
  } catch {
    // best-effort
  }
}

/** Read a tutor's change history, newest first (admin/service-role read). */
export type FieldHistoryRow = {
  id: number
  field: Step1Field
  old_value: string | null
  new_value: string | null
  changed_by_role: 'tutor' | 'staff'
  changed_by_email: string | null
  reason: string | null
  changed_at: string
}

export async function loadFieldHistory(tutorId: string): Promise<FieldHistoryRow[]> {
  try {
    const admin = createAdminClient()
    if (!admin) return []
    const { data, error } = await admin
      .from('tutor_field_history')
      .select('id, field, old_value, new_value, changed_by_role, changed_by_email, reason, changed_at')
      .eq('tutor_id', tutorId)
      .order('changed_at', { ascending: false })
      .limit(200)
    if (error || !data) return []
    return data as FieldHistoryRow[]
  } catch {
    return []
  }
}
