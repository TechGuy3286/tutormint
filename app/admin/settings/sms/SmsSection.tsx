import { loadSmsHealth } from '@/lib/smsLog'
import SmsHealthView from './SmsHealthView'

// Messaging → SMS (owner, 31 Oct 2026): loads the SMS log; the markup is SmsHealthView.
export default async function SmsSection({ canSend }: { canSend: boolean }) {
  return <SmsHealthView h={await loadSmsHealth()} canSend={canSend} />
}
