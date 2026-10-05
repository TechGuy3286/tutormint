import Image from 'next/image'

// The full-page loader (#103, owner 5 Oct 2026): a small TutorMint monogram,
// centred, breathing gently — never the word "Loading…". Used by the (site)
// route-group loading boundary and by the client flows that previously showed a
// text placeholder while they fetched their facts (onboarding, complete-profile,
// parent verify).
//
// `fullPage` pins it over the viewport (the client flows render above the
// chrome, like their own screens do); otherwise it fills a tall block inside
// whatever layout wraps it. The animation is in app/globals.css (`tm-logo-loader`)
// so the reduced-motion rule there stops it for readers who asked for less motion.

export default function LogoLoader({ fullPage = false }: { fullPage?: boolean }) {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Please wait"
      className={
        fullPage
          ? 'fixed inset-0 z-[60] grid place-items-center bg-tm-bg'
          : 'grid min-h-[50vh] w-full place-items-center'
      }
    >
      <Image
        src="/icons/icon-192.png"
        alt=""
        width={56}
        height={56}
        priority
        className="tm-logo-loader h-14 w-14 rounded-2xl"
      />
    </div>
  )
}
