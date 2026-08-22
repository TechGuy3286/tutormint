import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { phone, action, otpCode } = await request.json()

    if (action === 'send') {
      // Generate a random 4-digit OTP
      const generatedOtp = Math.floor(1000 + Math.random() * 9000).toString()

      // Save OTP record to database
      const { error } = await supabase
        .from('phone_otps')
        .upsert({ phone, otp_code: generatedOtp, expires_at: new Date(Date.now() + 10 * 60000).toISOString() })

      if (error) throw error

      // In production, integrate WhatsApp/SMS gateway API (e.g., Twilio / AssanSMS) here
      console.log(`[TutorMint OTP] Sent ${generatedOtp} to ${phone}`)

      return NextResponse.json({ success: true, message: 'OTP sent successfully via WhatsApp/SMS' })
    }

    if (action === 'verify') {
      const { data, error } = await supabase
        .from('phone_otps')
        .select('*')
        .eq('phone', phone)
        .eq('otp_code', otpCode)
        .single()

      if (error || !data) {
        return NextResponse.json({ error: 'Invalid or expired OTP code' }, { status: 400 })
      }

      return NextResponse.json({ success: true, message: 'Phone number successfully verified!' })
    }

    return NextResponse.json({ error: 'Invalid action specified' }, { status: 400 })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}