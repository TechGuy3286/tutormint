import type { Metadata } from "next";
import "./globals.css";
import Navbar from "@/components/Navbar";
import PreviewBanner from "@/components/PreviewBanner";
import { PREVIEW_MODE } from "@/lib/preview";
import Footer from "@/components/Footer";
import OfflineNotice from "@/components/OfflineNotice";
import { UpgradeProvider } from '@/components/upgrade/UpgradeProvider'

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

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-tm-bg antialiased flex flex-col min-h-screen">
        <UpgradeProvider>
          <Navbar />
          <PreviewBanner />
          <main className="flex-1">{children}</main>
          <Footer />
          <OfflineNotice />
        </UpgradeProvider>
      </body>
    </html>
  );
}