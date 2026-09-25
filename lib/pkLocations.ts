// lib/pkLocations.ts
//
// City → province and city/area → postcode, for the JobPosting structured data
// on tuition pages (PR51). Staff pick a city and an area on the tuition form;
// this fills the province (addressRegion) and postcode (postalCode) Google asks
// for, so NO new field is ever added to that form.
//
// Pure data, no imports, no database — the lookup lives in code so there is no
// migration and it can be extended in one place.
//
// TWO RULES SHAPED THE POSTCODES:
//   1. Do not guess. Only Pakistan Post codes I am confident are official are
//      here. A city whose code I am not sure of is omitted (postalCode is then
//      simply not emitted for it) and listed for the owner to supply — a wrong
//      postcode in structured data is worse than a missing one.
//   2. Area code when known, else the city's main code. Neighbourhood-level
//      Pakistan Post codes are not something I can vouch for as official, so
//      AREA_POSTCODES starts effectively empty; every area falls back to its
//      city's main code. The owner can add confirmed "City|Area" codes here.
//
// Keys are matched case-insensitively and trimmed, because jobs.city holds plain
// text and both "Lahore" and "lahore" occur.

/** Every province / territory a Pakistani address can name. */
export type Province =
  | 'Punjab'
  | 'Sindh'
  | 'Khyber Pakhtunkhwa'
  | 'Balochistan'
  | 'Islamabad Capital Territory'
  | 'Azad Jammu and Kashmir'
  | 'Gilgit-Baltistan'

// Every city in location_cities (the platform's city list) → its province.
// All 23 are mapped; there is no unmapped city.
const CITY_PROVINCE: Record<string, Province> = {
  lahore: 'Punjab',
  karachi: 'Sindh',
  islamabad: 'Islamabad Capital Territory',
  rawalpindi: 'Punjab',
  abbottabad: 'Khyber Pakhtunkhwa',
  bahawalpur: 'Punjab',
  'dera ghazi khan': 'Punjab',
  faisalabad: 'Punjab',
  gujranwala: 'Punjab',
  gujrat: 'Punjab',
  hyderabad: 'Sindh',
  jhelum: 'Punjab',
  larkana: 'Sindh',
  mardan: 'Khyber Pakhtunkhwa',
  mingora: 'Khyber Pakhtunkhwa',
  multan: 'Punjab',
  peshawar: 'Khyber Pakhtunkhwa',
  quetta: 'Balochistan',
  sahiwal: 'Punjab',
  sargodha: 'Punjab',
  sialkot: 'Punjab',
  sukkur: 'Sindh',
  'wah cantt': 'Punjab',
}

// City → main postcode. ONLY the codes I am confident are official Pakistan Post
// GPO codes. The 14 cities not listed here (Abbottabad, Bahawalpur, Dera Ghazi
// Khan, Gujranwala, Gujrat, Jhelum, Larkana, Mardan, Mingora, Sahiwal, Sargodha,
// Sialkot, Sukkur, Wah Cantt) are omitted on purpose — see rule 1 — and are for
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

/** The province for a city, or null when the city is not one we recognise. */
export function provinceForCity(city: string | null | undefined): Province | null {
  return CITY_PROVINCE[key(city)] ?? null
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
