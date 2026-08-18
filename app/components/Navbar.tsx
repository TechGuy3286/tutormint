import Link from "next/link";

export default function Navbar() {
  return (
    <header className="bg-white border-b border-gray-200 px-6 sm:px-12 py-3.5 flex justify-between items-center sticky top-0 z-40 shadow-xs">
      <Link href="/" className="flex items-center">
        <img src="/logo.jpeg" alt="TutorMint Logo" className="h-14 sm:h-16 w-auto object-contain" />
      </Link>
      <div className="flex items-center space-x-3">
        <Link href="/parent/dashboard" className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-900 text-xs font-bold rounded-xl transition-colors">
          Browse Tutors 🔍
        </Link>
        <Link href="/tutor/register" className="px-4 py-2 bg-[#B3191F] hover:bg-[#9a151b] text-white text-xs font-bold rounded-xl shadow-sm transition-colors">
          Tutor Sign Up 🚀
        </Link>
      </div>
    </header>
  );
}