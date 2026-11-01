// PURE. What /api/viewer/tutor answers (push 3, owner 1 Nov 2026): the
// signed-in visitor's side of ONE cached tutor profile.

export type TutorViewer =
  | { signedIn: false }
  | {
      signedIn: true
      isSelf: boolean
      /** 'tutor' | 'parent' | 'admin' — the viewer's audience. */
      audience: string | null
      /** The viewer may see this tutor's phone and WhatsApp (Featured parent, or the tutor). */
      contactUnlocked: boolean
      /** Only filled when contactUnlocked — never sent otherwise. */
      contact: { phone: string | null; whatsapp: string | null } | null
      saved: boolean
      isParent: boolean
      hired: boolean
    }

/** The action bar shows for everyone but a tutor looking at ANOTHER tutor
 *  (owner, 5 Oct 2026); never while the profile is under review. */
export function showProfileActions(v: TutorViewer | null, underReview: boolean): boolean {
  if (underReview) return false
  if (!v || !v.signedIn) return true
  return !(v.audience === 'tutor' && !v.isSelf)
}

/** The tutor's own page that is not public yet: the hidden-profile page sends
 *  them to their preview. */
export function ownPreviewPath(slug: string): string {
  return `/tutor/${encodeURIComponent(slug)}?preview=1`
}
