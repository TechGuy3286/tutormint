import type { Metadata } from "next";
import "./globals.css";
import Navbar from "@/components/Navbar";

export const metadata: Metadata = {
  title: "TutorMint - Pakistan's Largest Tutors Network",
  description: "Connect directly with verified tutors and parents across Pakistan.",
  metadataBase: new URL('https://www.tutormint.org'),
  openGraph: {
    title: "TutorMint - Pakistan's Largest Tutors Network",
    description: "Connect directly with verified tutors and parents across Pakistan.",
    url: 'https://www.tutormint.org',
    siteName: 'TutorMint',
    images: [
      {
        url: '/logo.png',
        width: 1200,
        height: 630,
        alt: 'TutorMint Logo',
      },
    ],
    locale: 'en_PK',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: "TutorMint - Pakistan's Largest Tutors Network",
    description: "Connect directly with verified tutors and parents across Pakistan.",
    images: ['/logo.png'],
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-[#F8FAFC] antialiased">
        <Navbar />
        {children}
      </body>
    </html>
  );
}