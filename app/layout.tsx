import type { Metadata } from "next";
import "./globals.css";
import { PREVIEW_MODE } from "@/lib/preview";
import OfflineNotice from "@/components/OfflineNotice";
import { UpgradeProvider } from '@/components/upgrade/UpgradeProvider'
import { ToastProvider } from '@/components/ui/Toast'
import { ConfirmProvider } from '@/components/ui/ConfirmDialog'

export const metadata: Metadata = {
  title: "TutorMint - Pakistan's Largest Verified Tutors Network",
  description: "Connect directly with verified tutors and parents across Pakistan.",
  metadataBase: new URL('https://www.tutormint.org'),
  // Site-wide noindex while the directory is mostly fixtures. One flag, in
  // lib/preview.ts — see the note there for why indexing seed accounts now is
  // expensive to undo later.
  ...(PREVIEW_MODE ? { robots: { index: false, follow: false } } : {}),
  openGraph: {
    title: "TutorMint - Pakistan's Largest Verified Tutors Network",
    description: "Connect directly with verified tutors and parents across Pakistan.",
    url: 'https://www.tutormint.org',
    siteName: 'TutorMint',
    images: [
      {
        url: 'https://www.tutormint.org/tutormint-logo1200x630.png',
        width: 1200,
        height: 630,
        alt: 'TutorMint - Pakistan\'s Largest Verified Tutors Network',
      },
    ],
    locale: 'en_PK',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: "TutorMint - Pakistan's Largest Verified Tutors Network",
    description: "Connect directly with verified tutors and parents across Pakistan.",
    images: ['https://www.tutormint.org/tutormint-logo1200x630.png'],
  },
};

// The document, and nothing else.
//
// The header, the preview strip and the footer used to be here, each deciding
// for itself whether it was under /admin by reading a path header. A root
// layout renders once per full page load and is NOT re-rendered on client
// navigation, so that decision went stale the moment somebody left /admin
// without a reload. They live in app/(site)/layout.tsx now; /admin is outside
// that group with its own shell. See components/SiteChrome.tsx.
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-tm-bg antialiased flex flex-col min-h-screen">
        <ToastProvider>
          <ConfirmProvider>
            <UpgradeProvider>
              {children}
              <OfflineNotice />
            </UpgradeProvider>
          </ConfirmProvider>
        </ToastProvider>
      </body>
    </html>
  );
}