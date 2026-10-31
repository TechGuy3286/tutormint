/**
 * scripts/screenshot-backend-support.tsx — writes three static HTML pages with
 * INVENTED data for the PR's screenshots (owner, 31 Oct 2026): the Backend
 * Support sidebar (from the real NAV_GROUPS and SCREEN_ACCESS), its KPI card
 * (the real component) and Team inbox → Templates with "Retired (n)" (the real
 * component, opened). No database, no session.
 *
 *   npx tsx scripts/screenshot-backend-support.tsx <out-folder> <compiled-css-file>
 * then capture each HTML with headless Chrome.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import BackendSupportKpiView from '../components/admin/BackendSupportKpiView'
import RetiredTemplates from '../components/admin/RetiredTemplates'
import { NAV_GROUPS } from '../lib/adminNav'
import { ROLE_LABEL, SCREEN_ACCESS, roleSatisfies } from '../lib/adminAccessCore'

const [out, cssFile] = process.argv.slice(2)
if (!out || !cssFile) {
  console.error('usage: screenshot-backend-support.tsx <out-folder> <css-file>')
  process.exit(1)
}
mkdirSync(out, { recursive: true })
const css = readFileSync(cssFile, 'utf8')
const page = (title: string, body: string, width = 420) =>
  `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><style>${css}</style></head><body class="bg-tm-bg" style="width:${width}px;padding:16px">${body}</body></html>`

// 1. The sidebar a Backend Support account sees.
const groups = NAV_GROUPS.map((g) => ({
  ...g,
  items: g.items.filter((i) => !i.screen || roleSatisfies('backend_support', SCREEN_ACCESS[i.screen as keyof typeof SCREEN_ACCESS] ?? [])),
})).filter((g) => g.items.length > 0)
const sidebar = h(
  'aside',
  { className: 'w-64 rounded-2xl bg-tm-black p-4 text-white' },
  h('p', { className: 'text-lg font-black' }, 'Tutor', h('span', { className: 'text-tm-mint' }, 'Mint')),
  h('p', { className: 'mt-1 inline-block rounded-full bg-tm-mint px-2 py-0.5 text-[11px] font-black text-tm-black' }, ROLE_LABEL.backend_support),
  ...groups.map((g) =>
    h(
      'div',
      { key: g.title, className: 'mt-4' },
      h('p', { className: 'text-[10px] font-bold uppercase tracking-wide text-gray-300' }, g.title),
      h('ul', { className: 'mt-1 space-y-1' }, ...g.items.map((i) => h('li', { key: i.href, className: 'rounded-lg px-2 py-1.5 text-sm font-semibold' }, i.label))),
    ),
  ),
)
writeFileSync(join(out, 'backend-support-sidebar.html'), page('Sidebar', renderToStaticMarkup(sidebar), 300))

// 2. The KPI card (invented numbers).
const kpi = renderToStaticMarkup(
  h(BackendSupportKpiView, { kpi: { followUpsToday: 14, followUps7: 63, overdueTodo: 3, redPaidTutors: 2, forwarded7: 11, forwardedWithin24h: 9 }, name: 'Sana Iqbal' }),
)
writeFileSync(join(out, 'backend-support-kpi.html'), page('KPI', kpi, 760))

// 3. Templates with "Retired (n)", opened (invented wording for display).
const retired = renderToStaticMarkup(
  h(RetiredTemplates, {
    templates: [
      { key: 'job_under_review', title: 'Job reported — under review', subject: '', body: 'Hi {name}, your tuition is under review…', retired: true, retiredReason: 'No code path sends it any more (deep scan, 31 Oct 2026).' },
      { key: 'payment_received', title: 'Payment received', subject: '', body: 'Hi {name}, we received your payment…', retired: true, retiredReason: 'No code path sends it any more (deep scan, 31 Oct 2026).' },
      { key: 'signup_email_unconfirmed', title: 'Signup — email not confirmed', subject: '', body: 'Hi {name}, please confirm your email…', retired: true, retiredReason: 'No code path sends it any more (deep scan, 31 Oct 2026).' },
    ],
  }),
).replace('<details ', '<details open ')
writeFileSync(join(out, 'templates-retired.html'), page('Templates', `<h1 class="mb-3 text-lg font-black text-tm-navy">Team inbox → Templates</h1>${retired}`, 640))
console.log('wrote 3 pages')
