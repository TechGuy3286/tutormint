'use client'

import { useEffect, useState } from 'react'
import { getBrowserClient } from '@/lib/supabase/clientLazy'
import { HIDE_PHOTO_HELP, HIDE_PHOTO_LABEL } from '@/lib/photoPrivacyCore'

// "Hide my photo from parents" (owner, 17 Oct 2026) — the onboarding photo step
// and tutor Settings. Off by default. It is stored as tutor_profiles.show_avatar
// (PR70; hidden = false), which the tutor writes on their own row. It only HIDES
// the photo — it never changes it — so it works even when the photo is approved
// and locked (the database lock covers avatar_url, never show_avatar). The photo
// is still uploaded and checked by our team either way.
//
// Controlled (`hidden` + `onChange`) when the screen already holds the value;
// otherwise it reads and writes the tutor's own row itself.

export default function HidePhotoToggle({
  hidden: controlled,
  onChange,
}: {
  hidden?: boolean
  onChange?: (hidden: boolean) => void
}) {
  const [own, setOwn] = useState<boolean>(false)
  const [busy, setBusy] = useState(false)
  const isControlled = controlled !== undefined
  const hidden = isControlled ? controlled : own

  useEffect(() => {
    if (isControlled) return
    let live = true
    void (async () => {
      const supabase = await getBrowserClient()
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) return
      const { data } = await supabase.from('tutor_profiles').select('show_avatar').eq('id', user.id).maybeSingle()
      if (live) setOwn((data as { show_avatar?: boolean | null } | null)?.show_avatar === false)
    })()
    return () => {
      live = false
    }
  }, [isControlled])

  const flip = async () => {
    const next = !hidden
    if (onChange) {
      onChange(next)
      return
    }
    setOwn(next)
    setBusy(true)
    try {
      const supabase = await getBrowserClient()
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (user) await supabase.from('tutor_profiles').update({ show_avatar: !next }).eq('id', user.id)
    } catch {
      /* transient — the switch shows what was chosen */
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3">
      <button
        type="button"
        role="switch"
        aria-checked={hidden}
        disabled={busy}
        onClick={() => void flip()}
        className="flex w-full items-center justify-between gap-3 text-left"
      >
        <span className="min-w-0">
          <span className="block text-sm font-bold text-tm-navy">{HIDE_PHOTO_LABEL}</span>
          <span className="block text-[11px] text-gray-500">{HIDE_PHOTO_HELP}</span>
        </span>
        <span className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition ${hidden ? 'bg-tm-green-deep' : 'bg-gray-300'}`}>
          <span className={`inline-block h-5 w-5 transform rounded-full bg-white transition ${hidden ? 'translate-x-5' : 'translate-x-0.5'}`} />
        </span>
      </button>
    </div>
  )
}
