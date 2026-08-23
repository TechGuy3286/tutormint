'use client';

import { useState, useEffect } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

export default function Navbar() {
  const [user, setUser] = useState<any>(null);
  const [displayName, setDisplayName] = useState('');
  const router = useRouter();
  const supabase = createClient();

  useEffect(() => {
    const fetchUserData = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      setUser(user);

      if (user) {
        let { data: profile } = await supabase
          .from('parent_profiles')
          .select('full_name')
          .eq('id', user.id)
          .single();

        if (!profile?.full_name) {
          const { data: tutor } = await supabase
            .from('tutors')
            .select('full_name')
            .eq('id', user.id)
            .single();
          profile = tutor;
        }

        if (profile?.full_name) {
          setDisplayName(profile.full_name);
        } else {
          setDisplayName(user.email?.split('@')[0] || 'User');
        }
      }
    };

    fetchUserData();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      setUser(session?.user ?? null);
      if (session?.user) {
        fetchUserData();
      }
    });
    
    return () => {
      subscription.unsubscribe();
    };
  }, [supabase]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setUser(null);
    router.push('/');
    router.refresh();
  };

  return (
    <header className="bg-white border-b border-gray-200 px-4 sm:px-12 py-3.5 flex justify-between items-center sticky top-0 z-50 shadow-xs">
      {/* Logo & Public Navigation Links */}
      <div className="flex items-center gap-8">
        <Link href="/" className="flex items-center group">
          <img src="/logo.png" alt="TutorMint Logo" className="h-12 sm:h-16 w-auto object-contain" />
        </Link>
        <nav className="hidden md:flex items-center gap-6">
          <Link href="/tutors" className="text-xs font-bold text-[#334155] hover:text-[#d60008] transition-colors">
            🔍 Find Tutors
          </Link>
        </nav>
      </div>

      {/* Right Side: Only show user info and logout when logged in. Completely hidden when logged out. */}
      <div>
        {user ? (
          <div className="flex items-center gap-3">
            <span className="text-xs font-bold text-[#334155] hidden sm:inline">
              Welcome, {displayName || user.email || 'User'}
            </span>
            <button
              onClick={handleLogout}
              className="px-3.5 py-2 bg-red-50 hover:bg-red-100 text-[#d60008] text-xs font-bold rounded-xl transition-all shadow-2xs"
            >
              Logout
            </button>
          </div>
        ) : null}
      </div>
    </header>
  );
}