// scripts/screenshot-team-overview.tsx — writes an HTML page with the Team
// overview card (components/admin/TeamOverviewView) filled with the live
// counts and styled by the built site CSS, for a screenshot (an admin session
// cannot be driven from a script). READ ONLY: names and counts only.
// Two steps, because the loader needs the react-server condition and the
// renderer must not have it:
//   npx tsx --conditions=react-server --env-file=.env.local scripts/screenshot-team-overview.tsx rows <rows.json>
//   npx tsx scripts/screenshot-team-overview.tsx html <rows.json> <out.html>
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

async function main() {
  const [mode, rowsFile, out = 'team-overview.html'] = process.argv.slice(2)
  if (mode === 'rows') {
    const { loadTeamOverview } = await import('../lib/teamOverview')
    const rows = await loadTeamOverview()
    writeFileSync(rowsFile, JSON.stringify(rows))
    for (const r of rows) console.log(`${r.name}: overdue ${r.overdueApplications}, red ${r.redPaidTutors}, today ${r.followUpsToday}, 7d ${r.followUps7}`)
    process.exit(0)
  }
  const { renderToStaticMarkup } = await import('react-dom/server')
  const { default: TeamOverviewView } = await import('../components/admin/TeamOverviewView')
  const rows = JSON.parse(readFileSync(rowsFile, 'utf8'))
  const cssDir = '.next/static/chunks'
  const css = readdirSync(cssDir).filter((f) => f.endsWith('.css')).map((f) => readFileSync(join(cssDir, f), 'utf8')).join('\n')
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body style="background:#F8FAFC;margin:0;padding:16px"><div style="max-width:760px">${renderToStaticMarkup(<TeamOverviewView rows={rows} />)}</div></body></html>`
  writeFileSync(out, html)
}
main()
