'use client'

// The subject pickers' half of the ONE smart search (owner, 8 Oct 2026): Post a
// tuition, onboarding and the profile editors match what is typed against the
// subject name AND its Search words (math → Mathematics, hisab, fizics…), with
// the same typo tolerance the Browse search uses. The words load once per page.

import { useEffect, useState } from 'react'
import { subjectMatches, BUILTIN_SUBJECT_WORDS } from '@/lib/smartSearchCore'

type Words = Record<string, string[]>

let cache: Words | null = null
let inflight: Promise<Words> | null = null

function builtinByName(): Words {
  // Before the list loads, the built-in words still work for the common names.
  const out: Words = {}
  const names: Record<string, string> = {
    mathematics: 'mathematics', english: 'english', physics: 'physics', chemistry: 'chemistry', biology: 'biology',
    'computer-science': 'computer science', 'pakistan-studies': 'pakistan studies',
  }
  for (const [slug, words] of Object.entries(BUILTIN_SUBJECT_WORDS)) if (names[slug]) out[names[slug]] = words
  return out
}

export function loadSubjectWords(): Promise<Words> {
  if (cache) return Promise.resolve(cache)
  if (!inflight) {
    inflight = fetch('/api/search/words')
      .then((r) => (r.ok ? r.json() : { words: {} }))
      .then((j: { words?: Words }) => (cache = { ...builtinByName(), ...(j.words ?? {}) }))
      .catch(() => (cache = builtinByName()))
  }
  return inflight
}

export function useSubjectWords(): Words {
  const [w, setW] = useState<Words>(() => cache ?? builtinByName())
  useEffect(() => {
    let live = true
    loadSubjectWords().then((x) => live && setW(x))
    return () => {
      live = false
    }
  }, [])
  return w
}

/** Does this subject name match what was typed (name, Search words, typos)? */
export function matchSubject(typed: string, name: string, words: Words): boolean {
  return subjectMatches(typed, name, words[name.toLowerCase()] ?? [])
}
