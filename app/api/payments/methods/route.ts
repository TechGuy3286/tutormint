import { NextResponse } from 'next/server'
import { bankTransferOn, getGatewaySettings, onlineCheckoutOn } from '@/lib/payments/gatewaySettings'

// Which checkout options are on (owner, 6 Oct 2026, item 19), for the client-side
// payment surfaces (the upgrade sheet). Booleans only — no amounts, no
// credentials. The checkout route enforces the same settings on the server, so
// this only decides what is SHOWN.

export const dynamic = 'force-dynamic'

export async function GET() {
  const s = await getGatewaySettings()
  return NextResponse.json({
    online: onlineCheckoutOn(s),
    bankTransfer: bankTransferOn(s),
    payLater: s.payLater,
  })
}
