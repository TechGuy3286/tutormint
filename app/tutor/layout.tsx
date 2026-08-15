"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";

export default function TutorLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [tutorName, setTutorName] = useState("");

  // Skip layout shell and session check on auth pages
  const isAuthPage = pathname === "/tutor/login" || pathname === "/tutor/register";

  useEffect(() => {
    if (!isAuthPage) {
      const data = sessionStorage.getItem("tutorData");
      if (!data) {
        router.push("/tutor/login");
      } else {
        const parsed = JSON.parse(data);
        setTutorName(parsed.fullName || "");
      }
    }
  }, [pathname, router, isAuthPage]);

  const handleLogout = () => {
    sessionStorage.removeItem("tutorData");
    router.push("/tutor/login");
  };

  if (isAuthPage) {
    return <>{children}</>;
  }

  return (
    <div className="min-h-screen bg-[#F9FAFB] font-sans text-[#161616] flex flex-col selection:bg-[#B3191F] selection:text-white">
      {/* Persistent App Shell Header */}
      <header className="sticky top-0 z-50 bg-white/90 backdrop-blur-md border-b border-gray-200 px-6 py-4 flex justify-between items-center shadow-xs">
        <div className="flex items-center gap-8">
          <Link href="/" className="text-2xl font-black tracking-tight flex items-center gap-2">
            Tutor<span className="text-[#B3191F]">Mint</span>
            <span className="text-[10px] px-2 py-0.5 bg-red-50 text-[#B3191F] rounded-full font-bold uppercase tracking-wider border border-red-100">
              Tutor Portal
            </span>
          </Link>
          <nav className="hidden md:flex items-center gap-6">
            <Link 
              href="/tutor/dashboard" 
              className={`text-sm font-semibold transition-colors ${
                pathname === "/tutor/dashboard" 
                  ? "text-[#B3191F]" 
                  : "text-gray-600 hover:text-gray-900"
              }`}
            >
              Dashboard
            </Link>
          </nav>
        </div>

        <div className="flex items-center gap-4">
          {tutorName && (
            <div className="hidden sm:flex items-center gap-2 bg-gray-50 border border-gray-200 px-3 py-1.5 rounded-lg">
              <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
              <span className="text-xs font-bold text-gray-700">{tutorName}</span>
            </div>
          )}
          <button 
            onClick={handleLogout}
            className="text-xs font-bold text-[#B3191F] bg-red-50 hover:bg-red-100 border border-red-200 px-3.5 py-2 rounded-lg transition-colors shadow-xs"
          >
            Logout
          </button>
        </div>
      </header>

      {/* Persistent Main Workspace */}
      <main className="flex-grow max-w-5xl w-full mx-auto p-6 md:p-8 animate-fadeIn">
        {children}
      </main>

      {/* Persistent App Shell Footer */}
      <footer className="bg-white border-t border-gray-200 py-4 px-6 text-center text-xs text-gray-500">
        <p>© {new Date().getFullYear()} TutorMint. All rights reserved. • Secure Educator Workspace</p>
      </footer>
    </div>
  );
}