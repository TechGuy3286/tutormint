import Link from "next/link";

export default function Footer() {
  return (
    <footer className="bg-white border-t border-gray-200 px-8 py-6 text-center text-xs text-gray-400 flex flex-col sm:flex-row justify-between items-center max-w-5xl mx-auto w-full gap-4">
      <div>© 2026 TutorMint. All rights reserved. Verified Education Platform.</div>
      <div className="flex space-x-6 text-[11px]">
        <Link href="/faq" className="hover:text-gray-600">FAQs</Link>
        <Link href="/privacy" className="hover:text-gray-600">Privacy Policy</Link>
        <Link href="/support" className="hover:text-gray-600">Support</Link>
        <Link href="/about" className="hover:text-gray-600">About</Link>
        <Link href="/blog" className="hover:text-gray-600">Blog</Link>
      </div>
    </footer>
  );
}