import type { MetadataRoute } from 'next'

// Web app manifest. Next emits <link rel="manifest"> automatically because this
// file exists, and Android/Chrome read the 192 and 512 icons from it for an
// install/home-screen icon (the sizes those platforms actually ask for, beyond
// the tab favicon and the iOS apple-icon). Colours are brand tokens only —
// navy theme, the page-ground background.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'TutorMint',
    short_name: 'TutorMint',
    description: "Pakistan's verified tutors network. No fee, no commission, no middleman.",
    start_url: '/',
    display: 'standalone',
    background_color: '#F8FAFC',
    theme_color: '#151E6B',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
  }
}
