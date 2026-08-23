'use client'

import { useState, Suspense } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'

function LoginForm() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const router = useRouter()
  const searchParams = useSearchParams()
  const supabase = createClient()

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    const { error } = await supabase.auth.signInWithPassword({ email, password })
    
    if (error) {
      setError(error.message)
      setLoading(false)
    } else {
      // Read the redirect query parameter, or default to post-job if saved session exists, or dashboard
      const redirectParam = searchParams.get('redirect')
      const hasSavedJob = sessionStorage.getItem('savedJobSession') !== null

      if (redirectParam) {
        router.push(redirectParam)
      } else if (hasSavedJob) {
        router.push('/parent/dashboard/post-job')
      } else {
        router.push('/parent/dashboard')
      }
      router.refresh()
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-[#F8FAFC] px-4 py-12">
      <div className="max-w-md w-full bg-white p-8 rounded-3xl shadow-sm border border-gray-200 space-y-6">
        <div className="text-center space-y-2">
          <h1 className="text-2xl font-black text-[#0F172A]">Parent Login</h1>
          <p className="text-xs text-gray-500">Log in to publish your job and connect instantly with verified tutors.</p>
        </div>

        {error && (
          <div className="p-3 bg-red-50 border border-red-200 text-[#d60008] text-xs font-bold rounded-xl text-center">
            {error}
          </div>
        )}

        <form onSubmit={handleLogin} className="space-y-4">
          <div className="space-y-1">
            <label className="text-xs font-bold text-[#0F172A]">Email Address</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="parent@example.com"
              className="w-full p-3 bg-[#F8FAFC] border border-gray-200 rounded-xl text-xs outline-none focus:border-[#0F172A] focus:bg-white text-[#334155]"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-bold text-[#0F172A]">Password</label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full p-3 bg-[#F8FAFC] border border-gray-200 rounded-xl text-xs outline-none focus:border-[#0F172A] focus:bg-white text-[#334155]"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3.5 bg-[#d60008] hover:bg-red-700 text-white font-extrabold text-xs uppercase tracking-wider rounded-xl shadow-md transition-all disabled:opacity-50"
          >
            {loading ? 'Logging in...' : 'Login & Restore Job ➔'}
          </button>
        </form>

        <div className="text-center text-xs text-gray-500">
          Don't have an account?{' '}
          <Link href="/parent/register" className="font-bold text-[#0F172A] hover:underline">
            Register here
          </Link>
        </div>
      </div>
    </main>
  )
}

export default function ParentLoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center text-xs font-bold text-gray-500">Loading...</div>}>
      <LoginForm />
    </Suspense>
  )
}