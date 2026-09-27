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

// The ONE tile shell (PR77): the exact box, icon chip and border the dashboard
// tiles use, so the tutor Settings tiles and the dashboard tiles are the same
// square by construction rather than by two class strings kept in sync by hand.
// Both StatTile (the dashboard tile) and SettingsTile draw from these.
//
// `w-full h-full` make the tile FILL its grid cell (PR77b): a block-level <a>
// (StatTile) filled its column without it, but a <button> (SettingsTile) shrinks
// to its content width, so the Settings tiles came out unequal — narrow "Selfie",
// wide "CNIC". With w-full every tile fills its column equally, long labels wrap
// inside instead of widening the tile, and h-full keeps a row's tiles equal
// height. It is a no-op for the already-full <a>.
export const TILE_BOX =
  'relative flex h-full w-full min-h-[9.5rem] flex-col items-center justify-center gap-2 rounded-2xl border p-4 text-center transition-shadow hover:shadow-md'
export const TILE_CHIP = 'grid h-12 w-12 place-items-center rounded-2xl'
export const TILE_BORDER_DEFAULT = 'border-black/5 shadow-xs'
export const TILE_BORDER_HIGHLIGHT = 'border-tm-red shadow-[0_2px_14px_-6px_var(--color-tm-red)]'
/** The selected (about-to-expand) tile border. */
export const TILE_BORDER_OPEN = 'border-tm-navy ring-2 ring-tm-navy/30'

export const TILE_TONE: Record<TileTone, { card: string; ink: string; chip: string }> = {
  navy: { card: 'bg-tm-tile-navy-bg', ink: 'text-tm-tile-navy-ink', chip: 'bg-tm-navy text-white' },
  green: { card: 'bg-tm-tile-green-bg', ink: 'text-tm-tile-green-ink', chip: 'bg-tm-green-deep text-white' },
  red: { card: 'bg-tm-tile-red-bg', ink: 'text-tm-tile-red-ink', chip: 'bg-tm-red text-white' },
  gold: { card: 'bg-tm-tile-gold-bg', ink: 'text-tm-tile-gold-ink', chip: 'bg-tm-gold-ink text-white' },
  // mint — its own soft emerald tint (PR76 §D.3), for the optional Intro video
  // tile on the dashboard. The chip is a solid deep green with a white glyph.
  mint: { card: 'bg-tm-tile-mint-bg', ink: 'text-tm-tile-mint-ink', chip: 'bg-tm-green-deep text-white' },
  teal: { card: 'bg-tm-tile-teal-bg', ink: 'text-tm-tile-teal-ink', chip: 'bg-tm-teal-ink text-white' },
  violet: { card: 'bg-tm-tile-violet-bg', ink: 'text-tm-tile-violet-ink', chip: 'bg-tm-violet-ink text-white' },
}
