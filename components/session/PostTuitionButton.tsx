'use client'

import Link from 'next/link'
import { useHeaderSession } from '@/components/session/HeaderSessionProvider'
import { POST_TUITION_BUTTON, postTuitionButtonHref } from '@/lib/postTuitionPage'

// The /post-tuition button (push 3, owner 1 Nov 2026): the page is cached for
// everyone, so the button decides in the browser — a signed-in parent goes
// straight to the form, everyone else to sign-up with Parent selected.
export default function PostTuitionButton() {
  const state = useHeaderSession()
  const role = state.status === 'signed-in' ? state.session.role : null
  return (
    <Link
      href={postTuitionButtonHref(role)}
      className="mt-6 flex min-h-[48px] w-full items-center justify-center rounded-xl bg-tm-red px-6 text-base font-bold text-white hover:bg-tm-red-hover sm:w-auto"
    >
      {POST_TUITION_BUTTON}
    </Link>
  )
}
