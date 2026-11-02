// Browse (owner, 2 Nov 2026 — phone speed). The bare /browse/tutors and
// /browse/tuitions are cached for signed-out visitors (each page says
// `revalidate`); every filtered or signed-in request is rewritten by proxy.ts
// to the live twin under app/(site)/qs/browse. The tutor detail page says
// force-dynamic itself, and /browse only redirects. So this layout sets no
// route mode of its own.
export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
