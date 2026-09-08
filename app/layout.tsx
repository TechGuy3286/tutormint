import type { Metadata } from "next";
import "./globals.css";
import OfflineNotice from "@/components/OfflineNotice";
import VerifiedToast from "@/components/VerifiedToast";
import { UpgradeProvider } from '@/components/upgrade/UpgradeProvider'
import { ToastProvider } from '@/components/ui/Toast'
import { ConfirmProvider } from '@/components/ui/ConfirmDialog'

export const metadata: Metadata = {
  title: "TutorMint - Pakistan's Largest Verified Tutors Network",
  description: "Connect directly with verified tutors and parents across Pakistan.",
  metadataBase: new URL('https://www.tutormint.org'),
  // Public pages are indexable NOW (owner, 8 Sep 2026) — indexing is decoupled
  // from the "launching soon" banner, which stays. There is no site-wide
  // noindex; authenticated and admin pages set their own robots noindex in
  // their metadata and are disallowed in robots.txt. See "Index now, banner
  // stays" in CLAUDE.md.
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
              <VerifiedToast />
            </UpgradeProvider>
          </ConfirmProvider>
        </ToastProvider>
      </body>
    </html>
  );
}