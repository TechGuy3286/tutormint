// lib/memberEditCore.ts
//
// The member page's Edit tab (owner, 31 Oct 2026) replaced the separate tutor
// record page. One helper builds its address, so every link agrees and the old
// /admin/tutors/<id> redirect lands on the same place.

import { roleSatisfies, SCREEN_ACCESS, type AdminRole } from '@/lib/adminAccessCore'

export function memberEditHref(id: string): string {
  return `/admin/users/${encodeURIComponent(id)}/edit`
}

/** Where a staff list sends "Review documents": the Profile tab's Documents box. */
export function memberDocumentsHref(id: string): string {
  return `/admin/users/${encodeURIComponent(id)}#documents`
}

/**
 * What the Edit tab holds for this viewer and member (owner, 4 Nov 2026):
 *   • tutorFields — a tutor's full editor (the tutors screen);
 *   • whatsapp    — the WhatsApp number section (tutors and parents).
 * The tab shows when either is true.
 */
export function editTabParts(actorRole: AdminRole | null | undefined, memberRole: string | null | undefined): { tutorFields: boolean; whatsapp: boolean; show: boolean } {
  const isTutor = memberRole === 'tutor'
  const isMember = isTutor || memberRole === 'parent' || memberRole === 'academy'
  const tutorFields = isTutor && !!actorRole && roleSatisfies(actorRole, SCREEN_ACCESS.tutors)
  const whatsapp = isMember && !!actorRole && roleSatisfies(actorRole, SCREEN_ACCESS.memberWhatsappEdit)
  return { tutorFields, whatsapp, show: tutorFields || whatsapp }
}
