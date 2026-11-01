import type { Metadata } from 'next'
import Breadcrumbs from '@/components/Breadcrumbs'
import PostTuitionButton from '@/components/session/PostTuitionButton'
import { socialMeta } from '@/lib/seo'
import {
  POST_TUITION_DESCRIPTION,
  POST_TUITION_HEADING,
  POST_TUITION_OG_IMAGE,
  POST_TUITION_OG_TITLE,
  POST_TUITION_PUBLIC_PATH,
  POST_TUITION_STEPS,
} from '@/lib/postTuitionPage'

// Public "Post your tuition" page (owner, 28 Oct 2026). Every parent message
// that asks someone to post a tuition links here: three plain steps and one
// button. Signed out → sign-up with Parent selected, then the post form; a
// signed-in parent → the form directly (lib/postTuitionPage).

// Cached for everyone (push 3, owner 1 Nov 2026); the button picks its link in
// the browser.
export const revalidate = 3600

export const metadata: Metadata = {
  title: POST_TUITION_OG_TITLE,
  description: POST_TUITION_DESCRIPTION,
  alternates: { canonical: POST_TUITION_PUBLIC_PATH },
  ...socialMeta({
    title: POST_TUITION_OG_TITLE,
    description: POST_TUITION_DESCRIPTION,
    path: POST_TUITION_PUBLIC_PATH,
    image: POST_TUITION_OG_IMAGE,
    imageAlt: POST_TUITION_HEADING,
    type: 'website',
  }),
}

export default function PostTuitionPage() {
  return (
    <main className="mx-auto w-full max-w-2xl space-y-5 p-4 sm:p-6">
      <Breadcrumbs items={[{ label: 'Post your tuition' }]} />

      <section className="rounded-3xl border border-gray-200 bg-white p-5 sm:p-8">
        <h1 className="text-2xl font-black text-tm-navy sm:text-3xl">{POST_TUITION_HEADING}</h1>

        <ol className="mt-5 space-y-3">
          {POST_TUITION_STEPS.map((step, i) => (
            <li key={step} className="flex items-start gap-3">
              <span
                aria-hidden
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-tm-tint-green text-sm font-black text-tm-green-deep"
              >
                {i + 1}
              </span>
              <span className="pt-1 text-base text-slate-800">{step}</span>
            </li>
          ))}
        </ol>

        <PostTuitionButton />
      </section>
    </main>
  )
}
