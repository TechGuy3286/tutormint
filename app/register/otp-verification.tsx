'use client'

import { useState } from 'react'

export default function OtpVerificationModal({ phone, onVerified }: { phone: string, onVerified: () => void }) {
  const [otp, setOtp] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(true)

  const handleSendOtp = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/auth/otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, action: 'send' })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setSent(true)
      alert('OTP sent to your phone via WhatsApp/SMS!')
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
        body: JSON.stringify({ phone, otpCode: otp, action: 'verify' })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)

      alert('Verification successful!')
      onVerified()
    } catch (err: any) {
      alert(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm space-y-4 max-w-md mx-auto my-6">
      <div>
        <span className="px-3 py-1 bg-emerald-50 text-emerald-700 text-[10px] font-bold uppercase rounded-full">
          Secure SMS / WhatsApp OTP
        </span>
        <h3 className="text-lg font-bold text-slate-900 mt-2">Verify Your Phone Number</h3>
        <p className="text-xs text-gray-500">We sent a verification code to <span className="font-mono font-bold text-slate-800">{phone}</span></p>
      </div>

      <form onSubmit={handleVerifyOtp} className="space-y-4">
        <div>
          <input
            type="text"
            required
            maxLength={4}
            placeholder="Enter 4-digit OTP"
            value={otp}
            onChange={(e) => setOtp(e.target.value)}
            className="w-full text-center tracking-widest text-lg px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl font-mono outline-none focus:bg-white focus:ring-2 focus:ring-emerald-500"
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs uppercase rounded-xl transition-all shadow-md disabled:opacity-50"
        >
          {loading ? 'Verifying...' : 'Verify OTP Code'}
        </button>

        <div className="text-center">
          <button
            type="button"
            onClick={handleSendOtp}
            className="text-xs text-emerald-600 font-bold hover:underline"
          >
            Resend OTP Code
          </button>
        </div>
      </form>
    </div>
  )
}