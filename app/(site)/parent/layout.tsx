// Server component (was a client component reading sessionStorage
// "parentData" into state that was never rendered -- it enforced nothing).
//
// No gate here: this layout also wraps public pages such as /parent and
// /parent/login. The real gate is in app/parent/dashboard/layout.tsx.

// Personal / signed-in pages stay dynamic (push 3, owner 1 Nov 2026). They
// used to be dynamic only because the site header read the sign-in cookie;
// the header is now in the browser, so this says it on purpose.
export const dynamic = 'force-dynamic'

export default function ParentLayout({ children }: { children: React.ReactNode }) {
  // Navbar and Footer come from the root layout.
  return <>{children}</>
}
