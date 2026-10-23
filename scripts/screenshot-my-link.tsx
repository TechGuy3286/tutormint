// scripts/screenshot-my-link.tsx — writes an HTML page with the "My link" card
// (components/admin/MyLinkCardView) styled by the built site CSS, for a
// screenshot. READ ONLY: counts come from the database for one staff code, and
// nothing but the code and numbers is printed.
//   npx tsx --env-file=.env.local scripts/screenshot-my-link.tsx <CODE> <out.html>
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import QRCode from 'qrcode'
import { createClient } from '@supabase/supabase-js'

import MyLinkCardView from '../components/admin/MyLinkCardView'
import { myLinkCounts, type CreditedAccount } from '../lib/staffSignupsCore'
import { firstPaidAt } from '../lib/staffTargetsCore'

async function main() {
  const [code = 'AQSA', out = 'my-link.html'] = process.argv.slice(2)
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
  const { data: link } = await db.from('staff_join_links').select('staff_id, code').eq('code', code).maybeSingle()
  if (!link) throw new Error('no such code')
  const { data: credits } = await db.from('staff_signup_credits').select('member_id, member_role').eq('staff_id', link.staff_id)
  const ids = (credits ?? []).map((c) => c.member_id as string)
  const [{ data: profs }, { data: pays }] = await Promise.all([
    db.from('profiles').select('id, created_at, role, is_test_name, hidden_from_public, is_seed, is_team_account').in('id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000']),
    db.from('payments').select('user_id, plan_code, status, reviewed_at, refunded_amount_pkr, refunded_at').in('user_id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000']).eq('status', 'approved'),
  ])
  const accounts: CreditedAccount[] = (credits ?? []).flatMap((c) => {
    const p = (profs ?? []).find((x) => x.id === c.member_id)
    if (!p || p.role === 'admin' || p.is_test_name || p.hidden_from_public || p.is_seed || p.is_team_account) return []
    const role = c.member_role as 'tutor' | 'parent'
    const facts = (pays ?? [])
      .filter((x) => x.user_id === c.member_id)
      .map((x) => ({ planCode: x.plan_code as string, status: x.status as string, approvedAt: x.reviewed_at as string, refundedAmountPkr: x.refunded_amount_pkr as number | null, refundedAt: x.refunded_at as string | null }))
    return [{ memberId: c.member_id as string, staffId: link.staff_id as string, role, name: '', mobile: null, at: { signed_up: p.created_at as string, paid: firstPaidAt(facts, role) } }]
  })
  const url = `https://www.tutormint.org/join?ref=${link.code}`
  const qr = await QRCode.toDataURL(url, { margin: 1, width: 160, color: { dark: '#151E6B', light: '#FFFFFF' } })
  const counts = myLinkCounts(accounts, link.staff_id as string, Date.now())
  const cssDir = '.next/static/chunks'
  const css = readdirSync(cssDir).filter((f) => f.endsWith('.css')).map((f) => readFileSync(join(cssDir, f), 'utf8')).join('\n')
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body style="background:#F8FAFC;margin:0;padding:16px"><div style="max-width:760px">${renderToStaticMarkup(<MyLinkCardView url={url} counts={counts} qr={qr} />)}</div></body></html>`
  writeFileSync(out, html)
  console.log('code', link.code, 'counts', JSON.stringify(counts))
}
main()
