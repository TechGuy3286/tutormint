// lib/adminFlagsShared.ts
//
// The pure, client-safe half of the flag queue (PR40 §2): the row shape and the
// source label. Split out of lib/adminFlags.ts (which imports the service-role
// client and is server-only) so the client FlagQueue component can read them.

export type FlagRow = {
  id: string
  source: 'message' | 'profile' | 'tuition' | 'display_name'
  subject: { id: string; name: string; suspended: boolean }
  recipient: { id: string; name: string } | null
  content: string
  matched: string[]
  context: Record<string, unknown> | null
  createdAt: string
}

const SOURCE_LABEL: Record<FlagRow['source'], string> = {
  message: 'Message',
  profile: 'Profile text',
  tuition: 'Tuition',
  display_name: 'Display name',
}

export function flagSourceLabel(s: string): string {
  return SOURCE_LABEL[s as FlagRow['source']] ?? s
}
