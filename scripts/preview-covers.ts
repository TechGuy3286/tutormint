/**
 * scripts/preview-covers.ts — writes sample composed covers to a folder so the
 * fixed layout can be looked at without the admin editor. Offline: it reads the
 * house illustration library and the clean logo from public/.
 *   npx tsx scripts/preview-covers.ts <out-dir>
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { coverAsset } from '../lib/covers/catalog'
import { renderCoverPng } from '../lib/covers/compose'
import { coverJpeg } from '../lib/covers/encode'
import { selectCover, type CoverInput } from '../lib/covers/select'

const uri = (file: string) => `data:image/png;base64,${readFileSync(file).toString('base64')}`
const asset = (slug: string | null) => {
  const a = coverAsset(slug)
  return a ? uri(path.join(process.cwd(), 'public', 'covers', a.file)) : null
}

const POSTS: (CoverInput & { name: string })[] = [
  { name: 'islamiat', title: 'How to find a good Primary Islamiat tutor in Lahore', cluster: 'subject-guides', city: 'Lahore', subject: 'Primary Islamiat', audience: 'parents', slug: 'islamiat' },
  { name: 'exam', title: 'O and A Level October–November exam prep, 2026', cluster: 'boards-exams', city: null, subject: null, audience: 'both', slug: 'exam' },
  { name: 'career', title: 'How to become a home tutor in Pakistan: a step-by-step start', cluster: 'tutor-career', city: null, subject: null, audience: 'tutors', slug: 'career' },
]

async function main() {
  const out = process.argv[2]
  if (!out) throw new Error('give an output folder')
  mkdirSync(out, { recursive: true })
  const logo = uri(path.join(process.cwd(), 'public', 'brand', 'tutormint-logo-640.png'))
  for (const p of POSTS) {
    for (const seed of [0, 1, 2]) {
      const sel = selectCover(p, seed)
      const res = renderCoverPng({ title: p.title, selection: sel, assets: { city: asset(sel.citySlug), person: asset(sel.personSlug), motifs: sel.motifs.map(asset), logo } })
      const jpg = await coverJpeg(new Uint8Array(await res.arrayBuffer()))
      const file = path.join(out, `${p.name}-${seed}.jpg`)
      writeFileSync(file, jpg)
      console.log(file, `${Math.round(jpg.length / 1024)} KB`, sel.scene, sel.personSlug, sel.motifs.join('+'))
    }
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
