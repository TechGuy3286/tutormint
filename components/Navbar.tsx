"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";

export default function Navbar() {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <header className="bg-white border-b border-gray-200 px-4 sm:px-12 py-3.5 flex justify-between items-center sticky top-0 z-50 shadow-xs">
      {/* Logo Only (Subtext Removed) */}
      <Link href="/" className="flex items-center group mx-auto sm:mx-0">
        <img src="/logo.png" alt="TutorMint Logo" className="h-12 sm:h-16 w-50 object-contain" />
      </Link>

      {/* Right Side: Compact Expandable Login Menu */}
      <div className="relative" ref={menuRef}>
        <button
          onClick={() => setIsOpen(!isOpen)}
          onMouseEnter={() => setIsOpen(true)}
          className="flex items-center gap-1.5 px-3.5 py-2 bg-gray-100 hover:bg-gray-200 text-[#000000] text-xs font-bold rounded-xl transition-all shadow-2xs"
          aria-label="Login Menu"
        >
          <span>🔐 Login</span>
          <span className={`transform transition-transform duration-200 text-[10px] ${isOpen ? "rotate-180" : ""}`}>▼</span>
        </button>

        {/* Expandable Dropdown */}
        {isOpen && (
          <div 
            onMouseLeave={() => setIsOpen(false)}
            className="absolute right-0 mt-2 w-48 bg-white border border-gray-200 rounded-2xl shadow-xl py-2 z-50 animate-in fade-in slide-in-from-top-2 duration-200 flex flex-col"
          >
            <Link
              href="/parent/login"
              onClick={() => setIsOpen(false)}
              className="px-4 py-2.5 text-xs font-bold text-[#1f1f7a] hover:bg-gray-50 flex items-center justify-between transition-colors"
            >
              <span>👨‍👩‍👧‍👦 Parents Login</span>
              <span className="text-gray-400">➔</span>
            </Link>
            <div className="h-px bg-gray-100 my-1"></div>
            <Link
              href="/tutor/login"
              onClick={() => setIsOpen(false)}
              className="px-4 py-2.5 text-xs font-bold text-[#d60008] hover:bg-red-50 flex items-center justify-between transition-colors"
            >
              <span>🎓 Tutor Login</span>
              <span className="text-red-300">➔</span>
            </Link>
          </div>
        )}
      </div>
    </header>
  );
}