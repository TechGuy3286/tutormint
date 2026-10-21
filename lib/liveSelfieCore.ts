// lib/liveSelfieCore.ts
//
// The selfie is a LIVE photo (owner, 21 Oct 2026) — the PURE rules behind
// components/tutor/LiveSelfieCapture. The selfie proves a real person matches
// the CNIC, so it is taken with the device camera now: no gallery, no file
// upload, on onboarding and in Settings (also after an Owner unlock).
//
//   • phone            → the front camera opens directly (`capture="user"`);
//   • computer         → a live webcam preview: Take photo → Retake / Use this photo;
//   • no camera / denied → "Please open this step on your phone…", the page
//                          link and a QR code. No upload fallback.

export const SELFIE_HELPER = 'Take a clear photo of your face now — no filters, no old photos.'
export const SELFIE_NO_CAMERA = 'Please open this step on your phone to take your selfie'

/**
 * A photo the phone camera just took is minutes old at most. Some phone
 * browsers ignore `capture` and show a file chooser; a file last changed longer
 * ago than this is an old photo, not a selfie taken now.
 */
export const FRESH_PHOTO_MS = 15 * 60_000
export const OLD_PHOTO_MESSAGE = 'Please take a new photo with your camera now — an old photo can’t be used as a selfie.'

export function isFreshPhoto(lastModified: number | undefined, now = Date.now()): boolean {
  if (!lastModified || !Number.isFinite(lastModified)) return true
  return now - lastModified <= FRESH_PHOTO_MS
}

/** A phone or tablet: a touch-first device whose browser opens the camera
 *  from a `capture` input. */
export function isPhoneDevice(userAgent: string, coarsePointer: boolean): boolean {
  return coarsePointer && /Android|iPhone|iPad|iPod|Mobile|Silk|Opera Mini/i.test(userAgent)
}

export type SelfieMode = 'phone' | 'webcam' | 'no_camera'

/** Which way the selfie is taken on this device. */
export function selfieMode(args: { phone: boolean; mediaDevices: boolean }): SelfieMode {
  if (args.phone) return 'phone'
  return args.mediaDevices ? 'webcam' : 'no_camera'
}
