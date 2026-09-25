import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { verifyMatchUnsub } from '@/lib/matchEmail'

// One-click unsubscribe from matched-tuition emails (PR54 §C).
//
// No login: the link carries an HMAC signature over the tutor's id, so it can
// only turn off THAT account's match emails and cannot be forged for anyone
// else. GET is fine — it flips one preference and shows a plain confirmation.

export const dynamic = 'force-dynamic'

function page(title: string, body: string, status = 200): NextResponse {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title}</title></head>
<body style="margin:0;background:#EEFBEE;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;">
<div style="max-width:520px;margin:48px auto;padding:28px 24px;background:#fff;border-radius:20px;">
<p style="margin:0 0 16px;font-size:20px;font-weight:900;color:#151E6B;">Tutor<span style="color:#C20202;">Mint</span></p>
<h1 style="margin:0 0 12px;font-size:18px;color:#151E6B;">${title}</h1>
<p style="margin:0;font-size:15px;line-height:1.6;color:#0A0A0A;">${body}</p>
<p style="margin:20px 0 0;font-size:13px;"><a href="https://www.tutormint.org/" style="color:#C20202;font-weight:700;">Go to TutorMint</a></p>
</div></body></html>`
  return new NextResponse(html, { status, headers: { 'content-type': 'text/html; charset=utf-8' } })
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const u = url.searchParams.get('u') ?? ''
  const sig = url.searchParams.get('sig') ?? ''

  if (!verifyMatchUnsub(u, sig)) {
    return page('This link is not valid', 'This unsubscribe link is not valid. You can change which emails you receive from your account notification settings.', 400)
  }

  const admin = createAdminClient()
  if (admin) {
    // The column may not exist yet (pre-migration); ignore the error, the link
    // still confirms so a tutor is never shown a failure.
    try {
      await admin.from('profiles').update({ match_email_opt_out: true }).eq('id', u)
    } catch {
      /* best-effort */
    }
  }

  return page(
    'You are unsubscribed',
    'You will no longer receive emails about new tuitions matching your subjects. You can still see them in your notifications when you sign in.',
  )
}
