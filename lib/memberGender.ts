// lib/memberGender.ts
//
// The gender of a set of members, for the default avatar (lib/defaultAvatar).
//
// Gender is recorded for tutors only (tutor_profiles.gender); a parent has none
// and is simply absent from the map, which the avatar reads as "neutral". Used
// by the surfaces that load a member's name and picture from `profiles` and so
// never touch tutor_profiles: the header, the inbox, admin lists.
//
// Tolerant like lib/showAvatar: a failed read returns an empty map, so the worst
// outcome is a neutral silhouette, never a broken page.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function tutorGenders(client: any, ids: (string | null | undefined)[]): Promise<Map<string, string>> {
  const uniq = [...new Set(ids.filter((v): v is string => !!v))]
  const out = new Map<string, string>()
  if (!client || uniq.length === 0) return out
  try {
    const { data, error } = await client.from('tutor_profiles').select('id, gender').in('id', uniq)
    if (!error && Array.isArray(data)) {
      for (const row of data as { id: string; gender: string | null }[]) {
        if (row.gender) out.set(row.id, row.gender)
      }
    }
  } catch {
    /* tolerant: neutral */
  }
  return out
}

/** One member's gender, or null (a parent, an unset gender, a failed read). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function tutorGender(client: any, id: string | null | undefined): Promise<string | null> {
  if (!id) return null
  return (await tutorGenders(client, [id])).get(id) ?? null
}
