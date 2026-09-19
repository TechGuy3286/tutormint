// lib/tileTones.ts
//
// The dashboard/overview tile palette, defined ONCE (owner PR32 §2, retinted
// PR34 §2). Every count tile — the tutor dashboard's six, the parent dashboard's
// six and the admin Overview's five — draws its colour from here, so "each tile a
// distinct colour, no two share" is a property of one list rather than a
// coincidence maintained by hand across three files.
//
// A tone now colours the WHOLE box, not just the icon chip and number (PR34 §2):
//
//   card = the soft tinted background of the whole tile.
//   ink  = the dark shade of the same colour, for the number, label and helper
//          line, so the text reads clearly on the tint.
//   chip = the icon disc: a solid brand hue with a WHITE glyph (the "stronger
//          shade" option), which reads on both the light and the dark box.
//
// DARK MODE. `card` and `ink` are dedicated tokens (app/globals.css) that carry a
// prefers-color-scheme: dark override — deeper, muted box tints with a light ink.
// The chip stays a fixed brand hue in both modes (a white glyph reads on it
// either way). Every text-on-box pair, light and dark, is asserted by
// `npm run check:contrast`.
//
// PURE — no imports — so StatTile (a component) and the admin Overview page both
// read it, and the class strings are Tailwind utilities the tokens generate.

export type TileTone = 'navy' | 'green' | 'red' | 'gold' | 'mint' | 'teal' | 'violet'

export const TILE_TONE: Record<TileTone, { card: string; ink: string; chip: string }> = {
  navy: { card: 'bg-tm-tile-navy-bg', ink: 'text-tm-tile-navy-ink', chip: 'bg-tm-navy text-white' },
  green: { card: 'bg-tm-tile-green-bg', ink: 'text-tm-tile-green-ink', chip: 'bg-tm-green-deep text-white' },
  red: { card: 'bg-tm-tile-red-bg', ink: 'text-tm-tile-red-ink', chip: 'bg-tm-red text-white' },
  gold: { card: 'bg-tm-tile-gold-bg', ink: 'text-tm-tile-gold-ink', chip: 'bg-tm-gold-ink text-white' },
  // mint is not used by any tile; it maps to the navy tone so the palette stays
  // total (a caller passing 'mint' gets a valid, contrast-checked tile).
  mint: { card: 'bg-tm-tile-navy-bg', ink: 'text-tm-tile-navy-ink', chip: 'bg-tm-navy text-white' },
  teal: { card: 'bg-tm-tile-teal-bg', ink: 'text-tm-tile-teal-ink', chip: 'bg-tm-teal-ink text-white' },
  violet: { card: 'bg-tm-tile-violet-bg', ink: 'text-tm-tile-violet-ink', chip: 'bg-tm-violet-ink text-white' },
}
