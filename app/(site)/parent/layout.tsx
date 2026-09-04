// Server component (was a client component reading sessionStorage
// "parentData" into state that was never rendered -- it enforced nothing).
//
// No gate here: this layout also wraps public pages such as /parent and
// /parent/login. The real gate is in app/parent/dashboard/layout.tsx.

export default function ParentLayout({ children }: { children: React.ReactNode }) {
  // Navbar and Footer come from the root layout.
  return <>{children}</>
}
