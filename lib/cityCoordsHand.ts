// lib/cityCoordsHand.ts
//
// The hand-entered coordinates of the 26 curated cities (PR85), moved out of
// lib/cityDistance.ts unchanged (owner, 20 Oct 2026) so the city-list generator
// (scripts/build-pk-cities.ts) can read them without importing its own output.
// These values WIN over the generated GeoNames data (lib/pkCityData.ts): adding
// the rest of Pakistan changes nothing about the existing 26.

export type LatLng = { lat: number; lng: number }

export const HAND_CITY_COORDS: Record<string, LatLng> = {
  Lahore: { lat: 31.5204, lng: 74.3587 },
  Karachi: { lat: 24.8607, lng: 67.0011 },
  Islamabad: { lat: 33.6844, lng: 73.0479 },
  Rawalpindi: { lat: 33.5651, lng: 73.0169 },
  Abbottabad: { lat: 34.1688, lng: 73.2215 },
  Bahawalpur: { lat: 29.3956, lng: 71.6836 },
  'Dera Ghazi Khan': { lat: 30.0459, lng: 70.6345 },
  Faisalabad: { lat: 31.4504, lng: 73.135 },
  Gujranwala: { lat: 32.1877, lng: 74.1945 },
  Gujrat: { lat: 32.5731, lng: 74.0789 },
  Hyderabad: { lat: 25.396, lng: 68.3578 },
  Jhang: { lat: 31.2681, lng: 72.3181 },
  Jhelum: { lat: 32.9425, lng: 73.7257 },
  Larkana: { lat: 27.559, lng: 68.2123 },
  Mardan: { lat: 34.1989, lng: 72.0231 },
  Mingora: { lat: 34.7795, lng: 72.3614 },
  Multan: { lat: 30.1575, lng: 71.5249 },
  Peshawar: { lat: 34.0151, lng: 71.5249 },
  Quetta: { lat: 30.1798, lng: 66.975 },
  'Rahim Yar Khan': { lat: 28.4202, lng: 70.2952 },
  Sahiwal: { lat: 30.6682, lng: 73.1114 },
  Sargodha: { lat: 32.0836, lng: 72.6711 },
  Sheikhupura: { lat: 31.7167, lng: 73.985 },
  Sialkot: { lat: 32.4945, lng: 74.5229 },
  Sukkur: { lat: 27.7052, lng: 68.8574 },
  'Wah Cantt': { lat: 33.7973, lng: 72.7574 },
  // Common free-text cities members use that are not in the curated 26.
  'Nankana Sahib': { lat: 31.4492, lng: 73.7126 },
}
