import type { Metadata } from "next";
import { Suspense } from "react";
import "./globals.css";
import { SITE_DEFAULT_TITLE, SITE_DESCRIPTION } from '@/lib/siteIdentity'
import { OG_DEFAULT_IMAGE } from '@/lib/seo'
import { absoluteUrl } from '@/lib/siteUrl'
import OfflineNotice from "@/components/OfflineNotice";
import VerifiedToast from "@/components/VerifiedToast";
import ActivityTracker from "@/components/ActivityTracker";
import { UpgradeProvider } from '@/components/upgrade/UpgradeProvider'
import { ToastProvider } from '@/components/ui/Toast'
import { ConfirmProvider } from '@/components/ui/ConfirmDialog'

export const metadata: Metadata = {
  title: SITE_DEFAULT_TITLE,
  description: SITE_DESCRIPTION,
  metadataBase: new URL('https://www.tutormint.org'),
  // Public pages are indexable NOW (owner, 8 Sep 2026) — indexing is decoupled
  // from the "launching soon" banner, which stays. There is no site-wide
  // noindex; authenticated and admin pages set their own robots noindex in
  // their metadata and are disallowed in robots.txt. See "Index now, banner
  // stays" in CLAUDE.md.
  openGraph: {
    title: SITE_DEFAULT_TITLE,
    description: SITE_DESCRIPTION,
    url: 'https://www.tutormint.org',
    siteName: 'TutorMint',
    images: [
      {
        url: absoluteUrl(OG_DEFAULT_IMAGE),
        width: 1200,
        height: 630,
        alt: SITE_DEFAULT_TITLE,
      },
    ],
    locale: 'en_PK',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: SITE_DEFAULT_TITLE,
    description: SITE_DESCRIPTION,
    images: [absoluteUrl(OG_DEFAULT_IMAGE)],
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
              {/* Member activity telemetry (PR99 §2). Self-gates on the server
                  (dormant when signed out); Suspense keeps static routes static
                  despite its useSearchParams. */}
              <Suspense fallback={null}>
                <ActivityTracker />
              </Suspense>
            </UpgradeProvider>
          </ConfirmProvider>
        </ToastProvider>
      </body>
    </html>
  );
}