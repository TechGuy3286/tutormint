import Link from 'next/link'
import type { Metadata } from 'next'
import Breadcrumbs from '@/components/Breadcrumbs'
import { getSessionUser } from '@/lib/auth'
import { socialMeta } from '@/lib/seo'
import {
  POST_TUITION_BUTTON,
  POST_TUITION_DESCRIPTION,
  POST_TUITION_HEADING,
  POST_TUITION_OG_IMAGE,
  POST_TUITION_OG_TITLE,
  POST_TUITION_PUBLIC_PATH,
  POST_TUITION_STEPS,
  postTuitionButtonHref,
} from '@/lib/postTuitionPage'

// Public "Post your tuition" page (owner, 28 Oct 2026). Every parent message
// that asks someone to post a tuition links here: three plain steps and one
// button. Signed out → sign-up with Parent selected, then the post form; a
// signed-in parent → the form directly (lib/postTuitionPage).

export const dynamic = 'force-dynamic'

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

export default async function PostTuitionPage() {
  const session = await getSessionUser().catch(() => null)
  const href = postTuitionButtonHref(session?.profile?.role ?? null)

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

        <Link
          href={href}
          className="mt-6 flex min-h-[48px] w-full items-center justify-center rounded-xl bg-tm-red px-6 text-base font-bold text-white hover:bg-tm-red-hover sm:w-auto"
        >
          {POST_TUITION_BUTTON}
        </Link>
      </section>
    </main>
  )
}
