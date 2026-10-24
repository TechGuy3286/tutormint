/**
 * scripts/cv-samples.mts — writes sample CV PDFs from invented profiles
 * (scripts/cvFixtures.ts), never a real tutor's details.
 *   npx tsx scripts/cv-samples.mts <out-folder>
 */
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://proj.supabase.co'

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const R = await import('@react-pdf/renderer')
const QRCode = (await import('qrcode')).default
const sharp = (await import('sharp')).default
const { buildCvDocument } = await import('../lib/cv/pdfDocument.tsx')
const { toCvModel } = await import('../lib/cv/model.ts')
const { heavyRaw, sparseRaw, cvRaw, BASE } = await import('./cvFixtures.ts')

const out = process.argv[2]
if (!out) throw new Error('usage: cv-samples.mts <out-folder>')
mkdirSync(out, { recursive: true })

// A plain drawn "photo" (no real person): a soft gradient with a head shape.
const photoSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="480"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#9AE899"/><stop offset="1" stop-color="#2E7D4F"/></linearGradient></defs><rect width="480" height="480" fill="url(#g)"/><circle cx="240" cy="190" r="90" fill="#F1D3B5"/><path d="M80 480c0-110 70-170 160-170s160 60 160 170z" fill="#151E6B"/></svg>`
const photo = `data:image/jpeg;base64,${(await sharp(Buffer.from(photoSvg)).jpeg().toBuffer()).toString('base64')}`
const avatar = `${BASE}/storage/v1/object/public/avatars/sample.jpg`

type Sample = { file: string; raw: ReturnType<typeof cvRaw>; template: 'modern' | 'classic' | 'minimal'; accent: 'navy' | 'green' | 'charcoal'; fee?: boolean }
const samples: Sample[] = [
  { file: 'modern-navy-verified', raw: heavyRaw({ avatarUrl: avatar }), template: 'modern', accent: 'navy', fee: true },
  { file: 'modern-green-verified', raw: heavyRaw({ avatarUrl: avatar }), template: 'modern', accent: 'green' },
  { file: 'modern-charcoal-verified', raw: heavyRaw({ avatarUrl: avatar }), template: 'modern', accent: 'charcoal' },
  { file: 'modern-unverified-hidden-photo', raw: heavyRaw({ avatarUrl: null, photoHidden: true, verified: false, gender: 'female', fullName: 'Ayesha Noor' }), template: 'modern', accent: 'navy' },
  { file: 'modern-sparse', raw: sparseRaw(), template: 'modern', accent: 'navy' },
  { file: 'modern-urdu-about', raw: cvRaw({ avatarUrl: avatar, bio: 'میں طلبہ کو آسان طریقے سے ریاضی اور طبیعیات پڑھاتا ہوں۔ I have 5–10 years of teaching experience.' }), template: 'modern', accent: 'green' },
  { file: 'classic-fixed', raw: heavyRaw({ avatarUrl: avatar }), template: 'classic', accent: 'navy' },
  { file: 'minimal-fixed', raw: heavyRaw({ avatarUrl: avatar }), template: 'minimal', accent: 'navy' },
]

for (const s of samples) {
  const model = toCvModel(s.raw, { includeContact: true, includeFee: s.fee ?? false, includePhoto: true, template: s.template })
  const qr = await QRCode.toDataURL(model.profileUrl, { margin: 1, width: 160, color: { dark: '#151E6B', light: '#FFFFFF' } })
  const doc = buildCvDocument(R, {
    model,
    template: s.template,
    accent: s.accent,
    qrDataUri: qr,
    photoDataUri: model.photo?.kind === 'photo' ? photo : null,
  })
  const pdf = Buffer.from(await R.renderToBuffer(doc))
  writeFileSync(join(out, `${s.file}.pdf`), pdf)
  console.log(join(out, `${s.file}.pdf`), pdf.length)
}
