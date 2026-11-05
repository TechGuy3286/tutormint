import { redirect } from 'next/navigation'

// /admin/documents has no page of its own; its one screen is the Owner's
// "Documents approved by staff" list (owner, 5 Nov 2026).
export default function DocumentsIndex() {
  redirect('/admin/documents/staff-decisions')
}
