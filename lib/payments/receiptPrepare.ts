// lib/payments/receiptPrepare.ts
//
// Get a receipt ready to upload, in the BROWSER (hotfix, 26 Oct 2026).
//
// /pay/choose used to send the chosen file as it was. A phone photo of a
// receipt is often 3–8 MB, while Vercel refuses any request body over about
// 4.5 MB before our route runs — so a photo between 4.5 MB and the old 5 MB
// limit passed our own check and then failed with an unexplained "Your receipt
// did not upload". A photo is now resized (longest side 2000 px, still easy to
// read) and re-encoded as JPEG, stepping the quality down until it is under
// RECEIPT_TARGET_BYTES. A PDF is sent as it is (the 4 MB limit applies).
//
// The compressor is passed in so the rule is unit-tested without a browser.

export const RECEIPT_TARGET_BYTES = 2.5 * 1024 * 1024

export type Compress = (file: File, opts: { maxEdge: number; quality: number }) => Promise<File>

export function looksLikeImage(file: { type: string; name: string }): boolean {
  if (file.type.startsWith('image/')) return true
  return !file.type && /\.(jpe?g|png|webp|heic|heif)$/i.test(file.name)
}

export async function prepareReceiptFile(file: File, compress: Compress): Promise<File> {
  if (!looksLikeImage(file)) return file
  const steps: { maxEdge: number; quality: number }[] = [
    { maxEdge: 2000, quality: 0.85 },
    { maxEdge: 1800, quality: 0.75 },
    { maxEdge: 1600, quality: 0.65 },
  ]
  let best = file
  for (const step of steps) {
    try {
      const out = await compress(file, step)
      if (out.size < best.size || (best === file && out.type === 'image/jpeg' && file.type !== 'image/jpeg' && out !== file)) best = out
    } catch {
      return best
    }
    if (best.size <= RECEIPT_TARGET_BYTES) break
  }
  return best
}
