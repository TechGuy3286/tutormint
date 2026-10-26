// lib/uploadLimitCore.ts — PURE, client-safe (owner, 27 Oct 2026).
//
// One rule for the uploads that used to fail with a bare "did not upload":
// message photo attachments, admin ad images and refund screenshots — the same
// handling receipts got on 26 Oct. The browser shrinks a photo first
// (prepareUploadImage → lib/payments/receiptPrepare), then refuses anything
// over 4 MB with a clear message; the server refuses the same, and a failed
// request is described in words (too large, the server's reason, or the
// connection), never left unexplained.
//
// 4 MB, not 5: Vercel refuses a request body over about 4.5 MB before our route
// runs, so a 5 MB limit let a 4.5–5 MB photo fail with no reason given.

import { prepareReceiptFile, type Compress } from '@/lib/payments/receiptPrepare'

export const UPLOAD_MAX_BYTES = 4 * 1024 * 1024
export const UPLOAD_MAX_LABEL = '4 MB'

/** "That photo is larger than 4 MB. Please choose a smaller one." */
export function tooLargeMessage(what: string): string {
  return `That ${what} is larger than ${UPLOAD_MAX_LABEL}. Please choose a smaller one.`
}

/** Why a file is refused before sending, or null when it may go. */
export function uploadFileProblem(file: { size: number } | null | undefined, what: string): string | null {
  if (!file || file.size <= 0) return `Choose a ${what} first.`
  if (file.size > UPLOAD_MAX_BYTES) return tooLargeMessage(what)
  return null
}

/** The message for a failed upload request — never a bare "did not upload". */
export function uploadErrorMessage(input: { status?: number | null; error?: string | null; network?: boolean }, what: string): string {
  if (input.network) return `Your ${what} did not upload because the connection dropped. Check your internet and try again.`
  if (input.status === 413) return tooLargeMessage(what)
  const e = (input.error ?? '').trim()
  if (e) return e
  if (input.status && input.status >= 500) return `Your ${what} did not upload because of a problem on our side. Please try again in a minute.`
  return `Your ${what} did not upload. Please try again, or choose a smaller ${what}.`
}

/** Shrink a photo in the browser before upload (a non-image is left as it is). */
export function prepareUploadImage(file: File, compress: Compress): Promise<File> {
  return prepareReceiptFile(file, compress)
}
