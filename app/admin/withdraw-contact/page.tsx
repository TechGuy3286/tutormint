import { redirect } from 'next/navigation'

import { requireAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { canApprove } from '@/lib/adminAccessCore'
import { consentReport, loadDoNotUseList, loadHoldList } from '@/lib/contactWithdraw'
import { CONSENT_UI_ENABLED } from '@/lib/tuitionConsentCore'
import WithdrawContactClient from './WithdrawContactClient'

// Trust → Withdraw a contact (owner, 27 Oct 2026). The site Owner ONLY: a
// person whose number was put on tuitions without their consent asks for it to
// be removed. Search a number, see every place it is stored (masked), withdraw
// it, and manage the Do not use list. Below: how many tuitions each staff
// member posted with a parent number that belongs to no account (counts only).

export const dynamic = 'force-dynamic'

export default async function WithdrawContactPage() {
  const actor = await requireAdminRole(...SCREEN_ACCESS.contactWithdraw)
  if (!canApprove(actor.adminRole)) redirect('/admin')
  const [list, holds, report] = await Promise.all([loadDoNotUseList(), loadHoldList(), CONSENT_UI_ENABLED ? consentReport() : Promise.resolve([])])
  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 sm:p-6">
      <header>
        <h1 className="text-2xl font-extrabold text-tm-navy">Withdraw a contact</h1>
        <p className="mt-1 text-sm text-gray-600">
          Find every tuition and record using a phone number. Pause all their tuitions while a complaint is checked, or remove the
          number permanently. Numbers are only ever shown masked.
        </p>
      </header>
      <WithdrawContactClient initialList={list} initialHolds={holds} report={report} />
    </div>
  )
}
