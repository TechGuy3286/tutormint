// lib/deviceMark.ts — server only (owner, 2 Nov 2026, Part H).
//
// The device and IP of a sign-up or a staff sign-in, kept as one-way hashes in
// member_device_marks so the self-referral rule (lib/selfReferralCore) can tell
// "a staff member signed themselves up". The browser id is the random tm_anon
// cookie (lib/anonSession); the IP is the first x-forwarded-for address. Neither
// value is stored, logged or returned — only sha256 of a fixed prefix + value.
// Never blocks the request it is called from.
import 'server-only'
import { createHash } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { ANON_COOKIE, isAnonId } from '@/lib/anonSession'
import { ANON_ID_HEADER } from '@/lib/searchBeaconCore'

export type DeviceMark = { deviceHash: string | null; ipHash: string | null }

const hash = (prefix: string, v: string) => createHash('sha256').update(`${prefix}:${v}`).digest('hex')

function cookieValue(header: string | null, name: string): string | null {
  for (const part of (header ?? '').split(';')) {
    const [k, ...rest] = part.trim().split('=')
    if (k === name) return decodeURIComponent(rest.join('='))
  }
  return null
}

/** The hashed device and IP of a request. */
export function deviceMarkFrom(request: Request): DeviceMark {
  const h = request.headers
  const anon = h.get(ANON_ID_HEADER) ?? cookieValue(h.get('cookie'), ANON_COOKIE)
  const ip = (h.get('x-forwarded-for') ?? h.get('x-real-ip') ?? '').split(',')[0].trim()
  return {
    deviceHash: isAnonId(anon) ? hash('tm-device', anon.toLowerCase()) : null,
    ipHash: ip ? hash('tm-ip', ip) : null,
  }
}

/** Store a mark (once per member, kind and device/IP pair). */
export async function recordDeviceMark(memberId: string, kind: 'signup' | 'staff', mark: DeviceMark): Promise<void> {
  if (!mark.deviceHash && !mark.ipHash) return
  try {
    const admin = createAdminClient()
    if (!admin) return
    // A repeat of the same pair hits the unique index (23505) — that is fine.
    const { error } = await admin
      .from('member_device_marks')
      .insert({ member_id: memberId, kind, device_hash: mark.deviceHash, ip_hash: mark.ipHash })
    if (error && error.code !== '23505') console.error('[device-mark] not recorded:', error.code)
  } catch (e) {
    console.error('[device-mark] not recorded:', e instanceof Error ? e.message : 'error')
  }
}

/** Every device and IP hash seen for these members. */
export async function deviceMarksFor(memberIds: string[]): Promise<Map<string, { devices: string[]; ips: string[] }>> {
  const out = new Map<string, { devices: string[]; ips: string[] }>()
  const admin = createAdminClient()
  if (!admin || !memberIds.length) return out
  const { data } = await admin.from('member_device_marks').select('member_id, device_hash, ip_hash').in('member_id', memberIds).limit(1000)
  for (const r of data ?? []) {
    const e = out.get(r.member_id as string) ?? { devices: [], ips: [] }
    if (r.device_hash) e.devices.push(r.device_hash as string)
    if (r.ip_hash) e.ips.push(r.ip_hash as string)
    out.set(r.member_id as string, e)
  }
  return out
}
