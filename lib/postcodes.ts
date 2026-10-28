// lib/postcodes.ts
//
// City/area → Pakistan Post postcode, for the JobPosting postalCode and the
// staff tuition form (moved out of lib/pkLocations on 28 Oct 2026 so the form
// does not load the city list). The rules are unchanged: only codes confidently
// official; an area falls back to its city's main code; unknown → null.

// City → main postcode. ONLY the codes I am confident are official Pakistan Post
// GPO codes. The 17 cities not listed here (Abbottabad, Bahawalpur, Dera Ghazi
// Khan, Gujranwala, Gujrat, Jhang, Jhelum, Larkana, Mardan, Mingora, Sahiwal, Sargodha,
// Sialkot, Sukkur, Wah Cantt, Sheikhupura, Rahim Yar Khan) are omitted on purpose — see rule 1 — and are for
// the owner to supply. Every city currently used on live tuitions is here.
const CITY_POSTCODE: Record<string, string> = {
  lahore: '54000',
  karachi: '74000',
  islamabad: '44000',
  rawalpindi: '46000',
  faisalabad: '38000',
  multan: '60000',
  peshawar: '25000',
  quetta: '87300',
  hyderabad: '71000',
}

// Area → postcode, keyed "city|area" (both lowercased). Deliberately empty for
// now: I cannot confidently vouch for neighbourhood-level Pakistan Post codes,
// and rule 1 says omit rather than guess. Every area therefore falls back to its
// city's main code. To add one, confirm the official code and add e.g.
//   'lahore|model town': '54700',
// The report lists this as pending owner input.
const AREA_POSTCODE: Record<string, string> = {}

function key(s: string | null | undefined): string {
  return (s ?? '').trim().toLowerCase()
}

/**
 * The postcode for a tuition's location: the area's own code when we have a
 * confident one, otherwise the city's main code. Null when we have neither — the
 * caller then omits postalCode rather than emit a made-up one.
 */
export function postcodeFor(
  city: string | null | undefined,
  area: string | null | undefined,
): string | null {
  const c = key(city)
  if (!c) return null
  const areaCode = AREA_POSTCODE[`${c}|${key(area)}`]
  if (areaCode) return areaCode
  return CITY_POSTCODE[c] ?? null
}
