'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')

  const router = useRouter()
  const supabase = createClient()

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setErrorMsg('')

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      })

      if (error) throw error

      // Set session flags safely
      localStorage.setItem('tm_logged_in', 'true')
      localStorage.setItem('tm_email', email)

      // Check if user is a tutor or parent and route accordingly
      const userId = data.user?.id
      const { data: tutorProfile } = await supabase
        .from('tutors')
        .select('id')
        .eq('id', userId)
        .single()

      if (tutorProfile) {
        router.push('/tutor/dashboard')
      } else {
        router.push('/parent/dashboard')
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Invalid login credentials')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="min-h-screen bg-[#F8FAFC] flex items-center justify-center p-6 text-[#334155]">
      <div className="max-w-md w-full bg-white p-8 rounded-3xl shadow-xl border border-gray-200 space-y-6">
        
        <div className="text-center space-y-2">
          <Link href="/" className="text-xl font-black text-[#0F172A] inline-block">
            Tutor<span className="text-[#d60008]">Mint</span>
          </Link>
          <h1 className="text-xl font-black text-[#0F172A]">Sign In to Your Account</h1>
          <p className="text-xs text-gray-500">Access your verified dashboard and connect directly.</p>
        </div>

        {errorMsg && (
          <div className="p-3 bg-red-50 border border-red-200 text-[#d60008] text-xs font-bold rounded-xl text-center">
            {errorMsg}
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
              placeholder="name@example.com"
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
            className="w-full py-3.5 bg-[#d60008] hover:bg-red-700 text-white font-bold text-xs uppercase tracking-wider rounded-xl shadow-md transition-all disabled:opacity-50"
          >
            {loading ? 'Signing In...' : 'Sign In ➔'}
          </button>
        </form>

        <div className="text-center pt-2">
          <Link href="/" className="text-xs font-bold text-gray-500 hover:text-[#0F172A] transition-colors">
            ← Back to Home
          </Link>
        </div>

      </div>
    </main>
  )
}