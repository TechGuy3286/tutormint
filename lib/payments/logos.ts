// lib/payments/logos.ts
//
// Which payment-method logos exist (owner, 11 Oct 2026). next.config.ts lists
// the files present in public/payments/ at build time; a logo that is not there
// has no src, and the screen shows the text label alone. SVG is preferred.

export type PayLogoName = 'jazzcash' | 'faysal-bank'

export function payLogoSrcFrom(present: string, name: PayLogoName): string | null {
  const files = present.split(',').map((f) => f.trim()).filter(Boolean)
  for (const ext of ['svg', 'png']) {
    if (files.includes(`${name}.${ext}`)) return `/payments/${name}.${ext}`
  }
  return null
}

export function payLogoSrc(name: PayLogoName): string | null {
  return payLogoSrcFrom(process.env.NEXT_PUBLIC_PAY_LOGOS ?? '', name)
}
