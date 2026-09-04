import SiteChrome from '@/components/SiteChrome'

// Everything the public sees. /admin is deliberately outside this group and
// brings its own shell — see components/SiteChrome.tsx for what that buys.
export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return <SiteChrome>{children}</SiteChrome>
}
