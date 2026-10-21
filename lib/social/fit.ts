// lib/social/fit.ts
//
// Wrap and shrink text for the social render BEFORE satori draws it — PURE.
// satori wraps text itself, but it cannot be told "at most two lines, shrink
// until it fits", and a headline drawn as coloured word runs (the green key
// word) cannot use line-clamp. So the words are laid out here with the font's
// own advance widths (lib/social/fonts.ts) and handed to the render as lines.

import { JAKARTA_WIDTHS } from '@/lib/social/fonts'

export type Weight = 500 | 700 | 800

/** A word and whether it is drawn in the accent (green) colour. */
export type Word = { text: string; accent?: boolean }

/** Width of a string in px at a size and weight. Unknown characters count as
 *  a wide letter, so an estimate errs towards wrapping, never overflowing. */
export function textWidth(text: string, size: number, weight: Weight): number {
  const table = JAKARTA_WIDTHS[weight]
  let em = 0
  for (const ch of text) em += table[ch] ?? 0.72
  return em * size
}

/** Greedy wrap of words into lines no wider than maxWidth. `tail` is extra
 *  width that must fit after the LAST word (a drawn tick, an icon). */
export function wrapWords(words: Word[], size: number, weight: Weight, maxWidth: number, tail = 0): Word[][] {
  const space = textWidth(' ', size, weight)
  const lines: Word[][] = []
  let line: Word[] = []
  let width = 0
  words.forEach((w, i) => {
    const ww = textWidth(w.text, size, weight) + (i === words.length - 1 ? tail : 0)
    const next = line.length === 0 ? ww : width + space + ww
    if (line.length > 0 && next > maxWidth) {
      lines.push(line)
      line = [w]
      width = ww
    } else {
      line.push(w)
      width = next
    }
  })
  if (line.length) lines.push(line)
  return lines
}

export type Fitted = { size: number; lines: Word[][] }

/**
 * The largest size (stepping down from `max` to `min`) at which the words fit
 * in `maxLines` lines of `maxWidth`, with no single word wider than the line.
 * At `min` the text is cut to `maxLines` lines with an ellipsis, so the result
 * can never spill out of its box.
 */
export function fitWords(
  words: Word[],
  opts: { max: number; min: number; weight: Weight; maxWidth: number; maxLines: number; tail?: number },
): Fitted {
  const { max, min, weight, maxWidth, maxLines, tail = 0 } = opts
  const step = Math.max(1, Math.round(max / 40))
  for (let size = max; size >= min; size -= step) {
    const lines = wrapWords(words, size, weight, maxWidth, tail)
    const widest = Math.max(...words.map((w) => textWidth(w.text, size, weight)))
    if (lines.length <= maxLines && widest <= maxWidth) {
      if (lines.length !== 2) return { size, lines }
      const best = balanceTwo(words, size, weight, maxWidth, tail) ?? lines
      // The green key words split across the lines: shrink up to 30% to keep
      // them together, else accept the split.
      if (splitsAccent(best)) {
        for (let s = size - step; s >= Math.max(min, Math.round(max * 0.7)); s -= step) {
          const b = balanceTwo(words, s, weight, maxWidth, tail)
          if (b && !splitsAccent(b)) return { size: s, lines: b }
        }
      }
      return { size, lines: best }
    }
  }
  // Still too long at the smallest size: keep what fits and end with "…".
  const lines = wrapWords(words, min, weight, maxWidth, tail).slice(0, maxLines)
  const last = lines[lines.length - 1]
  while (last.length > 1 && textWidth(last.map((w) => w.text).join(' ') + '…', min, weight) > maxWidth) last.pop()
  const end = last[last.length - 1]
  let t = end.text
  while (t.length > 1 && textWidth(last.slice(0, -1).map((w) => w.text).concat(t + '…').join(' '), min, weight) > maxWidth) t = t.slice(0, -1)
  last[last.length - 1] = { ...end, text: t + '…' }
  return { size: min, lines }
}

/** True when two lines break inside a run of accent words. */
export function splitsAccent(lines: Word[][]): boolean {
  if (lines.length < 2) return false
  const a = lines[0][lines[0].length - 1]
  const b = lines[1][0]
  return !!a?.accent && !!b?.accent
}

const lineWidth =(line: Word[], size: number, weight: Weight, tail: number) =>
  textWidth(line.map((w) => w.text).join(' '), size, weight) + tail

/**
 * The best place to break two lines: never inside the green key words when a
 * break outside them fits ("I'm a / Verified Tutor ✓", not "I'm a Verified /
 * Tutor ✓"), then the most even pair of lines. Null when nothing fits.
 */
export function balanceTwo(words: Word[], size: number, weight: Weight, maxWidth: number, tail = 0): Word[][] | null {
  let best: { lines: Word[][]; splitsAccent: boolean; widest: number } | null = null
  for (let k = 1; k < words.length; k++) {
    const a = words.slice(0, k)
    const b = words.slice(k)
    const widest = Math.max(lineWidth(a, size, weight, 0), lineWidth(b, size, weight, tail))
    if (widest > maxWidth) continue
    const splitsAccent = !!words[k - 1].accent && !!words[k].accent
    if (
      !best ||
      (best.splitsAccent && !splitsAccent) ||
      (best.splitsAccent === splitsAccent && widest < best.widest)
    ) {
      best = { lines: [a, b], splitsAccent, widest }
    }
  }
  return best?.lines ?? null
}

/** Split a plain string into words, none accented. */
export function plainWords(text: string): Word[] {
  return text.trim().split(/\s+/).filter(Boolean).map((t) => ({ text: t }))
}

/** Words of a headline whose last `accentCount` words are the green key words. */
export function accentTail(text: string, accentCount: number): Word[] {
  const w = plainWords(text)
  const n = w.length > 1 ? Math.min(accentCount, w.length - 1) : 0
  return w.map((x, i) => (i >= w.length - n ? { ...x, accent: true } : x))
}
