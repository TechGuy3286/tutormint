// lib/tileTones.ts
//
// The dashboard/overview tile palette, defined ONCE (owner PR32 §2). Every count
// tile — the tutor dashboard's six, the parent dashboard's six and the admin
// Overview's five — draws its colour from here, so "each tile a distinct colour,
// no two share" is a property of one list rather than a coincidence maintained by
// hand across three files.
//
// A tone is a tint (the icon chip's ground) and an ink (the icon glyph inside the
// chip AND the number on the white card). The ink is what a reader sees as "the
// tile's colour", so every tone has a DISTINCT ink — two tiles never share a
// number colour. Six tones give the two dashboards six distinct tiles each; the
// admin cards reuse five of them (a separate group, so reuse across groups is
// fine).
//
// COLOUR SOURCE. navy/green/red/gold are the brand tints. mint carries navy ink
// (its own family ink is marginal on the tint), so it shares navy's ink and is
// NOT used where six distinct inks are needed. teal and violet are two added
// tokens (app/globals.css + scripts/contrast-check.ts) that go beyond the four
// brand hues but pass WCAG AA on both their tint and white, in the same way the
// brand tints do. Every pair here is asserted by `npm run check:contrast`.
//
// PURE — no imports — so StatTile (a component) and the admin Overview page both
// read it, and the class strings are Tailwind utilities the tokens generate.

export type TileTone = 'navy' | 'green' | 'red' | 'gold' | 'mint' | 'teal' | 'violet'

/** chip = the tint ground + the family ink for the icon; ink = the same ink for
 *  the number on the white card. */
export const TILE_TONE: Record<TileTone, { chip: string; ink: string }> = {
  navy: { chip: 'bg-tm-tint-navy text-tm-navy', ink: 'text-tm-navy' },
  green: { chip: 'bg-tm-tint-green text-tm-green-deep', ink: 'text-tm-green-deep' },
  red: { chip: 'bg-tm-tint-red text-tm-red', ink: 'text-tm-red' },
  gold: { chip: 'bg-tm-tint-gold text-tm-gold-ink', ink: 'text-tm-gold-ink' },
  mint: { chip: 'bg-tm-tint-mint text-tm-navy', ink: 'text-tm-navy' },
  teal: { chip: 'bg-tm-tint-teal text-tm-teal-ink', ink: 'text-tm-teal-ink' },
  violet: { chip: 'bg-tm-tint-violet text-tm-violet-ink', ink: 'text-tm-violet-ink' },
}
