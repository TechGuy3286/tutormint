'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

export default function TrustFeePage() {
  const [loading, setLoading] = useState(false)
  const [transactionId, setTransactionId] = useState('')
  const router = useRouter()
  const supabase = createClient()

  const handleAssanPaySubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!transactionId.trim()) {
      alert('Please enter your AssanPay transaction reference ID.')
      return
    }

    setLoading(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Unauthorized')

      const { error } = await supabase
        .from('tutor_trust_fees')
        .upsert({
          user_id: user.id,
          assanpay_tx_id: transactionId.trim(),
          status: 'pending_verification',
          amount: '199 PKR'
        })

      if (error) throw error

      alert('AssanPay payment reference submitted successfully! Admin will verify within 24 hours.')
      router.push('/tutor/dashboard')
    } catch (err: any) {
      alert(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="max-w-xl mx-auto p-8 my-10 bg-white rounded-2xl shadow-sm border border-gray-200 space-y-6">
      <div>
        <span className="px-3 py-1 bg-emerald-50 text-emerald-700 text-[10px] font-bold uppercase rounded-full">
          AssanPay Secured Gateway
        </span>
        <h1 className="text-2xl font-black text-slate-900 mt-2">199 PKR Trust Fee Verification</h1>
        <p className="text-xs text-gray-500 mt-1">
          Your 1st month trial is completely free. To maintain your verified status and active directory listing after the trial, submit your 199 PKR trust fee via AssanPay.
        </p>
      </div>

      <div className="p-4 bg-gray-50 rounded-xl space-y-3 text-xs text-slate-700">
        <p className="font-bold uppercase tracking-wider text-slate-900">How to pay via AssanPay:</p>
        <ol className="list-decimal list-inside space-y-1 text-gray-600">
          <li>Transfer 199 PKR to our official AssanPay merchant account: <span className="font-mono font-bold text-slate-900">0321-1045245</span></li>
          <li>Copy the transaction / reference ID from your SMS or app receipt.</li>
          <li>Paste the transaction ID below for instant tracking and badge activation.</li>
        </ol>
      </div>

      <form onSubmit={handleAssanPaySubmit} className="space-y-4">
        <div>
          <label className="block text-xs font-bold text-slate-700 uppercase mb-1">AssanPay Transaction ID / Receipt Number</label>
          <input
            type="text"
            required
            placeholder="e.g., AP-99482710"
            value={transactionId}
            onChange={(e) => setTransactionId(e.target.value)}
            className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm outline-none focus:bg-white focus:ring-2 focus:ring-emerald-500 font-mono"
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full py-4 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs uppercase rounded-xl shadow-lg transition-all disabled:opacity-50"
        >
          {loading ? 'Submitting Payment Proof...' : 'Verify AssanPay 199 PKR Payment'}
        </button>
      </form>
    </div>
  )
}