import Breadcrumbs from '@/components/Breadcrumbs'
import Link from 'next/link'

// Shared chrome for /terms and /privacy.
//
// Both documents are long, both are read on a phone, and both are read by
// someone looking for one specific paragraph — usually about refunds or about
// their CNIC. So: numbered sections with anchors they can be linked to, a
// contents list at the top, and text at a readable size rather than the 11px
// grey that legal pages default to. A policy nobody can read is not a policy.

export type LegalSection = {
  id: string
  heading: string
  body: React.ReactNode
}

export default function LegalDoc({
  title,
  updated,
  intro,
  sections,
}: {
  title: string
  updated: string
  intro: string
  sections: LegalSection[]
}) {
  return (
    <main className="mx-auto w-full max-w-3xl space-y-6 p-4 sm:p-6">
      <Breadcrumbs items={[{ label: title }]} />
      <header className="space-y-2">
        <h1 className="text-2xl font-black text-tm-navy sm:text-3xl">{title}</h1>
        <p className="text-xs font-bold uppercase tracking-wide text-gray-500">
          Last updated {updated}
        </p>
        <p className="text-sm leading-relaxed text-slate-700">{intro}</p>
      </header>

      <nav className="rounded-2xl border border-gray-200 bg-white p-4">
        <h2 className="pb-2 text-xs font-black uppercase tracking-wide text-gray-500">Contents</h2>
        <ol className="space-y-1.5">
          {sections.map((s, i) => (
            <li key={s.id}>
              <a
                href={`#${s.id}`}
                className="flex min-h-[44px] items-center gap-2 text-sm leading-relaxed text-slate-700 hover:text-tm-red"
              >
                <span className="shrink-0 font-bold text-gray-500">{i + 1}.</span>
                <span>{s.heading}</span>
              </a>
            </li>
          ))}
        </ol>
      </nav>

      <div className="space-y-5">
        {sections.map((s, i) => (
          <section
            key={s.id}
            id={s.id}
            className="scroll-mt-6 space-y-3 rounded-2xl border border-gray-200 bg-white p-4 sm:p-5"
          >
            <h2 className="text-base font-black text-tm-navy">
              <span className="text-gray-500">{i + 1}.</span> {s.heading}
            </h2>
            <div className="space-y-3 text-sm leading-relaxed text-slate-700 [&_a]:font-bold [&_a]:text-tm-red [&_a:hover]:underline [&_li]:pl-1 [&_strong]:text-tm-navy [&_ul]:list-disc [&_ul]:space-y-1.5 [&_ul]:pl-5">
              {s.body}
            </div>
          </section>
        ))}
      </div>

      <footer className="rounded-2xl border border-gray-200 bg-white p-4 text-xs leading-relaxed text-gray-500">
        Questions about this document? <Link href="/support">Contact us</Link>. See also our{' '}
        <Link href="/terms">Terms of Service</Link> and{' '}
        <Link href="/privacy">Privacy Policy</Link>.
      </footer>
    </main>
  )
}
