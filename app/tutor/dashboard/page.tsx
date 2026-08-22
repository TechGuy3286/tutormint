'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'

export default function TutorDashboardPage() {
  const [loadingRole, setLoadingRole] = useState(true)
  const supabase = createClient()

  useEffect(() => {
    const verifySession = async () => {
      try {
        const { data: { session }, error: sessionError } = await supabase.auth.getSession()
        if (sessionError || !session?.user) {
          window.location.href = '/login'
          return
        }
        
        setLoadingRole(false)
      } catch (err) {
        console.error('Session error:', err)
        window.location.href = '/login'
      }
    }

    verifySession()
  }, [supabase])

  if (loadingRole) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-xs font-bold text-gray-400 uppercase tracking-widest animate-pulse">
          Verifying session...
        </div>
      </div>
    )
  }

  return (
    <main className="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-4xl mx-auto space-y-8 bg-white p-8 rounded-2xl shadow-sm">
        <h1 className="text-3xl font-black text-slate-900">Tutor Dashboard (Diagnostic Mode)</h1>
        <p className="text-sm text-emerald-600 font-bold">🎉 Loop broken successfully! You are logged in.</p>
      </div>
    </main>
  )
}