'use client'

import { Suspense, useEffect, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useToast } from '@/components/ui/Toast'

// No silent transitions (owner, 9 Sep). Verifying an email happens server-side
// in /api/auth/callback, so there is no verification screen to confirm it on —
// the member just lands on their dashboard. The callback hands the dashboard
// `?verified=email`; this fires the one-time confirmation toast and strips the
// param so a refresh or Back does not re-fire it. Mounted once under the root
// ToastProvider, so it covers whichever dashboard the member lands on.
//
// The mobile OTP path confirms itself on /verify-phone (VerifyPhoneForm toasts
// "Number verified." before routing), so it does not use this — that toast
// already survives the navigation. Only 'email' is wired here.

const MESSAGES: Record<string, string> = {
  email: 'Your email is confirmed. Welcome to TutorMint!',
}

function VerifiedToastInner() {
  const params = useSearchParams()
  const router = useRouter()
  const toast = useToast()
  const fired = useRef(false)

  const verified = params.get('verified')

  useEffect(() => {
    if (!verified || fired.current) return
    const message = MESSAGES[verified]
    if (!message) return
    fired.current = true
    toast.success(message)
    // Strip the param so a refresh or a Back-navigation does not re-toast.
    const url = new URL(window.location.href)
    url.searchParams.delete('verified')
    router.replace(url.pathname + url.search, { scroll: false })
  }, [verified, toast, router])

  return null
}

export default function VerifiedToast() {
  // useSearchParams needs a Suspense boundary; keep it local so it never opts
  // the whole tree above it into client rendering.
  return (
    <Suspense fallback={null}>
      <VerifiedToastInner />
    </Suspense>
  )
}
