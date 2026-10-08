import { NextResponse } from 'next/server'
import { loadSearchDict } from '@/lib/smartSearch'

// GET /api/search/words — the "Search words" per subject (short forms, Roman
// Urdu), keyed by the subject NAME the pickers show (owner, 8 Oct 2026). Public:
// it is the same list the server search already applies, and holds nothing
// private. Cached ten minutes, like the dictionary itself.

export const revalidate = 600

export async function GET() {
  const dict = await loadSearchDict()
  const out: Record<string, string[]> = {}
  for (const s of dict.subjects) {
    // The editable table only (the built-ins were seeded into it).
    const words = dict.aliases.filter((a) => a.kind === 'subject' && a.slug === s.slug).map((a) => a.alias)
    if (words.length) out[s.name.toLowerCase()] = [...new Set(words)]
  }
  return NextResponse.json({ words: out }, { headers: { 'Cache-Control': 'public, max-age=600' } })
}
