import { NextResponse } from 'next/server'
import { checkAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { logAdminAction } from '@/lib/auditLog'
import {
  rowsFromCsv,
  validateRows,
  createImportedTutor,
  templateCsv,
  type ImportOutcome,
} from '@/lib/import'

// Bulk tutor import. owner / manager.
//
// Two actions, and the separation is the point:
//
//   validate  parses and checks the whole file and writes NOTHING. The admin
//             sees every row's verdict before deciding.
//   apply     re-validates from scratch and creates only the clean rows.
//
// `apply` does not trust the verdicts the browser sends back. Re-running the
// validation costs one pass over a small file and removes any chance of a
// client posting "row 4 was fine, honest" for a row that duplicates an
// existing tutor. The file is the only input.

export const runtime = 'nodejs'

const MAX_BYTES = 2 * 1024 * 1024
const MAX_ROWS = 500

export async function GET() {
  const gate = await checkAdminRole(...SCREEN_ACCESS.import)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })

  return new Response(templateCsv(), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="tutormint-import-template.csv"',
    },
  })
}

export async function POST(request: Request) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.import)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return NextResponse.json({ error: 'Invalid upload.' }, { status: 400 })
  }

  const action = String(form.get('action') ?? 'validate')
  const file = form.get('file')

  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: 'Choose a file to upload.' }, { status: 400 })
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'That file is larger than 2 MB.' }, { status: 400 })
  }

  const name = file.name.toLowerCase()
  if (!name.endsWith('.csv')) {
    // XLSX would need a parser dependency and a binary format to trust. The
    // template is a CSV and every spreadsheet exports one, so the honest
    // answer is to say so rather than half-support it.
    return NextResponse.json(
      { error: 'Please upload a CSV. Save the template as CSV from Excel or Google Sheets.' },
      { status: 400 },
    )
  }

  const text = await file.text()
  const { rows, error } = rowsFromCsv(text)
  if (error) return NextResponse.json({ error }, { status: 400 })

  if (rows.length === 0) {
    return NextResponse.json({ error: 'That file has a header but no rows.' }, { status: 400 })
  }
  if (rows.length > MAX_ROWS) {
    return NextResponse.json(
      { error: `That file has ${rows.length} rows. Please split it into files of ${MAX_ROWS} or fewer.` },
      { status: 400 },
    )
  }

  const verdicts = await validateRows(rows)
  const clean = verdicts.filter((v) => v.ok)
  const rejected = verdicts.filter((v) => !v.ok)

  if (action === 'validate') {
    return NextResponse.json({
      mode: 'validate',
      total: rows.length,
      cleanCount: clean.length,
      rejectedCount: rejected.length,
      verdicts,
    })
  }

  if (action !== 'apply') {
    return NextResponse.json({ error: 'Unknown action.' }, { status: 400 })
  }

  if (clean.length === 0) {
    return NextResponse.json(
      { error: 'No row in that file passed validation, so nothing was created.' },
      { status: 400 },
    )
  }

  const origin = new URL(request.url).origin
  const byLine = new Map(rows.map((r) => [r.line, r]))
  const results: ImportOutcome[] = []

  for (const verdict of clean) {
    const row = byLine.get(verdict.line)!
    const outcome = await createImportedTutor({
      row,
      verdict,
      actorId: gate.actor.id,
      origin,
    })
    results.push(outcome)
  }

  // Rejected rows appear in the results file too: an admin handing this to a
  // colleague needs the failures in front of them, not only the successes.
  const rejectedRows: ImportOutcome[] = rejected.map((v) => ({
    line: v.line,
    name: v.name,
    username: v.mobile,
    password: '',
    profileUrl: '',
    status: `Rejected — ${v.errors.join(' ')}`,
  }))

  const created = results.filter((r) => r.status === 'Created').length

  await logAdminAction({
    actorId: gate.actor.id,
    actorRole: gate.actor.adminRole,
    actorEmail: gate.actor.email,
    action: 'tutor.import',
    targetType: 'import',
    targetId: file.name,
    // Passwords are never written to the audit log.
    detail: {
      fileName: file.name,
      rows: rows.length,
      created,
      rejected: rejected.length,
      usernames: results.filter((r) => r.status === 'Created').map((r) => r.username),
    },
  })

  return NextResponse.json({
    mode: 'apply',
    total: rows.length,
    created,
    rejectedCount: rejected.length,
    results: [...results, ...rejectedRows].sort((a, b) => a.line - b.line),
  })
}
