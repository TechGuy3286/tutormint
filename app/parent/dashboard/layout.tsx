'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

export default function ParentDashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const [userName, setUserName] = useState('Parent')
  const [loading, setLoading] = useState(true)
  const router = useRouter()
  const supabase = createClient()

  useEffect(() => {
    fetchParentName()
  }, [])

  const fetchParentName = async () => {
    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser()
      if (authError || !user) {
        router.replace('/login')
        return
      }

      // Fetch full name from parent_profiles table
      const { data: profile } = await supabase
        .from('parent_profiles')
        .select('full_name')
        .eq('id', user.id)
        .single()

      if (profile?.full_name) {
        setUserName(profile.full_name)
      } else {
        setUserName(user.email?.split('@')[0] || 'Parent')
      }
    } catch (err) {
      console.error("Error fetching parent name:", err)
    } finally {
      setLoading(false)
    }
  }

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push('/login')
  }

  return (
    <div className="min-h-screen bg-[#F8FAFC] font-sans text-[#334155] flex flex-col justify-between">
      {/* Global Parent Navigation Bar */}
      <header className="bg-white border-b border-gray-200 px-6 py-4 flex justify-between items-center shadow-xs">
        <Link href="/parent/dashboard" className="text-lg font-black text-[#0F172A]">
          Tutor<span className="text-[#d60008]">Mint</span>
        </Link>
        <div className="flex items-center gap-4">
          <span className="text-xs font-bold text-[#0F172A]">Welcome, {userName}</span>
          <button 
            onClick={handleLogout}
            className="px-3 py-1.5 bg-red-50 hover:bg-red-100 text-[#d60008] text-xs font-bold rounded-xl transition-colors"
          >
            Logout
          </button>
        </div>
      </header>

      <div className="flex-1">
        {children}
      </div>
    </div>
  )
}