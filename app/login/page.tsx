'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'

export default function UnifiedLoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [checkingSession, setCheckingSession] = useState(true)
  const [activeUser, setActiveUser] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const supabase = createClient()

  useEffect(() => {
    const checkActiveSession = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (session?.user?.email) {
          setActiveUser(session.user.email)
        }
      } catch (err) {
        console.error(err)
      } finally {
        setCheckingSession(false)
      }
    }
    checkActiveSession()
  }, [supabase])

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

    const userEmail = data.session.user.email || ''

    // Direct routing based on email role identifier
    if (userEmail.includes('tutor')) {
      window.location.href = '/tutor/dashboard'
      return
    }
    if (userEmail.includes('parent')) {
      window.location.href = '/parent/dashboard'
      return
    }

    window.location.href = '/tutor/dashboard'
  }

  const goToDashboard = async () => {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) {
      window.location.reload()
      return
    }

    const userEmail = session.user.email || ''

    // Instant direct routing bypassing database lookup errors
    if (userEmail.includes('parent')) {
      window.location.href = '/parent/dashboard'
    } else {
      window.location.href = '/tutor/dashboard'
    }
  }

  if (checkingSession) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-xs font-bold text-gray-400 uppercase tracking-widest animate-pulse">
          Verifying session...
        </div>
      </div>
    )
  }

  if (activeUser) {
    return (
      <main className="min-h-screen bg-gray-50 flex flex-col justify-center py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-md w-full mx-auto space-y-6 bg-white p-8 rounded-3xl shadow-xl border border-gray-100 text-center">
          <h1 className="text-2xl font-black text-black tracking-tight">TUTORMINT</h1>
          <p className="text-xs text-gray-400 uppercase tracking-widest font-semibold">Active Session</p>
          
          <div className="p-4 bg-emerald-50 rounded-2xl border border-emerald-100 text-emerald-900 text-xs font-medium space-y-1">
            <p>You are logged in as</p>
            <strong className="font-bold text-sm">{activeUser}</strong>
          </div>

          <div className="space-y-3">
            <button
              onClick={goToDashboard}
              className="w-full py-4 bg-black hover:bg-emerald-600 text-white font-bold text-xs tracking-widest uppercase rounded-xl shadow-lg transition-all"
            >
              Go to Your Dashboard →
            </button>
            <button
              onClick={async () => {
                await supabase.auth.signOut()
                window.location.reload()
              }}
              className="w-full py-3 bg-gray-100 hover:bg-gray-200 text-slate-700 font-bold text-xs tracking-wider uppercase rounded-xl transition-all"
            >
              Log Out
            </button>
          </div>
        </div>
      </main>
    )
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