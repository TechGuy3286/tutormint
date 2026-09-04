'use client'

import { submitSignal, UPLOAD_TIMEOUT_MS } from '@/lib/submit'

import FileUpload from '@/components/FileUpload'

import { useState } from 'react'
import { AlertTriangle, Check, Download } from 'lucide-react'
import { useToast } from '@/components/ui/Toast'
import { useConfirm } from '@/components/ui/ConfirmDialog'

type Verdict = { line: number; name: string; mobile: string; ok: boolean; errors: string[] }
type Result = {
  line: number
  name: string
  username: string
  password: string
  profileUrl: string
  status: string
}

// Check, then import. Two buttons, in that order, and the second only appears
// once the first has run.
//
// The results table carries plaintext temporary passwords. They exist for
// exactly one sign-in and are shown once — they are not stored anywhere we can
// read them back, and they are not in the audit log. The download is built in
// the browser from what the server just returned, so leaving this page loses
// them, and the screen says so rather than letting an admin assume otherwise.

export default function ImportClient() {
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [verdicts, setVerdicts] = useState<Verdict[] | null>(null)
  const [summary, setSummary] = useState<{ total: number; clean: number; rejected: number } | null>(
    null,
  )
  const [results, setResults] = useState<Result[] | null>(null)

  const toast = useToast()
  const confirm = useConfirm()

  const post = async (action: 'validate' | 'apply') => {
    if (!file) return
    if (action === 'apply') {
      const ok = await confirm({
        title: `Import ${summary?.clean ?? 'the clean'} tutor${summary?.clean === 1 ? '' : 's'}?`,
        body: 'This creates real accounts for every clean row. Rejected rows are skipped.',
        confirmLabel: 'Import',
        destructive: false,
      })
      if (!ok) return
    }
    setBusy(action)
    setError(null)
    try {
      const fd = new FormData()
      fd.set('action', action)
      fd.set('file', file)
      const res = await fetch('/api/admin/import', { signal: submitSignal(UPLOAD_TIMEOUT_MS), method: 'POST', body: fd })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'That did not work.')

      if (action === 'validate') {
        setVerdicts(json.verdicts)
        setSummary({ total: json.total, clean: json.cleanCount, rejected: json.rejectedCount })
        setResults(null)
      } else {
        setResults(json.results)
        setSummary({ total: json.total, clean: json.created, rejected: json.rejectedCount })
        toast.success(`Imported ${json.created} tutor${json.created === 1 ? '' : 's'}.`)
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : 'That did not work.'
      setError(message)
      toast.error(message)
    } finally {
      setBusy(null)
    }
  }

  const downloadResults = () => {
    if (!results) return
    const header = 'line,name,username (mobile),password,profile URL,status'
    const escape = (v: string) => `"${(v ?? '').replace(/"/g, '""')}"`
    const csv = [
      header,
      ...results.map((r) =>
        [r.line, r.name, r.username, r.password, r.profileUrl, r.status].map((v) => escape(String(v))).join(','),
      ),
    ].join('\n')

    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `tutormint-import-results-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-5">
      <header className="space-y-1">
        <p className="text-xs leading-relaxed text-gray-500">
          Imported profiles are reachable by direct link but stay out of search until the tutor
          claims theirs — first sign-in, terms, and an OTP on their number. Import never skips
          verification or payment.
        </p>
      </header>

      <a
        href="/api/admin/import"
        className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 text-xs font-bold text-slate-700"
      >
        <Download size={14} />
        Download the CSV template
      </a>

      <section className="space-y-3 rounded-2xl border border-gray-200 bg-white p-4">
        {/* A spreadsheet, not an image — so no thumbnail, but the file name
            and size still show, which is what tells an admin they picked last
            month's export by mistake. */}
        <FileUpload
          label="CSV file"
          accept=".csv,text/csv"
          acceptLabel="CSV"
          maxBytes={10 * 1024 * 1024}
          onFile={(f) => {
            setFile(f)
            setVerdicts(null)
            setResults(null)
            setSummary(null)
          }}
        />

        <button
          type="button"
          disabled={!file || busy !== null}
          onClick={() => post('validate')}
          className="min-h-[44px] w-full rounded-xl bg-tm-black px-4 text-xs font-bold text-white disabled:bg-gray-300 sm:w-auto sm:px-6"
        >
          {busy === 'validate' ? 'Checking…' : 'Check the file'}
        </button>
      </section>

      {error && (
        <p className="rounded-xl border border-tm-red/30 bg-tm-tint-red p-3 text-xs font-bold text-tm-red">
          {error}
        </p>
      )}

      {summary && (
        <p className="rounded-2xl border border-gray-200 bg-white p-4 text-xs font-bold text-tm-navy">
          {results
            ? `${summary.clean} of ${summary.total} rows imported · ${summary.rejected} rejected`
            : `${summary.clean} of ${summary.total} rows are ready · ${summary.rejected} would be rejected`}
        </p>
      )}

      {/* ------------------------------------------------------ verdicts --- */}
      {verdicts && !results && (
        <>
          <ul className="space-y-2">
            {verdicts.map((v) => (
              <li
                key={v.line}
                className={`space-y-1 rounded-2xl border bg-white p-3 ${
                  v.ok ? 'border-gray-200' : 'border-tm-red/30'
                }`}
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="min-w-0 truncate text-xs font-black text-tm-navy">
                    Row {v.line}: {v.name || '(no name)'}
                  </p>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-black uppercase ${
                      v.ok ? 'bg-tm-tint-green text-tm-green-deep' : 'bg-tm-tint-red text-tm-red'
                    }`}
                  >
                    {v.ok ? 'ready' : 'rejected'}
                  </span>
                </div>
                <p className="text-[11px] text-gray-500">{v.mobile || '(no mobile)'}</p>
                {v.errors.map((e, i) => (
                  <p key={i} className="text-[11px] font-semibold text-tm-red">
                    • {e}
                  </p>
                ))}
              </li>
            ))}
          </ul>

          {summary && summary.clean > 0 && (
            <div className="space-y-2 rounded-2xl border border-tm-gold/30 bg-tm-tint-gold p-4">
              <p className="flex items-start gap-2 text-xs font-semibold leading-relaxed text-tm-gold-ink">
                <AlertTriangle size={16} className="mt-px shrink-0" />
                This creates {summary.clean} real account{summary.clean === 1 ? '' : 's'} with
                temporary passwords. Rejected rows are skipped — fix them and upload again.
              </p>
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => post('apply')}
                className="min-h-[44px] w-full rounded-xl bg-tm-red px-4 text-xs font-bold text-white disabled:bg-gray-300"
              >
                {busy === 'apply' ? 'Importing…' : `Import ${summary.clean} tutor${summary.clean === 1 ? '' : 's'}`}
              </button>
            </div>
          )}
        </>
      )}

      {/* ------------------------------------------------------- results --- */}
      {results && (
        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 text-sm font-black text-tm-green-deep">
              <Check size={16} />
              Import finished
            </h2>
            <button
              type="button"
              onClick={downloadResults}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-tm-black px-4 text-xs font-bold text-white"
            >
              <Download size={14} />
              Download results
            </button>
          </div>

          <p className="rounded-xl border border-tm-gold/30 bg-tm-tint-gold p-3 text-[11px] leading-relaxed text-tm-gold-ink">
            Download this now. The passwords are shown once, are not stored anywhere we can read
            them back, and are not in the audit log — leaving this page loses them.
          </p>

          <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white">
            <table className="w-full min-w-[720px] text-left text-xs">
              <thead className="border-b border-gray-200 text-[10px] uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="p-3 font-bold">Row</th>
                  <th className="p-3 font-bold">Name</th>
                  <th className="p-3 font-bold">Username</th>
                  <th className="p-3 font-bold">Password</th>
                  <th className="p-3 font-bold">Status</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r) => (
                  <tr key={r.line} className="border-b border-gray-100 last:border-0">
                    <td className="p-3 text-gray-500">{r.line}</td>
                    <td className="p-3 font-bold text-tm-navy">
                      {r.name}
                      {r.profileUrl && (
                        <a
                          href={r.profileUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="block text-[11px] font-normal text-tm-red hover:underline"
                        >
                          {r.profileUrl.replace(/^https?:\/\/[^/]+/, '')}
                        </a>
                      )}
                    </td>
                    <td className="p-3 font-mono text-[11px]">{r.username}</td>
                    <td className="p-3 font-mono text-[11px]">{r.password || '—'}</td>
                    <td
                      className={`p-3 ${r.status === 'Created' ? 'text-tm-green-deep' : 'text-tm-red'}`}
                    >
                      {r.status}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  )
}
