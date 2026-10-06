import { timingSafeEqual } from 'node:crypto'

// The internal routes (/api/internal/*) are protected by CRON_SECRET — the same
// `Authorization: Bearer <CRON_SECRET>` header the cron routes take. Anyone
// without it gets 401. Constant-time compare; never logs the secret.

export function cronAuthorised(request: Request): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  const header = request.headers.get('authorization') ?? ''
  const provided = header.startsWith('Bearer ') ? header.slice(7) : header
  const a = Buffer.from(secret, 'utf8')
  const b = Buffer.from(provided, 'utf8')
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}
