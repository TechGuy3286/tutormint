import type { Metadata } from "next";
import "./globals.css";

// 1. Define SEO Meta Information for Google & Social Media
export const metadata: Metadata = {
  title: {
    default: "TutorMint | Verified Home & Online Tutors Network in Pakistan",
    template: "%s | TutorMint",
  },
  description: "Find camera-verified home and online tutors in Lahore, Karachi, Islamabad, and Multan. Browse top-rated educators, check credentials, or post a tuition job for free.",
  
  // Google Search Console Site Verification
  verification: {
    google: "VIV7Ej84jonEk8vzQY5Ax2NXnecpFt5CrTZBw75z-W4",
  },

  keywords: [
    "home tutors pakistan",
    "verified tutors lahore",
    "online tuition karachi",
    "find home tutor islamabad",
    "tutor mint",
  ],
  authors: [{ name: "TutorMint Team" }],
  creator: "TutorMint",
  publisher: "TutorMint",
  formatDetection: {
    email: false,
    address: false,
    telephone: false,
  },
  metadataBase: new URL("https://tutormint.org"),
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title: "TutorMint | Verified Home Tutors Network",
    description: "Connect with camera-verified home and online educators across Pakistan.",
    url: "https://tutormint.org",
    siteName: "TutorMint",
    locale: "en_PK",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "TutorMint | Verified Home Tutors Network",
    description: "Connect with camera-verified home and online educators across Pakistan.",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // 2. Define JSON-LD Schema Structure for Google Rich Results
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "EducationalOrganization",
    "name": "TutorMint",
    "alternateName": "TutorMint Pakistan",
    "url": "https://tutormint.org",
    "logo": "https://tutormint.org/logo.png",
    "description": "Pakistan's trusted network of camera-verified home and online tutors.",
    "address": {
      "@type": "PostalAddress",
      "addressCountry": "PK"
    },
    "areaServed": [
      { "@type": "City", "name": "Lahore" },
      { "@type": "City", "name": "Karachi" },
      { "@type": "City", "name": "Islamabad" },
      { "@type": "City", "name": "Multan" }
    ],
    "sameAs": [
      "https://linkedin.com/company/tutormint"
    ]
  };

  return (
    <html lang="en">
      <head>
        {/* Injecting JSON-LD Structured Data */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      </head>
      <body className="font-sans antialiased">
        {children}
      </body>
    </html>
  );
}