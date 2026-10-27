import { requireAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { loadReaderState } from '@/lib/bankEmailReader'
import { readerFailingAlert } from '@/lib/bankEmailCore'
import { loadPayproCutoff } from '@/lib/payments/payproCutoff'

import ReaderSwitch from './ReaderSwitch'
import FinanceSettingsView from './FinanceSettingsView'
import FeeRangeForm from './FeeRangeForm'
import { loadFeePrice, loadFeeRange } from '@/lib/feeMatch'

// Admin → Finance → Settings (owner, 26 Oct 2026). OWNER ONLY (the Partner
// views; SCREEN_ACCESS.finance = []). The Faysal Bank email reader's switch —
// OFF by default — and its status, plus the PayPro cut-off day. Never shows a
// mailbox setting: only whether each one is set.

export const dynamic = 'force-dynamic'

export default async function FinanceSettingsPage() {
  await requireAdminRole(...SCREEN_ACCESS.finance)
  const [s, cutoff, range, price] = await Promise.all([loadReaderState(), loadPayproCutoff(), loadFeeRange(), loadFeePrice()])
  const red = readerFailingAlert(s, new Date())

  return (
    <FinanceSettingsView s={s} cutoff={cutoff} red={red} switchNode={<ReaderSwitch enabled={s.enabled} configured={s.configured} />}
      feeRangeNode={<FeeRangeForm min={range.min} max={range.max} price={price} />}
    />
  )
}
