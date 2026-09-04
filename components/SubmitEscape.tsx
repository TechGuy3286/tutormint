import { ArrowRight } from 'lucide-react'
import Link from 'next/link'

// The way out of a submit that succeeded but did not move the page.
//
// Three forms hand off to router.push and keep their spinner on purpose --
// re-enabling a submit button during a route change invites a second submit,
// and on /register the second one tells the member their own mobile number is
// already taken. So the spinner stays, and lib/submit.ts arms a ten-second
// deadline; when that fires, this is what the member gets.
//
// A LINK, not a retry. The work is already done at this point: the session
// exists, the account exists, the number is verified. Offering "try again"
// would invite them to redo something that succeeded. The only thing left is
// to get to the page they were going to.

export default function SubmitEscape({ href }: { href: string }) {
  return (
    <Link
      href={href}
      className="gap-1.5 flex min-h-[44px] w-full items-center justify-center rounded-xl bg-tm-black px-4 text-xs font-bold text-white transition-colors hover:bg-tm-green-deep"
    >
      <ArrowRight aria-hidden size={14} />
      Continue
    </Link>
  )
}
