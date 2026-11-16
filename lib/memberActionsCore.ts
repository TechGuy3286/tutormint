// lib/memberActionsCore.ts
//
// WHICH ACTIONS A STAFF ROLE GETS ON A MEMBER'S ADMIN PAGE (owner, 15 Nov
// 2026). PURE — the member page (which buttons show) and the members route
// (what it accepts) read the same answers, and scripts/test-staff-rights.ts
// checks them per role.
//
//   Contact (Message, WhatsApp, Call — logged as follow-ups): every role that
//     opens member pages.
//   Warn: every role that works members, Backend Support included.
//   Verify a mobile manually (the SMS code failed; it marks the number on file
//     as verified and never changes it): Project Managers, Managers, Admin,
//     Operations and Backend Support.
//   Edit name, documents and subjects: the tutor-edit roles, Backend Support
//     included. The mobile and the CNIC number stay Owner-only.
//   Create a parent account (for a tutor): Admin and Backend Support (and the
//     Owner). Backend Support may create a PARENT account only.
//   Suspend, reinstate, ban, lift a ban, change a mobile, edit the CNIC number,
//     grant or revoke a plan: the Owner ONLY.

import { canModerateAccounts, roleMayWrite, roleSatisfies, SCREEN_ACCESS, type AdminRole } from '@/lib/adminAccessCore'

export type MemberAction = 'warn' | 'suspend' | 'unsuspend' | 'ban' | 'unban' | 'verify-mobile' | 'change-mobile'

/** The member-route actions only the Owner may take. */
export const OWNER_ONLY_MEMBER_ACTIONS = ['suspend', 'unsuspend', 'ban', 'unban', 'change-mobile'] as const satisfies readonly MemberAction[]

/** May this role take this action through /api/admin/members? */
export function memberActionAllowed(role: AdminRole | null | undefined, action: MemberAction): boolean {
  if (!role) return false
  if ((OWNER_ONLY_MEMBER_ACTIONS as readonly string[]).includes(action)) return canModerateAccounts(role)
  if (action === 'warn') return roleMayWrite(role, SCREEN_ACCESS.memberWarn)
  if (action === 'verify-mobile') return roleMayWrite(role, SCREEN_ACCESS.memberVerifyMobile)
  return false
}

export type MemberPageActions = {
  contact: boolean
  warn: boolean
  suspendBan: boolean
  verifyMobile: boolean
  changeMobile: boolean
  editProfile: boolean
  /** The edit button's words: the mobile is named only for the Owner. */
  editLabel: string
  editMobileAndCnic: boolean
  grantPlans: boolean
  /** Create the other role's account; Backend Support may only make a parent. */
  createSecondRole: (toRole: 'tutor' | 'parent' | null) => boolean
}

export const EDIT_LABEL_OWNER = 'Edit name, mobile, documents and subjects'
export const EDIT_LABEL_STAFF = 'Edit name, documents and subjects'

export function memberPageActions(role: AdminRole | null | undefined, memberRole: string | null | undefined): MemberPageActions {
  const r = role ?? null
  const isMember = memberRole === 'tutor' || memberRole === 'parent' || memberRole === 'academy'
  const owner = r === 'owner'
  const editProfile =
    !!r && isMember && (memberRole === 'tutor' ? roleMayWrite(r, SCREEN_ACCESS.tutorEdit) : roleMayWrite(r, [...SCREEN_ACCESS.parents, 'backend_support']))
  return {
    contact: !!r && roleSatisfies(r, SCREEN_ACCESS.usersView),
    warn: !!r && roleMayWrite(r, SCREEN_ACCESS.memberWarn),
    suspendBan: owner,
    verifyMobile: !!r && roleMayWrite(r, SCREEN_ACCESS.memberVerifyMobile),
    changeMobile: owner,
    editProfile,
    editLabel: owner ? EDIT_LABEL_OWNER : EDIT_LABEL_STAFF,
    editMobileAndCnic: owner,
    grantPlans: owner,
    createSecondRole: (toRole) => {
      if (!r || !toRole || !roleMayWrite(r, SCREEN_ACCESS.secondRole)) return false
      return r === 'backend_support' ? toRole === 'parent' : true
    },
  }
}

/** The parent-name screen a role must be able to write (the members name route). */
export function nameEditScreen(memberRole: string | null | undefined): AdminRole[] {
  return memberRole === 'tutor' ? SCREEN_ACCESS.tutorEdit : [...SCREEN_ACCESS.parents, 'backend_support']
}
