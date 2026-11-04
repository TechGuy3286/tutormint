// scripts/screenshots/editprofile-entry.tsx — the 4 Nov 2026 Edit Profile PR's
// screenshots, rendered in a browser from the REAL components with INVENTED
// data only (no member's name, phone, CNIC or email). Bundled by
// scripts/screenshots/editprofile.mjs; Supabase and window.fetch are answered
// from fixtures, nothing reaches a server.
import React from 'react'
import { createRoot } from 'react-dom/client'
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime'
import { PathnameContext, SearchParamsContext } from 'next/dist/shared/lib/hooks-client-context.shared-runtime'
import { ToastProvider } from '@/components/ui/Toast'
import { ConfirmProvider } from '@/components/ui/ConfirmDialog'
import { AdminReadOnlyProvider } from '@/components/admin/ReadOnly'
import TutorSettingsPage from '@/app/(site)/tutor/dashboard/settings/page'
import TutorDocumentReview from '@/components/admin/TutorDocumentReview'
import NameChangeCheck from '@/components/admin/NameChangeCheck'
import MemberHeaderNav from '@/components/MemberHeaderNav'

const which = ((window as unknown as { __SHOT?: string }).__SHOT) ?? 'edit'

const face = (bg: string, shirt: string) =>
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><rect width="96" height="96" fill="${bg}"/><circle cx="48" cy="38" r="17" fill="#c8a07e"/><path d="M20 96c2-22 14-32 28-32s26 10 28 32z" fill="${shirt}"/></svg>`,
  )
const OLD_PHOTO = face('#E8EAF5', '#151E6B')
const NEW_PHOTO = face('#EEFBEE', '#2E7D4F')
const DOC = (label: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 100"><rect width="160" height="100" rx="8" fill="#E8EAF5"/><text x="80" y="55" font-size="13" text-anchor="middle" fill="#151E6B" font-family="sans-serif">${label} (sample)</text></svg>`

const LOCKS = { cnicFront: 'locked', cnicBack: 'locked', selfie: 'open', photo: 'waiting' }
;(window as unknown as { __FIXTURES: unknown }).__FIXTURES = {
  profiles: [{ phone_number: '923001234567', phone_verified_at: '2026-10-01T09:00:00Z', email: 'ayesha.example@gmail.com', email_verified: true, whatsapp: '923001234567', avatar_pending_url: NEW_PHOTO }],
  tutor_profiles: [
    {
      full_name: 'Ayesha Example', city: 'Lahore', area: 'Johar Town', job_types: ['Home Tutor'], avatar_url: OLD_PHOTO,
      headline: 'Patient maths tutor for Grades 6 to 10', bio: 'I explain each step slowly and check understanding.',
      experience_years: 5, fee_min_pkr: 8000, fee_max_pkr: 15000, verified_fee_paid_at: '2026-10-02T09:00:00Z',
      show_avatar: true, gender: 'female', degrees: [], certifications: [], availability: [],
    },
  ],
  tutor_subjects: [],
  tutor_areas: [{ city: 'Lahore', area: 'Johar Town' }],
  user_documents: [],
  job_titles: [{ name: 'Home Tutor', sort_order: 1 }, { name: 'Online Tutor', sort_order: 2 }],
  location_cities: [],
  location_areas: [],
}

const STATUSES = {
  cnic: { status: 'approved', reason: null, hasUpload: true },
  profilePic: { status: 'pending', reason: null, hasUpload: true, rereview: true },
  selfie: { status: 'approved', reason: null, hasUpload: true },
  locks: LOCKS,
}
const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200, headers: { 'content-type': 'application/json' } })
window.fetch = (async (input: RequestInfo | URL) => {
  const u = String(input)
  if (u.includes('/api/identity/cnic-suggestion')) return json({})
  if (u.includes('/api/identity')) return json({ identity: { cnicNumber: '3520100000001', state: 'approved', verifiedAt: '2026-10-03', addressVerifiedAt: null, rejectionReason: null, front: { id: 'd1', side: 'front', uploadedAt: '2026-10-01' }, back: { id: 'd2', side: 'back', uploadedAt: '2026-10-01' } } })
  if (u.includes('/api/tutor/document-status')) return json(STATUSES)
  if (u.includes('/api/documents/locks')) return json(LOCKS)
  if (u.includes('/preview')) {
    const label = u.includes('d9') ? 'New selfie' : u.includes('d3') ? 'Selfie' : u.includes('d2') ? 'CNIC back' : 'CNIC front'
    return new Response(new Blob([DOC(label)], { type: 'image/svg+xml' }), { status: 200 })
  }
  return json({})
}) as typeof fetch

const router = { push() {}, replace() {}, refresh() {}, back() {}, forward() {}, prefetch() {}, hmrRefresh() {} }

function Queue() {
  return (
    <div className="space-y-4">
      <nav className="text-xs text-gray-500">Admin › People › Ayesha Example (sample)</nav>
      <NameChangeCheck tutorId="00000000-0000-4000-8000-000000000001" from="Ayesha Example" to="Ayesha Khan Example" since="2026-11-04T08:30:00Z" />
      <TutorDocumentReview
        tutorId="00000000-0000-4000-8000-000000000001"
        canReview
        avatarUrl={OLD_PHOTO}
        pendingAvatarUrl={NEW_PHOTO}
        cnicFrontId="d1"
        cnicBackId="d2"
        selfieDocId="d3"
        statuses={STATUSES as never}
        memberWhatsapp="923001234567"
        lockInfo={{ review: { cnicFrontId: null, cnicBackId: null, selfieId: 'd9' }, unlockOpen: { cnic: false, selfie: false, photo: false }, lockable: { cnic: true, selfie: false, photo: false } }}
        canUnlock
        cnicNumberMasked="XXXXX-XXXXXXX-1"
      />
    </div>
  )
}

function Header() {
  return (
    <div className="flex items-center justify-end gap-2 rounded-2xl border border-gray-200 bg-white p-3">
      <MemberHeaderNav settingsHref="/tutor/dashboard/settings" />
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <AppRouterContext.Provider value={router as never}>
    <SearchParamsContext.Provider value={new URLSearchParams() as never}>
      <PathnameContext.Provider value={which === 'queue' ? '/admin/users/x' : '/tutor/dashboard/settings'}>
        <ToastProvider>
          <ConfirmProvider>
            <AdminReadOnlyProvider readOnly={false} refCode={null} canApprove>
              {which === 'queue' ? <Queue /> : which === 'header' ? <Header /> : <TutorSettingsPage />}
            </AdminReadOnlyProvider>
          </ConfirmProvider>
        </ToastProvider>
      </PathnameContext.Provider>
    </SearchParamsContext.Provider>
  </AppRouterContext.Provider>,
)

// Open one tile for the locked-card shots, after the page has loaded.
const open = (which === 'locked-mobile' && 'Mobile number') || (which === 'locked-cnic' && 'CNIC (number and pictures)') || (which === 'photo' && 'Profile picture') || null
if (open) {
  setTimeout(() => {
    const btn = [...document.querySelectorAll('button[aria-expanded]')].find((b) => b.textContent?.includes(open)) as HTMLButtonElement | undefined
    btn?.click()
  }, 600)
}
