import { loadEmailHealth } from '@/lib/emailHealth'
import EmailHealthView from './EmailHealthView'

// Messaging → Email (owner, 31 Oct 2026): loads the send log; the markup is EmailHealthView.
export default async function EmailSection() {
  return <EmailHealthView h={await loadEmailHealth()} />
}
