import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import { PAYPRO_CUTOFF_KEY, parsePayproCutoff } from '@/lib/payments/payproRetireCore'

// Reads the PayPro cut-off day (app_settings 'pay.paypro.cutoff', migration 200).
// A failed read falls back to the default day, never to "always activate".
export async function loadPayproCutoff(): Promise<string> {
  const admin = createAdminClient()
  if (!admin) return parsePayproCutoff(null)
  const { data } = await admin.from('app_settings').select('value').eq('key', PAYPRO_CUTOFF_KEY).maybeSingle()
  return parsePayproCutoff((data?.value as string | null) ?? null)
}
