'use client'

import { createContext, useContext } from 'react'
import { usePathname } from 'next/navigation'

import { partnerEditsPath } from '@/lib/adminAccessCore'

// View-only admin screens (owner, 13 Oct 2026): the Partner — shown as "Project
// Manager" — edits tutors, parents and tuitions, and can open but not change
// everything else.
//
// PRESENTATION ONLY. The rule itself is enforced on the server — checkAdminRole
// answers 403 to a Partner on every non-GET request for an area whose access
// list does not name the role (lib/adminAccessCore roleMayWrite), and the
// database write policies for those areas exclude the role (migration 170).
// This file only hides the controls that would write, so a Partner is not
// offered a door that is locked:
//
//   useAdminReadOnly()   true when THIS session cannot change THIS page
//   <WriteOnly>…         renders its children only when the session can write
//
// The layout provides the flag once for the whole admin area; which pages are
// view-only comes from the page's own address (partnerEditsPath).

const PartnerContext = createContext(false)

export const PARTNER_VIEW_ONLY_TEXT = 'View only. Your account cannot change this.'

export function AdminReadOnlyProvider({ readOnly, children }: { readOnly: boolean; children: React.ReactNode }) {
  return <PartnerContext.Provider value={readOnly}>{children}</PartnerContext.Provider>
}

/** True when this admin session cannot change anything on the current page. */
export function useAdminReadOnly(): boolean {
  const limited = useContext(PartnerContext)
  const pathname = usePathname()
  return limited && !partnerEditsPath(pathname)
}

/** Renders its children only when this admin session may change things here. */
export function WriteOnly({ children, fallback = null }: { children: React.ReactNode; fallback?: React.ReactNode }) {
  return useAdminReadOnly() ? <>{fallback}</> : <>{children}</>
}

/** One line shown in place of a write-only screen (Bulk import, a new post…). */
export function ViewOnlyNotice({ what }: { what?: string }) {
  return (
    <p className="rounded-2xl border border-gray-200 bg-white p-4 text-center text-xs font-bold text-tm-navy">
      {what ? `${what} — ` : ''}View only. Nothing can be changed here from your account.
    </p>
  )
}

/** The small "View only" chip a view-only screen shows at its top. */
export function ViewOnlyChip() {
  if (!useAdminReadOnly()) return null
  return (
    <p className="mb-3 inline-flex items-center rounded-full bg-tm-tint-navy px-3 py-1 text-[11px] font-bold text-tm-navy">
      View only — you can open and read this page; buttons that change things are switched off for your account.
    </p>
  )
}
