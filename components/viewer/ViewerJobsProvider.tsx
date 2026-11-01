'use client'

import { createContext, useContext, useEffect, useState } from 'react'
import { useHeaderSession } from '@/components/session/HeaderSessionProvider'
import { viewerJobIds, type ViewerJobsPayload } from '@/lib/viewerJobsCore'

// Job cards on a cached public page (push 3, owner 1 Nov 2026). The page is the
// same for everyone; when the visitor turns out to be signed in, this asks
// /api/viewer/jobs once for the cards on screen and the cards adjust: Apply
// state, the saved heart, the online chip, Apply hidden for a parent. A guest
// makes no request.

type Value = { payload: ViewerJobsPayload | null; chip: boolean; save: boolean; hideGender: boolean }
const Ctx = createContext<Value>({ payload: null, chip: false, save: false, hideGender: false })

/** `chip`: the cards show the "Suitable for online" chip for a tutor (the blog
 *  block did before push 3; the city hubs did not). `save`: a tutor gets the
 *  saved heart (the city hubs' loaded cards had it). `hideGender`: a tutor
 *  does not see tuitions asking for another gender (the tuition page's similar
 *  list was gender-filtered before push 3). */
export default function ViewerJobsProvider({ ids, chip = false, save = false, hideGender = false, children }: { ids: string[]; chip?: boolean; save?: boolean; hideGender?: boolean; children: React.ReactNode }) {
  const session = useHeaderSession()
  const [payload, setPayload] = useState<ViewerJobsPayload | null>(null)
  const key = viewerJobIds(ids).join(',')

  useEffect(() => {
    // Signed out: nothing to ask; the value below reads null (no state reset).
    if (session.status !== 'signed-in') return
    let live = true
    fetch(`/api/viewer/jobs?ids=${encodeURIComponent(key)}`, { cache: 'no-store', credentials: 'same-origin' })
      .then((r) => r.json() as Promise<ViewerJobsPayload>)
      .then((p) => live && setPayload(p))
      .catch(() => {})
    return () => {
      live = false
    }
  }, [session.status, key])

  return <Ctx.Provider value={{ payload: session.status === 'signed-in' ? payload : null, chip, save, hideGender }}>{children}</Ctx.Provider>
}

/** The viewer's side of the job cards, or null for a guest / while loading. */
export function useViewerJobs(): Value {
  return useContext(Ctx)
}
