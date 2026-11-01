// lib/memberEditCore.ts
//
// The member page's Edit tab (owner, 31 Oct 2026) replaced the separate tutor
// record page. One helper builds its address, so every link agrees and the old
// /admin/tutors/<id> redirect lands on the same place.

export function memberEditHref(id: string): string {
  return `/admin/users/${encodeURIComponent(id)}/edit`
}

/** Where a staff list sends "Review documents": the Profile tab's Documents box. */
export function memberDocumentsHref(id: string): string {
  return `/admin/users/${encodeURIComponent(id)}#documents`
}
