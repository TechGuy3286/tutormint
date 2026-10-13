/**
 * scripts/report-search-terms.ts — read-only (owner, 13 Oct 2026).
 *
 * What the ONE smart search makes of a typed term, against the live dictionary,
 * and how many listed tutors it then finds. Nothing is written.
 *
 *   npx tsx --conditions=react-server --env-file=.env.local scripts/report-search-terms.ts computer compter maths
 */
import { createClient } from '@supabase/supabase-js'

import { loadSearchDictFresh, resolveWith } from '../lib/smartSearch'
import { parseQuery } from '../lib/smartSearchCore'

async function main() {
  const terms = process.argv.slice(2).filter((a) => !a.startsWith('--'))
  const dict = await loadSearchDictFresh()
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
  console.log(`dictionary: ${dict.cities.length} cities · ${dict.levels.length} levels · ${dict.subjects.length} subjects · ${dict.aliases.length} search words`)
  const like = dict.subjects.filter((s) => /comput|program|coding|\bit\b|office|ict/i.test(s.name)).map((s) => `${s.name} [${s.slug}]`)
  console.log('subjects that read as computer:', like.join(' · ') || '(none)')
  for (const term of terms.length ? terms : ['computer', 'compter', 'maths']) {
    const r = resolveWith(dict, parseQuery(term, dict))
    const ids = r.masterIds ?? r.levelMasterIds ?? []
    let tutors = 0
    if (ids.length) {
      const seen = new Set<string>()
      for (let i = 0; i < ids.length; i += 200) {
        const { data } = await db.from('tutor_subjects').select('tutor_id').in('master_id', ids.slice(i, i + 200)).limit(5000)
        for (const row of data ?? []) seen.add(row.tutor_id as string)
      }
      const all = [...seen]
      for (let i = 0; i < all.length; i += 200) {
        const { count } = await db.from('tutor_directory').select('id', { count: 'exact', head: true }).in('id', all.slice(i, i + 200))
        tutors += count ?? 0
      }
    }
    console.log(
      `"${term}" → understood ${r.understood} · subject ${r.parsed.subject?.name ?? '—'}${(r.parsed as { alsoSubjects?: { name: string }[] }).alsoSubjects?.length ? ` (+ ${(r.parsed as { alsoSubjects?: { name: string }[] }).alsoSubjects!.map((s) => s.name).join(', ')})` : ''} · level ${r.parsed.levelLabel ?? '—'} · city ${r.parsed.city ?? '—'} · ${ids.length} taxonomy rows · ${tutors} listed tutors`,
    )
  }
}

void main()
