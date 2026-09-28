import { History } from 'lucide-react'

import SecureDocumentPreview from '@/components/SecureDocumentPreview'
import { createAdminClient } from '@/lib/supabase/admin'
import { fetchTaxonomyTables, buildTaxonomy } from '@/lib/taxonomyBuild'
import { loadFieldHistory, type Step1Field } from '@/lib/fieldHistory'
import { formatDateTime } from '@/lib/datetime'

// PR83 (Part C) — the change history for a tutor's step-1 fields, on the admin
// tutor page. Newest first; NEVER deletes. CNIC numbers are already stored
// masked (last 4). Image changes are stored as a file reference and rendered as
// a staff-only watermarked thumbnail (SecureDocumentPreview / the avatar URL) —
// the raw image never reaches a public URL. Subject changes are stored as a
// master-id list and resolved to labels here (server-side).

const FIELD_LABEL: Record<Step1Field, string> = {
  mobile: 'Mobile number',
  cnic_number: 'CNIC number',
  cnic_front: 'CNIC (front)',
  cnic_back: 'CNIC (back)',
  profile_picture: 'Profile picture',
  selfie: 'Selfie',
  subjects: 'Subjects',
  city: 'City',
  areas: 'Areas',
}

const IMAGE_FIELDS = new Set<Step1Field>(['cnic_front', 'cnic_back', 'selfie', 'profile_picture'])

function docIdOf(value: string | null): string | null {
  if (value && value.startsWith('doc:')) return value.slice(4)
  return null
}

/** A stored value rendered for the history: a thumbnail for an image, resolved
 *  labels for subjects, or the plain (already-masked) text otherwise. */
function ValueCell({
  field,
  value,
  subjectMap,
}: {
  field: Step1Field
  value: string | null
  subjectMap: Map<number, string>
}) {
  if (!value) return <span className="text-gray-500">—</span>

  if (IMAGE_FIELDS.has(field)) {
    const docId = docIdOf(value)
    if (docId) return <SecureDocumentPreview documentId={docId} alt={FIELD_LABEL[field]} className="h-16 w-24" />
    // profile_picture stores a URL.
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={value} alt={FIELD_LABEL[field]} className="h-16 w-16 rounded-xl border border-gray-200 object-cover" />
  }

  if (field === 'subjects') {
    const ids = value.split(',').map((s) => Number(s.trim())).filter((n) => Number.isInteger(n) && n > 0)
    if (ids.length === 0) return <span className="text-gray-500">none</span>
    const labels = ids.map((id) => subjectMap.get(id) ?? `#${id}`)
    return <span>{labels.join(', ')}</span>
  }

  return <span className="break-words">{value}</span>
}

export default async function TutorFieldHistory({ tutorId }: { tutorId: string }) {
  const rows = await loadFieldHistory(tutorId)

  // Resolve subject labels only if some subject change is in the list.
  const subjectMap = new Map<number, string>()
  if (rows.some((r) => r.field === 'subjects')) {
    const admin = createAdminClient()
    if (admin) {
      const tables = await fetchTaxonomyTables(admin)
      if (tables) {
        for (const r of buildTaxonomy(tables).rows) {
          subjectMap.set(r.id, r.subject ? `${r.level} — ${r.subject}` : r.level)
        }
      }
    }
  }

  return (
    <section className="space-y-2 rounded-2xl border border-gray-200 bg-white p-4">
      <h2 className="flex items-center gap-1.5 text-xs font-black uppercase tracking-wide text-gray-500">
        <History aria-hidden size={13} />
        Change history ({rows.length})
      </h2>
      {rows.length === 0 ? (
        <p className="text-xs text-gray-500">
          No changes have been recorded for this tutor&rsquo;s details yet.
        </p>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => (
            <li key={r.id} className="rounded-xl border border-gray-100 bg-tm-bg p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
                <span className="text-xs font-black text-tm-navy">{FIELD_LABEL[r.field] ?? r.field}</span>
                <span className="text-[11px] text-gray-500">{formatDateTime(r.changed_at)}</span>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-700">
                <span className="text-gray-500 line-through decoration-gray-300">
                  <ValueCell field={r.field} value={r.old_value} subjectMap={subjectMap} />
                </span>
                <span aria-hidden className="text-gray-500">→</span>
                <span className="font-semibold">
                  <ValueCell field={r.field} value={r.new_value} subjectMap={subjectMap} />
                </span>
              </div>
              <p className="mt-1 text-[11px] text-gray-500">
                {r.changed_by_role === 'staff' ? 'Staff' : 'Tutor'}
                {r.changed_by_email ? ` · ${r.changed_by_email}` : ''}
                {r.reason ? ` · ${r.reason}` : ''}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
