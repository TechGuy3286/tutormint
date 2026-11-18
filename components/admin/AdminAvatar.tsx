// components/admin/AdminAvatar.tsx — PR-04 (owner, 18 Nov 2026). The one
// admin avatar: the member's photo (shown to staff even when hidden publicly),
// or the same branded default the public pages show, with a small "No photo"
// tag so staff know it is not an uploaded photo. The tag sits over the bottom
// of the circle (absolute), so layouts do not move. No 'use client': it holds
// no state and renders anywhere.

import Avatar from '@/components/Avatar'
import { adminAvatarView, NO_PHOTO_TAG } from '@/lib/adminAvatarCore'

export default function AdminAvatar({
  name,
  src,
  gender,
  className = 'h-10 w-10 text-xs',
  px = 40,
  decorative = true,
  ring,
}: {
  name: string | null | undefined
  src?: string | null
  gender?: string | null
  className?: string
  px?: number
  decorative?: boolean
  ring?: string
}) {
  const v = adminAvatarView({ src: src ?? null, gender: gender ?? null })
  return (
    <span className="relative inline-flex shrink-0" data-admin-avatar={v.noPhoto ? 'default' : 'photo'}>
      <Avatar name={name} src={v.src} gender={v.gender} decorative={decorative} className={className} px={px} {...(ring ? { ring } : {})} />
      {v.noPhoto && (
        <span
          className="pointer-events-none absolute -bottom-1 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full border border-gray-200 bg-white px-1 text-[8px] font-bold leading-tight text-slate-600"
          data-no-photo-tag=""
        >
          {NO_PHOTO_TAG}
        </span>
      )}
    </span>
  )
}
