// scripts/screenshots/oct28-entry.tsx — the 28 Oct 2026 PR's screenshots,
// rendered in a browser from the REAL components, with INVENTED data only (no
// member's name, phone or address). Bundled by scripts/screenshots/oct28.mjs;
// window.fetch is answered from fixtures, nothing reaches a server.
import React from 'react'
import { createRoot } from 'react-dom/client'
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime'
import { PathnameContext, SearchParamsContext } from 'next/dist/shared/lib/hooks-client-context.shared-runtime'
import { ToastProvider } from '@/components/ui/Toast'
import { ConfirmProvider } from '@/components/ui/ConfirmDialog'
import { AdminReadOnlyProvider } from '@/components/admin/ReadOnly'
import ApplicationsClient from '@/app/admin/applications/ApplicationsClient'
import LocationsReviewClient from '@/app/admin/seo/locations/LocationsReviewClient'
import ProfileShareButtons from '@/components/admin/ProfileShareButtons'
import { applicationsView } from '@/lib/applicationsPagingCore'
import { DAY_MS } from '@/lib/applicationStageCore'
import { bucketArea, bucketSuggestion } from '@/lib/locationBucketsCore'
import { fillShareMessage, PROFILE_SHARE_DEFAULT, shareMessageHref } from '@/lib/profileShareCore'

const which = ((window as unknown as { __SHOT?: string }).__SHOT) ?? 'apps'
const NOW = Date.UTC(2026, 9, 28, 9, 0, 0)
const ago = (ms: number) => new Date(NOW - ms).toISOString()
const FIRST = ['Areeba', 'Bilal', 'Hamza', 'Iqra', 'Junaid', 'Kinza', 'Laiba', 'Moiz', 'Noor', 'Omer', 'Rabia', 'Saad']
const LAST = ['Akhtar', 'Baig', 'Chaudhry', 'Durrani', 'Farooq', 'Gill', 'Hashmi', 'Iqbal']
const CITIES = ['Lahore', 'Karachi', 'Islamabad', 'Rawalpindi']
const TITLES = ['Female Home Tutor Required | Grade 1–5', 'Online Tutor Required | O Levels', 'Home Tutor Required | Matric', 'Primary Teacher Required | Grade 3']

// ---- Applications: 40 invented tuitions, two applications each.
type Row = Parameters<typeof applicationsView>[0]['rows'][number] & Record<string, unknown>
const rows: Row[] = []
for (let j = 0; j < 40; j++) {
  for (let k = 0; k < 2; k++) {
    const n = j * 2 + k
    rows.push({
      id: `a${n}`,
      jobId: `j${j}`,
      tutorId: `t${n}`,
      tutorName: `${FIRST[n % FIRST.length]} ${LAST[n % LAST.length]}`,
      tutorSlug: `sample-tutor-${n}`,
      tutorPhone: '0300•••••00',
      tutorVerified: n % 3 === 0,
      jobRef: `TM-${2100 + j}`,
      jobTitle: TITLES[j % TITLES.length],
      jobCity: CITIES[j % CITIES.length],
      jobPath: `/tuitions/lahore/sample-${j}`,
      ownerId: j % 2 ? 'staff-a' : 'staff-b',
      ownerName: j % 2 ? 'Staff A' : 'Staff B',
      stage: k === 0 ? 'applied' : 'forwarded',
      stageChangedAt: ago((k === 0 ? 2 : 4) * DAY_MS),
      stageChangedByName: null,
      workedAt: null,
      workedByName: null,
      createdAt: ago(2 * DAY_MS),
      jobCreatedAt: ago(5 * DAY_MS),
      followUps: [],
      hasParentNumber: true,
      consentRecorded: true,
      consentLabel: 'Recorded',
    } as unknown as Row)
  }
}
const appsView = applicationsView({
  rows,
  nowMs: NOW,
  staffFilter: 'all',
  stageFilter: 'any',
  tab: 'todo',
  view: 'tuition',
  q: '',
  shown: 25,
  olderShown: 25,
  viewedShown: 25,
  forwardCards: [],
  names: new Map([['staff-a', 'Staff A'], ['staff-b', 'Staff B']]),
  actor: { id: 'owner', adminRole: 'owner' },
})

// ---- Locations: invented typed values, bucketed by the real rule.
const AREAS: Record<string, string[]> = {
  karachi: ['Lyari', 'Gulshan-e-Iqbal', 'North Nazimabad', 'Buffer Zone', 'Clifton'],
  lahore: ['Johar Town', 'Model Town', 'Harbanspura', 'DHA Lahore', 'Bahria Town Lahore'],
}
const TYPED: [string, string][] = [
  ['Liyari', 'Karachi'],
  ['Gulshan e Iqbal block 7', 'Karachi'],
  ['Johar town phase 2', 'Lahore'],
  ['North Nazimabad Block H', 'Karachi'],
  ['Valencia Town', 'Lahore'],
  ['Wapda Town Extension', 'Lahore'],
  ['0300 1234567', 'Lahore'],
  ['House 5 Street 9', 'Karachi'],
]
const reviewRows = TYPED.map(([value, city], i) => {
  const b = bucketArea({ value, city, areas: AREAS[city.toLowerCase()] ?? [], cities: CITIES })
  return {
    key: `${city}|${value}`.toLowerCase(),
    value,
    city,
    count: 3 + (i % 4),
    openTuitions: 1 + (i % 3),
    cityListed: true,
    suggestion: bucketSuggestion(b, value, city),
    bucket: b.bucket,
    confidence: b.confidence,
  }
})
const counts = {
  same: reviewRows.filter((r) => r.suggestion.action === 'same').length,
  notArea: reviewRows.filter((r) => r.suggestion.action === 'not_area').length,
  add: reviewRows.filter((r) => r.suggestion.action === 'add').length,
  aliases: 0,
  ignored: 0,
}
const areasByCity = Object.fromEntries(Object.entries(AREAS).map(([c, list]) => [c, list.map((name, id) => ({ id, name }))]))
window.fetch = (async (input: RequestInfo | URL) => {
  const url = String(input)
  if (url.includes('/api/admin/locations')) {
    return new Response(JSON.stringify({ rows: reviewRows, total: reviewRows.length, counts, areasByCity }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
}) as typeof fetch

// ---- Share message preview.
const link = 'https://www.tutormint.org/tutor/sample-tutor'
const verifiedMsg = fillShareMessage(PROFILE_SHARE_DEFAULT, { name: 'Areeba Akhtar', city: 'Lahore', subjects: ['English', 'Mathematics', 'Physics'], link, verified: true })
const unverifiedMsg = fillShareMessage(PROFILE_SHARE_DEFAULT, { name: 'Bilal Baig', city: 'Karachi', subjects: ['Chemistry'], link, verified: false })
const decoded = (m: string) => decodeURIComponent(shareMessageHref({ url: link, message: m }, 'AQSA')!.split('text=')[1])

function Share() {
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-black text-tm-navy">Share on WhatsApp — message preview</h2>
      {[
        ['Verified tutor', verifiedMsg],
        ['Tutor without the Verified badge', unverifiedMsg],
      ].map(([label, m]) => (
        <section key={label} className="space-y-2 rounded-2xl border border-gray-200 bg-white p-4">
          <p className="text-xs font-bold text-gray-600">{label} — shared by a staff member with code AQSA</p>
          <ProfileShareButtons share={{ url: link, disabledReason: null, message: m }} />
          <pre className="whitespace-pre-wrap rounded-xl bg-tm-tint-green p-3 font-sans text-sm text-slate-800">{decoded(m)}</pre>
        </section>
      ))}
    </div>
  )
}

const router = { push() {}, replace() {}, refresh() {}, back() {}, forward() {}, prefetch() {} }
const path = which === 'locations' ? '/admin/seo/locations' : which === 'share' ? '/admin/users/x' : '/admin/applications'
createRoot(document.getElementById('root')!).render(
  <AppRouterContext.Provider value={router as never}>
    <SearchParamsContext.Provider value={new URLSearchParams() as never}>
      <PathnameContext.Provider value={path}>
        <ToastProvider>
          <ConfirmProvider>
            <AdminReadOnlyProvider readOnly={false} refCode="AQSA" canApprove>
              {which === 'locations' ? (
                <LocationsReviewClient initialCounts={counts} />
              ) : which === 'share' ? (
                <Share />
              ) : (
                <ApplicationsClient
                  view={appsView as never}
                  staff={[{ id: 'staff-a', name: 'Staff A' }, { id: 'staff-b', name: 'Staff B' }]}
                  actor={{ id: 'owner', adminRole: 'owner' }}
                  staffFilter={'all' as never}
                  stageFilter="any"
                  tab="todo"
                  listView={'tuition' as never}
                  initialQuery=""
                  nowMs={NOW}
                  forwardTemplate="Assalam o Alaikum {parent_name}, tutors for {tuition_title}: {tutor_list}"
                  canOpenMembers
                />
              )}
            </AdminReadOnlyProvider>
          </ConfirmProvider>
        </ToastProvider>
      </PathnameContext.Provider>
    </SearchParamsContext.Provider>
  </AppRouterContext.Provider>,
)
