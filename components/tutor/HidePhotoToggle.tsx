'use client'

import { useEffect, useState } from 'react'
import { getBrowserClient } from '@/lib/supabase/clientLazy'
import { SHOW_DEFAULT_PICTURE_HELP, SHOW_DEFAULT_PICTURE_LABEL, SHOW_MY_PHOTO_LABEL } from '@/lib/photoPrivacyCore'

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

  // Two choices (owner, 12 Nov 2026), one stored setting: "Show my photo to
  // parents" (default) or "Show a default picture instead" (= hidden).
  const choose = (wantHidden: boolean) => {
    if (busy || wantHidden === hidden) return
    void flip()
  }
  const option = (wantHidden: boolean, label: string, help: string | null) => {
    const on = hidden === wantHidden
    return (
      <button
        type="button"
        role="radio"
        aria-checked={on}
        disabled={busy}
        onClick={() => choose(wantHidden)}
        className={`flex min-h-11 w-full items-start gap-3 rounded-lg border px-3 py-2 text-left transition ${on ? 'border-tm-green-deep bg-tm-tint-green' : 'border-gray-200 bg-white'}`}
      >
        <span className={`mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 ${on ? 'border-tm-green-deep' : 'border-gray-400'}`}>
          {on && <span className="h-2 w-2 rounded-full bg-tm-green-deep" />}
        </span>
        <span className="min-w-0">
          <span className="block text-sm font-bold text-tm-navy">{label}</span>
          {help && <span className="block text-[11px] text-gray-600">{help}</span>}
        </span>
      </button>
    )
  }

  return (
    <div role="radiogroup" aria-label="What parents see" className="space-y-2 rounded-xl border border-gray-200 bg-white p-3">
      {option(false, SHOW_MY_PHOTO_LABEL, null)}
      {option(true, SHOW_DEFAULT_PICTURE_LABEL, SHOW_DEFAULT_PICTURE_HELP)}
    </div>
  )
}
