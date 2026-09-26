// lib/showAvatar.ts
//
// One tolerant read of the tutor "show my picture to parents" flag
// (tutor_profiles.show_avatar, PR70). The migration that adds the column is
// applied AFTER the code deploys, so this MUST work whether or not the column
// exists yet — a missing column (or any read error) means "shown", the default.
//
// The big parent-facing surfaces (Browse cards, the public profile, its OG image
// and JSON-LD, the blog embed, the shortlist, the tutor's own verified-share
// card) draw the photo from the tutor_directory / tutor_visible_profiles views,
// which gate avatar_url themselves — so they need no TS help. This helper is for
// the few surfaces that read profiles/tutor_profiles.avatar_url DIRECTLY and so
// bypass the views: the CV, the parent-facing inbox counterpart, and the
// admin-generated social banner (whose OUTPUT is public marketing).
//
// Staff (admin, verification queue) and the tutor's own dashboard/Settings read
// the base tables and are deliberately NOT passed through here — they keep the
// real picture.

// A deliberately loose client type: the Supabase query builder is thenable but
// not a Promise, and both the server and admin clients differ in their generic
// parameters, so we accept anything with a `.from()` and read defensively.
type Queryable = { from: (table: string) => { select: (cols: string) => { in: (col: string, values: string[]) => PromiseLike<{ data: unknown; error: unknown }> } } }

/**
 * The subset of `ids` whose owner has HIDDEN their picture. Tolerant: if the
 * column does not exist yet, or the read fails, returns an empty set so every
 * picture is shown (the default). A non-tutor id is simply absent from
 * tutor_profiles and so is never "hidden".
 */
export async function hiddenAvatarTutorIds(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any,
  ids: (string | null | undefined)[],
): Promise<Set<string>> {
  const uniq = [...new Set(ids.filter((v): v is string => !!v))]
  if (!client || uniq.length === 0) return new Set()
  try {
    const { data, error } = await (client as Queryable).from('tutor_profiles').select('id, show_avatar').in('id', uniq)
    if (error || !Array.isArray(data)) return new Set()
    const hidden = new Set<string>()
    for (const row of data as { id: string; show_avatar: boolean | null }[]) {
      if (row.show_avatar === false) hidden.add(row.id)
    }
    return hidden
  } catch {
    return new Set()
  }
}

/** True when this one tutor's picture should be shown (tolerant default: shown). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function avatarShown(client: any, id: string | null | undefined): Promise<boolean> {
  if (!id) return true
  const hidden = await hiddenAvatarTutorIds(client, [id])
  return !hidden.has(id)
}
