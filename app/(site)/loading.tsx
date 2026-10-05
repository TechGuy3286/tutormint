import LogoLoader from '@/components/LogoLoader'

// The (site) route-group loading boundary (#103). On a navigation whose page is
// still streaming, the header and footer stay and the body shows the small
// animated TutorMint logo, centred — never the word "Loading…". Routes with a
// closer boundary (the dashboards, Browse, the inbox) show their own
// card-shaped skeletons instead; Next picks the nearest one.
//
// A loading boundary also makes a dynamic route's prefetch PARTIAL (see the
// dashboard loading files), which is a cost saving, not a cost.

export default function SiteLoading() {
  return <LogoLoader />
}
