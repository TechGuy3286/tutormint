/**
 * scripts/report-template-rewrite.ts — READ ONLY. Writes one table of every
 * rewritten template: name, recipient, the live text and the proposed text,
 * as Markdown and HTML, from a live-template dump (scripts/report-live-templates.ts).
 * Emails' live text is the built-in email rendered with sample data.
 *
 *   npx tsx --conditions=react-server scripts/report-template-rewrite.ts <live.json> <out-dir>
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ALL_PROPOSALS } from '@/lib/templateProposals'
import { EMAIL_SAMPLE_INPUTS, type EmailVariant } from '@/lib/notify/emailWordingCore'
import { render } from '@/lib/notify/templates'

const [livePath, outDir] = process.argv.slice(2)
if (!livePath || !outDir) throw new Error('Give the live dump and an output folder.')
const live = new Map<string, { body: string; subject: string | null }>(
  (JSON.parse(readFileSync(livePath, 'utf8')) as { key: string; body: string; subject: string | null }[]).map((r) => [r.key, r]),
)

const rows = ALL_PROPOSALS.map((p) => {
  let current = ''
  if (p.kind === 'email') {
    const r = render(EMAIL_SAMPLE_INPUTS[p.key.replace('email:', '') as EmailVariant])
    current = `Subject: ${r.subject}\n\n${r.text.split('\n—\n')[0].trimEnd()}`
  } else current = live.get(p.key)?.body ?? '(not set up)'
  const proposed = `${p.subject ? `Subject: ${p.subject}\n\n` : ''}${p.body}${p.button ? `\n\n(button: ${p.button})` : ''}`
  const kind = p.kind === 'email' ? 'Email' : p.kind === 'team' ? 'Team inbox' : 'WhatsApp'
  return { name: `${p.title} (${p.key})`, recipient: `${p.recipient} · ${kind}`, current, proposed }
})

const md = ['| Template | Recipient | Live now | Proposed |', '| --- | --- | --- | --- |']
const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, '<br>')
for (const r of rows) md.push(`| ${cell(r.name)} | ${cell(r.recipient)} | ${cell(r.current)} | ${cell(r.proposed)} |`)
writeFileSync(join(outDir, 'template-table.md'), md.join('\n') + '\n')

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const html = `<!doctype html><meta charset="utf-8"><title>Template rewrite</title>
<style>body{font:14px system-ui;margin:16px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccc;padding:8px;vertical-align:top;text-align:left}pre{white-space:pre-wrap;margin:0;font:13px system-ui}th{background:#E8EAF5}</style>
<h1>Template rewrite — live vs proposed (${rows.length})</h1><table><tr><th>Template</th><th>Recipient</th><th>Live now</th><th>Proposed</th></tr>
${rows.map((r) => `<tr><td>${esc(r.name)}</td><td>${esc(r.recipient)}</td><td><pre>${esc(r.current)}</pre></td><td><pre>${esc(r.proposed)}</pre></td></tr>`).join('\n')}
</table>`
writeFileSync(join(outDir, 'template-table.html'), html)
console.log(`${rows.length} templates → ${outDir}`)
