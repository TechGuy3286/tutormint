// One reader for a tutor's degrees and certificates, however they are stored
// (PR14 §3.1, PR74 §B).
//
// tutor_profiles.degrees is a text[]; tutor_profiles.certifications is jsonb.
// Elements arrive in three shapes and MUST all render as clean text, never raw
// JSON on any member or staff screen:
//   - a plain string:   "BS Physics — Punjab University (2019)"
//   - a JSON object:     {title, institute/issuer, year, fileName, fileUrl}
//   - a CORRUPTED nest:  {"title":"{\"title\":\"…\",\"institute\":\"\"}", …}
//     where the title field holds the JSON of the whole credential, sometimes
//     more than once. This happened because the loader treated a JSON-string
//     element as a plain title and the save path re-wrapped it every cycle.
//
// parseCredential() unwraps ANY depth of that nesting to the innermost real
// fields; degreeLabel()/certLabel() build the display line. The save path (tutor
// Settings) now loads through parseCredential, so a clean credential is written
// once and never re-wrapped.

export type Credential = {
  title: string
  institute: string
  year: string
  fileName: string
  fileUrl: string
  /** PR106-A: the user_documents id of this degree's certificate, when it was
   *  uploaded through the multi-degree editor. Served watermarked at
   *  /api/documents/<docId>/preview. Empty for legacy plain-string degrees. */
  docId: string
  /** PR106-A: a removed degree is PAUSED, not deleted ("no content is ever
   *  deleted"). Paused entries are kept in the array but hidden from every
   *  reader (public profile, CV, admin, completion). */
  paused: boolean
}

/** Unwrap any element (plain string, object, or nested-JSON title) to clean fields.
 *  An image (fileName/fileUrl) found at ANY nesting level is carried forward. */
export function parseCredential(raw: unknown): Credential {
  const empty: Credential = { title: '', institute: '', year: '', fileName: '', fileUrl: '', docId: '', paused: false }
  let cur: unknown = raw
  let fileName = ''
  let fileUrl = ''
  let docId = ''
  let paused = false
  for (let depth = 0; depth < 8; depth++) {
    if (cur == null) return { ...empty, fileName, fileUrl, docId, paused }
    if (typeof cur === 'string') {
      const s = cur.trim()
      if (s.startsWith('{')) {
        try { cur = JSON.parse(s); continue } catch { return { ...empty, title: s, fileName, fileUrl, docId, paused } }
      }
      return { ...empty, title: s, fileName, fileUrl, docId, paused } // an honest plain-string credential
    }
    if (typeof cur === 'object') {
      const o = cur as Record<string, unknown>
      if (!fileName && typeof o.fileName === 'string') fileName = o.fileName.trim()
      if (!fileUrl && typeof o.fileUrl === 'string') fileUrl = o.fileUrl.trim()
      if (!docId && typeof o.docId === 'string') docId = o.docId.trim()
      if (o.paused === true) paused = true
      const t = o.title
      // A title that is itself the JSON of a credential → keep unwrapping.
      if (typeof t === 'string' && t.trim().startsWith('{')) { cur = t; continue }
      return {
        title: String(o.title ?? '').trim(),
        institute: String(o.institute ?? o.issuer ?? '').trim(),
        year: String(o.year ?? '').trim(),
        fileName,
        fileUrl,
        docId,
        paused,
      }
    }
    return { ...empty, fileName, fileUrl, docId, paused }
  }
  return { ...empty, fileName, fileUrl, docId, paused }
}

/** True when a stored element is the corrupted nested-JSON shape (a JSON string
 *  whose title is itself JSON) — used by the repair to touch ONLY bad rows. */
export function isCredentialCorrupted(raw: unknown): boolean {
  if (typeof raw !== 'string') return false
  const s = raw.trim()
  if (!s.startsWith('{')) return false
  try {
    const o = JSON.parse(s) as { title?: unknown }
    return typeof o.title === 'string' && o.title.trim().startsWith('{')
  } catch {
    return true // a broken JSON string is corrupted
  }
}

/** Load a stored array into clean Credential objects (Settings uses this). */
export function parseCredentials(raw: unknown[] | null | undefined): Credential[] {
  return (raw ?? []).map(parseCredential)
}

/** The display line for a credential: "BS Physics, Punjab University (2019)". */
export function credentialLine(c: Credential): string {
  const head = [c.title, c.institute].filter((x) => x && x.trim()).join(', ')
  const base = head || c.title.trim()
  return base && c.year.trim() ? `${base} (${c.year.trim()})` : base
}

/** One stored degree element → its display line (blank when unreadable). */
export function degreeLabel(raw: unknown): string {
  return credentialLine(parseCredential(raw))
}

/** The readable degree lines, every shape decoded, PAUSED entries and blanks
 *  dropped (PR106-A: a paused degree is kept in storage but shown nowhere). */
export function degreeLabels(degrees: unknown[] | null | undefined): string[] {
  return (degrees ?? [])
    .map(parseCredential)
    .filter((c) => !c.paused)
    .map(credentialLine)
    .filter((s) => s.length > 0)
}

/** The ACTIVE (non-paused) credentials, in order — for the editor and for any
 *  surface that needs the per-entry certificate (docId), not just the text. */
export function activeCredentials(degrees: unknown[] | null | undefined): Credential[] {
  return (degrees ?? []).map(parseCredential).filter((c) => !c.paused && c.title.trim().length > 0)
}

/** Serialise an editor entry back to a storage element: clean JSON when it
 *  carries a certificate or paused flag, else a plain title string (so a simple
 *  degree stays a simple string and never re-wraps). */
export function serializeCredential(c: { title: string; docId?: string; paused?: boolean }): string {
  const title = c.title.trim()
  if (!c.docId && !c.paused) return title
  const obj: Record<string, unknown> = { title }
  if (c.docId) obj.docId = c.docId
  if (c.paused) obj.paused = true
  return JSON.stringify(obj)
}

/** A certificate's display NAME (never just "Certificate"), blank dropped. */
export function certLabel(raw: unknown): string {
  return credentialLine(parseCredential(raw))
}

export function certLabels(certs: unknown[] | null | undefined): string[] {
  return (certs ?? []).map(certLabel).filter((s) => s.length > 0)
}
