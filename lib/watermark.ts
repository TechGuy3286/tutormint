// The repeated-diagonal "TutorMint" watermark, as an SVG (PR106-C §4). Pure (no
// sharp, no imports) so the pattern is unit-tested; lib/documents composites it
// onto the downscaled preview.
//
// Clearly visible but not hiding the content: a dense −30° grid (rows ≈ min/5,
// columns a touch over the word width) in a two-tone fill — brand navy at 0.30
// alpha with a half-opaque white stroke — so the mark reads on both a light scan
// and a dark photo. The grid is covered well past the canvas so the rotation
// never leaves a bare corner.

export function watermarkSvg(width: number, height: number): string {
  const step = Math.max(40, Math.round(Math.min(width, height) / 5))
  const fontSize = Math.max(13, Math.round(step / 2.6))
  const colGap = Math.round(fontSize * 7.5) // ≈ the rendered word width + a gap

  const marks: string[] = []
  for (let y = -height; y < height * 2; y += step) {
    for (let x = -width; x < width * 2; x += colGap) {
      marks.push(
        `<text x="${x}" y="${y}" font-family="Helvetica,Arial,sans-serif" font-size="${fontSize}" ` +
          `font-weight="700" fill="rgba(21,30,107,0.30)" stroke="rgba(255,255,255,0.55)" ` +
          `stroke-width="1" paint-order="stroke">TutorMint</text>`,
      )
    }
  }

  return `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
       <g transform="rotate(-30 ${width / 2} ${height / 2})">${marks.join('')}</g>
     </svg>`
}

/** How many "TutorMint" marks the grid draws for a given size — used by the test
 *  to assert the pattern is dense (not a single row that rotates off-canvas). */
export function watermarkMarkCount(width: number, height: number): number {
  return (watermarkSvg(width, height).match(/TutorMint/g) ?? []).length
}
