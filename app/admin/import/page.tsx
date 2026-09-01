import { requireAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import ImportClient from './ImportClient'

// Bulk tutor import. owner / manager.
//
// The screen is two clearly separated steps because the consequences are very
// different: checking a file changes nothing, and importing it creates real
// accounts with real credentials that get sent to real people over WhatsApp.
// Nothing here imports on the first click.

export const dynamic = 'force-dynamic'

export default async function AdminImportPage() {
  await requireAdminRole(...SCREEN_ACCESS.import)
  return <ImportClient />
}
