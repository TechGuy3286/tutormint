'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'

export default function UnifiedLoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const supabase = createClient()

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const { data, error: loginError } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (loginError || !data.session?.user) {
      setError(loginError?.message || 'Invalid login credentials')
      setLoading(false)
      return
    }

    const userId = data.session.user.id

    // Check role and route accordingly
    const { data: tutorProfile } = await supabase
      .from('tutors')
      .select('user_id')
      .eq('user_id', userId)
      .maybeSingle()

    if (tutorProfile) {
      window.location.href = '/tutor/dashboard'
      return
    }

    const { data: parentProfile } = await supabase
      .from('parents')
      .select('user_id')
      .eq('user_id', userId)
      .maybeSingle()

    if (parentProfile) {
      window.location.href = '/parent/dashboard'
      return
    }

    await supabase.auth.signOut()
    setError('No profile found for this account in the database.')
    setLoading(false)
  }

  return (
    <main className="min-h-screen bg-gray-50 flex flex-col justify-center py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full mx-auto space-y-8 bg-white p-8 rounded-3xl shadow-xl border border-gray-100">
        
        <div className="text-center space-y-2">
          <h1 className="text-2xl font-black text-black tracking-tight">TUTORMINT</h1>
          <p className="text-xs text-gray-400 uppercase tracking-widest font-semibold">Unified Portal Access</p>
        </div>

        {error && (
          <div className="p-3 bg-red-50 text-red-600 text-xs rounded-xl border border-red-100 font-medium text-center">
            {error}
          </div>
        )}

        <form onSubmit={handleLogin} className="space-y-5">
          <div>
            <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Email Address</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@example.com"
              className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm text-black placeholder-gray-400 focus:bg-white focus:ring-2 focus:ring-black focus:border-black outline-none transition-all"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Password</label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm text-black placeholder-gray-400 focus:bg-white focus:ring-2 focus:ring-black focus:border-black outline-none transition-all"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-4 bg-black hover:bg-emerald-600 text-white font-bold text-xs tracking-widest uppercase rounded-xl shadow-lg transition-all duration-200 disabled:opacity-50"
          >
            {loading ? 'Authenticating & Routing...' : 'Sign In to TutorMint'}
          </button>
        </form>

        <div className="text-center pt-4 border-t border-gray-100 space-y-2">
          <p className="text-xs text-gray-500">
            Want to become a tutor? <a href="/register/tutor" className="text-black font-bold hover:underline">Apply here</a>
          </p>
          <p className="text-xs text-gray-500">
            Need to post a job? <a href="/register/parent" className="text-emerald-600 font-bold hover:underline">Parent Signup</a>
          </p>
        </div>

      </div>
    </main>
  )
}