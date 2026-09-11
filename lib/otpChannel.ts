// lib/otpChannel.ts
//
// How the mobile verification code is delivered, for MEMBER-FACING COPY ONLY.
//
// Delivery moved from SMS Point (WhatsApp) to SendPK (SMS over a Pakistani short
// code). A tutor watching their phone now sees the code arrive as an ordinary
// SMS from an unfamiliar 7-digit sender, so the copy names that sender —
// otherwise the message reads like it might not be from us. The number is the
// one observed on the handset (8062050); it is deliberately NOT read from
// SENDPK_SENDER, which is advisory and differs (TutorMint's traffic routes
// through this short code regardless of the sender field).
//
// This is the ONE place the short code lives outside a literal sentence, so if
// it ever changes the copy changes here alone and every screen stays true. Pure
// module, no imports, so both server pages and client components can read it.

export const OTP_SMS_SENDER = '8062050'
