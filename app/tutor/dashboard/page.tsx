'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'

export default function TutorDashboardPage() {
  const [loadingRole, setLoadingRole] = useState(true)
  const supabase = createClient()

  useEffect(() => {
    const verifyTutorRole = async () => {
      try {
        const { data: { session }, error: sessionError } = await supabase.auth.getSession()
        if (sessionError || !session?.user) {
          window.location.href = '/login'
          return
        }

        const user = session.user

        // Check if user exists in the 'tutors' table safely using maybeSingle()
        const { data: tutorProfile, error: tutorError } = await supabase
          .from('tutors')
          .select('user_id')
          .eq('user_id', user.id)
          .maybeSingle()

        if (tutorError || !tutorProfile) {
          // Check if they are a parent trying to sneak in
          const { data: parentProfile } = await supabase
            .from('parents')
            .select('user_id')
            .eq('user_id', user.id)
            .maybeSingle()

          if (parentProfile) {
            window.location.href = '/parent/dashboard'
            return
          } else {
            window.location.href = '/login'
            return
          }
        }
      } catch (err) {
        console.error('Role verification error:', err)
        window.location.href = '/login'
      } finally {
        setLoadingRole(false)
      }
    }

    verifyTutorRole()
  }, [supabase])

  if (loadingRole) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-xs font-bold text-gray-400 uppercase tracking-widest animate-pulse">
          Verifying tutor permissions...
        </div>
      </div>
    )
  }

  return (
    <main className="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-4xl mx-auto space-y-8 bg-white p-8 rounded-2xl shadow-sm border border-gray-200">
        <div className="flex justify-between items-center">
          <div>
            <span className="text-xs font-mono font-bold text-emerald-600 bg-emerald-50 px-2.5 py-1 rounded-full">
              Verified Tutor Portal
            </span>
            <h1 className="text-3xl font-black text-slate-900 mt-2">Sir Bilal Ahmed's Dashboard</h1>
          </div>
          <button
            onClick={async () => {
              await supabase.auth.signOut()
              window.location.href = '/login'
            }}
            className="px-4 py-2 bg-red-50 hover:bg-red-100 text-red-600 text-xs font-bold uppercase rounded-xl transition-all"
          >
            Logout
          </button>
        </div>
        <p className="text-sm text-gray-600">Your secure session and role verification are fully operational.</p>
      </div>
    </main>
  )
}