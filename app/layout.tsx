import type { Metadata } from "next";
import "./globals.css";
import Navbar from "@/components/Navbar";

export const metadata: Metadata = {
  title: "TutorMint - Find Verified Tutors & Tuition Jobs",
  description: "Connect directly with verified tutors and parents.",
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