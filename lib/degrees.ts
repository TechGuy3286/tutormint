// One reader for a tutor's degrees, however they are stored (owner PR14 §3.1).
//
// tutor_profiles.degrees is a text[]. Most rows hold plain strings ("BS Physics
// — Punjab University (2019)"), but one row was written as a JSON STRING inside
// the array — {"title":"…","institute":"","year":"",…} — and rendered raw on the
// public page. This turns any of those shapes into the display line WITHOUT
// editing the stored data: a JSON string yields its title, a plain string yields
// itself, and an accidental object yields its title.
//
// A degree with no readable title collapses to nothing and is dropped by the
// caller, so a blank or "{}" never renders.

export function degreeLabel(raw: unknown): string {
  if (raw == null) return ''
  if (typeof raw === 'object') {
    const t = (raw as { title?: unknown }).title
    return typeof t === 'string' ? t.trim() : ''
  }
  const s = String(raw).trim()
  if (s.startsWith('{')) {
    try {
      const parsed = JSON.parse(s) as { title?: unknown }
      return typeof parsed.title === 'string' ? parsed.title.trim() : ''
    } catch {
      return '' // malformed JSON string — better nothing than raw braces
    }
  }
  return s
}

/** The readable degree lines, JSON-string forms decoded, blanks dropped. */
export function degreeLabels(degrees: unknown[] | null | undefined): string[] {
  return (degrees ?? []).map(degreeLabel).filter((s) => s.length > 0)
}
