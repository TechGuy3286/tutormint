import { NextResponse } from 'next/server'
import { cronAuthorised } from '@/lib/internalAuth'
import { readCnicFromDocument } from '@/lib/cnicReader'
import { maskToLast4 } from '@/lib/cnicReaderCore'
import { parseBody, z, uuid } from '@/lib/validate'

// POST /api/internal/suggest-cnic-numbers — the backlog run of the CNIC reader,
// driven by scripts/suggest-cnic-numbers.ts (owner, 10 Oct 2026).
// CRON_SECRET-protected. It exists because the Claude API key lives only in
// the production environment: the SCRIPT decides which documents (members in
// the approval queue with a CNIC front and no number) and this route reads ONE.
//
// The result is stored only as the document's SUGGESTED value (cnic_read_*),
// which the review card pre-fills — never as the member's CNIC number. The
// response carries the number masked to its last 4 digits; the full number is
// neither returned nor logged.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const Body = z.object({ documentId: uuid })

export async function POST(request: Request) {
  if (!cronAuthorised(request)) return NextResponse.json({ error: 'Unauthorised.' }, { status: 401 })
  const parsed = await parseBody(request, Body)
  if (!parsed.ok) return parsed.response

  const result = await readCnicFromDocument(parsed.data.documentId)
  return NextResponse.json({
    status: result.status,
    masked: result.status === 'found' ? maskToLast4(result.number) : null,
    cached: 'cached' in result ? result.cached : false,
  })
}
