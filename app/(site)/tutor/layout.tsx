// Server component (was a client component gating on sessionStorage
// "tutorData" -- a key nothing ever set, so every tutor page bounced to
// /tutor/login and the dashboard was unreachable).
//
// This layout deliberately does NOT gate. It wraps public pages too:
// /tutor/[slug] profiles, /tutor, /tutor/login, /tutor/register. Browsing
// stays open per the product philosophy, and /tutor/[slug] has to remain
// server-rendered and public for SEO.
//
// The real gate is one level down, in app/tutor/dashboard/layout.tsx.

export default function TutorLayout({ children }: { children: React.ReactNode }) {
  // Navbar and Footer come from the root layout.
  return <>{children}</>
}
