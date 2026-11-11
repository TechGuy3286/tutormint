/**
 * scripts/test-inbox-mobile.tsx — the Team inbox at 390 px (owner, 11 Nov
 * 2026): no sideways scrolling anywhere. Renders the REAL InboxClient with
 * INVENTED data (a long unbroken word, a long link, a long name) twice — the
 * conversation list, and an open conversation — styles it with the built site
 * CSS, loads each page in headless Chrome at 390×844 and measures that no
 * element reaches past the screen's right edge.
 *
 * Also checks the source for the mobile layout rules (compact header with a
 * back arrow, a history that scrolls on its own, bubbles ≤ 85% wide, the
 * compose box pinned at the bottom, "In-app + email" in navy).
 *
 *   npm run build   (for the CSS)   then   npm run test:inboxmobile
 * Without a built CSS file or Chrome the render half is skipped and says so;
 * the source checks still run.
 */
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import assert from 'node:assert/strict'
import React from 'react'

const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].find((p) => existsSync(p))

function sourceChecks() {
  const s = readFileSync('app/admin/inbox/InboxClient.tsx', 'utf8')
  assert.match(s, /aria-label="Back to conversations"/, 'a back arrow on phones')
  assert.match(s, /max-lg:fixed max-lg:inset-0/, 'the chat fills the phone screen')
  assert.match(s, /max-lg:min-h-0 max-lg:flex-1/, 'the history scrolls on its own')
  assert.match(s, /el\.scrollTop = el\.scrollHeight/, 'newest at the bottom')
  assert.match(s, /min-w-0 max-w-\[85%\]/, 'bubbles at most 85% wide')
  assert.match(s, /\[overflow-wrap:anywhere\]/, 'long words and links wrap')
  assert.match(s, /data-inbox-compose="" className="min-w-0 shrink-0/, 'the compose box stays at the bottom')
  assert.match(s, /data-inapp-send=""\n\s+className="[^"]*bg-tm-navy /, '"In-app + email" is navy')
  assert.doesNotMatch(s, /bg-tm-red px-5 text-xs font-bold text-white hover:bg-tm-red-hover/, 'no red send button')
  assert.match(s, /bg-tm-green-deep/, '"Send on WhatsApp" stays green')
  assert.match(s, /lg:grid-cols-\[280px_1fr\]/, 'desktop layout unchanged')
  console.log('✔ source checks')
}

async function render(): Promise<string[] | null> {
  const cssDir = '.next/static/chunks'
  const cssFiles = existsSync(cssDir) ? readdirSync(cssDir).filter((f) => f.endsWith('.css')) : []
  if (!cssFiles.length || !CHROME) {
    console.log(`– render check skipped (${!cssFiles.length ? 'no built CSS — run npm run build' : 'no Chrome'})`)
    return null
  }
  const css = cssFiles.map((f) => readFileSync(join(cssDir, f), 'utf8')).join('\n')
  const { renderToStaticMarkup } = await import('react-dom/server')
  const { AppRouterContext } = await import('next/dist/shared/lib/app-router-context.shared-runtime')
  const { SearchParamsContext, PathnameContext } = await import('next/dist/shared/lib/hooks-client-context.shared-runtime')
  const { ToastProvider } = await import('../components/ui/Toast')
  const { ConfirmProvider } = await import('../components/ui/ConfirmDialog')
  const { AdminReadOnlyProvider } = await import('../components/admin/ReadOnly')
  const { default: InboxClient } = await import('../app/admin/inbox/InboxClient')

  const longWord = 'Supercalifragilisticexpialidocious'.repeat(4)
  const longLink = 'https://www.tutormint.org/tuitions/lahore/' + 'grade-9-10-science-physics-chemistry-mathematics-'.repeat(3) + 'ab12cd'
  const tag = { label: 'Fee not paid', labelUr: 'فیس ادا نہیں ہوئی', tone: 'gold' as const, templateKey: 'fee_not_paid' }
  const threads = [
    { memberId: 'm-1', memberName: 'Muhammad Abdul Rehman Siddiqui Qureshi Farooqi', memberEmail: '', lastBody: `${longWord} ${longLink}`, lastAt: '2026-11-11T09:00:00Z', lastDirection: 'in' as const, unreadFromMember: 3, tag },
    { memberId: 'm-2', memberName: 'Zara Imtiaz', memberEmail: '', lastBody: 'Thank you, I have paid.', lastAt: '2026-11-10T09:00:00Z', lastDirection: 'out' as const, unreadFromMember: 0, tag: null },
  ]
  const conversation = [
    { id: 'a1', direction: 'out' as const, body: `Hi, please finish your profile here:\n${longLink}`, templateKey: null, createdAt: '2026-11-10T09:00:00Z', readAt: null },
    { id: 'a2', direction: 'in' as const, body: `${longWord}\nمیں نے فیس ادا کر دی ہے`, templateKey: null, createdAt: '2026-11-10T10:00:00Z', readAt: null },
    ...Array.from({ length: 8 }, (_, i) => ({ id: `b${i}`, direction: (i % 2 ? 'in' : 'out') as 'in' | 'out', body: `Message ${i + 1} about the tuition in Gulberg, Lahore.`, templateKey: null, createdAt: '2026-11-11T09:00:00Z', readAt: null })),
  ]
  const templates = [{ key: 'fee_not_paid', title: 'Fee not paid — a very long template title that goes on and on for a while', subject: 's', body: 'Hi {name}, please pay the Verification Fee.' }]
  const router = { push() {}, replace() {}, refresh() {}, back() {}, forward() {}, prefetch() {} }
  const wrap = (node: React.ReactNode) =>
    renderToStaticMarkup(
      <AppRouterContext.Provider value={router as never}>
        <SearchParamsContext.Provider value={new URLSearchParams() as never}>
          <PathnameContext.Provider value="/admin/inbox">
            <ToastProvider>
              <ConfirmProvider>
                <AdminReadOnlyProvider readOnly={false} refCode="TEST" canApprove>
                  {node}
                </AdminReadOnlyProvider>
              </ConfirmProvider>
            </ToastProvider>
          </PathnameContext.Provider>
        </SearchParamsContext.Provider>
      </AppRouterContext.Provider>,
    )
  const common = { threads, templates, conversation, canEditTemplates: true, supportDisplay: '0321 5872222', selectedHasMobile: true }
  const pages = {
    list: wrap(<InboxClient {...common} selectedId={null} selectedName="" conversation={[]} />),
    chat: wrap(<InboxClient {...common} selectedId="m-1" selectedName={threads[0].memberName} suggestedTemplateKey="fee_not_paid" />),
  }
  // The measuring script writes its findings into the <title>, which --dump-dom prints.
  const probe = `<script>addEventListener('load',()=>{const w=document.documentElement.clientWidth;const bad=[];for(const el of document.querySelectorAll('body *')){const r=el.getBoundingClientRect();if(r.width&&r.right>w+0.5)bad.push((el.getAttribute('data-inbox-chat')!==null?'chat ':'')+el.tagName+'.'+String(el.className).slice(0,60)+' right='+Math.round(r.right));}parent.document.title=JSON.stringify({w,sw:document.documentElement.scrollWidth,bad:bad.slice(0,8)})})</script>`
  const dir = mkdtempSync(join(tmpdir(), 'tm-inbox-'))
  const problems: string[] = []
  for (const [name, body] of Object.entries(pages)) {
    const file = join(dir, `${name}.html`)
    // Headless Chrome will not open a window under 500 px, so the page is measured
    // inside a 390×844 iframe (srcdoc shares the outer page's origin, so the probe
    // can write the result into the outer title).
    const inner = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style>${probe}</head><body style="background:#F8FAFC;margin:0;padding:16px">${body}</body></html>`
    const esc = inner.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
    writeFileSync(file, `<!doctype html><html><head><meta charset="utf-8"><title>x</title></head><body style="margin:0"><iframe width="390" height="844" style="border:0;display:block" srcdoc="${esc}"></iframe></body></html>`)
    const out = execFileSync(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--window-size=600,900', '--virtual-time-budget=3000', '--dump-dom', `file:///${file.replace(/\\/g, '/')}`], { encoding: 'utf8', timeout: 60000 })
    const t = /<title>([^<]*)<\/title>/.exec(out)?.[1] ?? ''
    const m = JSON.parse(t.replace(/&quot;/g, '"').replace(/&amp;/g, '&')) as { w: number; sw: number; bad: string[] }
    console.log(`  ${name}: viewport ${m.w}px, page ${m.sw}px wide, ${m.bad.length} element(s) past the edge`)
    if (m.w > 400) problems.push(`${name}: the window was not phone width (${m.w}px)`)
    if (m.sw > m.w) problems.push(`${name}: the page scrolls sideways (${m.sw} > ${m.w})`)
    for (const b of m.bad) problems.push(`${name}: ${b}`)
  }
  return problems
}

async function main() {
  sourceChecks()
  const problems = await render()
  if (problems === null) return
  if (problems.length) {
    console.error('✖ horizontal overflow at 390 px:\n  ' + problems.join('\n  '))
    process.exit(1)
  }
  console.log('✔ Team inbox at 390 px: no horizontal overflow (list and open conversation)')
}

main().catch((e) => {
  console.error(e instanceof Error ? e.stack : e)
  process.exit(1)
})
