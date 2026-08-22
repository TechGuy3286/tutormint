'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function ParentLoginPage() {
  const [identifier, setIdentifier] = useState('')
  const [loading, setLoading] = useState(false)
  const [step, setStep] = useState<'input' | 'otp'>('input')
  const [otpCode, setOtpCode] = useState('')
  const router = useRouter()

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)

    try {
      const res = await fetch('/api/auth/parent-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier })
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error)

      alert(data.message)
      if (data.method === 'phone') {
        setStep('otp')
      } else {
        // Email magic link sent
        setIdentifier('')
      }
    } catch (err: any) {
      alert(err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)

    try {
      const res = await fetch('/api/auth/otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: identifier, otpCode, action: 'verify' })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)

      alert('Login successful!')
      router.push('/parent/profile')
    } catch (err: any) {
      alert(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="max-w-md mx-auto p-8 bg-white rounded-2xl shadow-sm border border-gray-200 my-20 space-y-6">
      <div>
        <h1 className="text-2xl font-black text-slate-900">Parent Portal Login</h1>
        <p className="text-xs text-gray-500 mt-1">Sign in or create an account instantly to contact verified tutors and post jobs.</p>
      </div>

      {step === 'input' ? (
        <form onSubmit={handleLoginSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Email or Phone Number</label>
            <input
              type="text"
              required
              placeholder="e.g., 03001234567 or parent@gmail.com"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm outline-none focus:bg-white focus:ring-2 focus:ring-emerald-500"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full py-4 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs uppercase rounded-xl shadow-lg transition-all disabled:opacity-50"
          >
            {loading ? 'Processing...' : 'Continue to Parent Portal →'}
          </button>
        </form>
      ) : (
        <form onSubmit={handleVerifyOtp} className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Enter 4-Digit OTP Code Sent to Phone</label>
            <input
              type="text"
              required
              maxLength={4}
              placeholder="1234"
              value={otpCode}
              onChange={(e) => setOtpCode(e.target.value)}
              className="w-full text-center tracking-widest text-lg px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl font-mono outline-none focus:bg-white focus:ring-2 focus:ring-emerald-500"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full py-4 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs uppercase rounded-xl shadow-lg transition-all disabled:opacity-50"
          >
            {loading ? 'Verifying...' : 'Verify Code & Login'}
          </button>
        </form>
      )}

      <div className="text-center pt-2 border-t border-gray-100">
        <p className="text-xs text-gray-500">Are you an educator? <a href="/tutor/login" className="text-emerald-600 font-bold hover:underline">Tutor Login here</a></p>
      </div>
    </div>
  )
}