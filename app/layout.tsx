import type { Metadata } from "next";
import "./globals.css";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import OfflineNotice from "@/components/OfflineNotice";

export const metadata: Metadata = {
  title: "TutorMint - Pakistan's Largest Verified Tutors Network",
  description: "Connect directly with verified tutors and parents across Pakistan.",
  metadataBase: new URL('https://www.tutormint.org'),
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
      <body className="bg-[#F8FAFC] antialiased flex flex-col min-h-screen">
        <Navbar />
        <main className="flex-1">{children}</main>
        <Footer />
        <OfflineNotice />
      </body>
    </html>
  );
}