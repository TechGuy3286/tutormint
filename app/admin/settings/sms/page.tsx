import { permanentRedirect } from 'next/navigation'

// Merged into Admin → Settings → Messaging (owner, 31 Oct 2026).
export default function RetiredMessagingPage() {
  permanentRedirect('/admin/settings/messaging#sms')
}
