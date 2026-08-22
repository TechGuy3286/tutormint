import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { identifier } = await request.json() // Can be email or phone

    if (!identifier) {
      return NextResponse.json({ error: 'Email or phone number is required' }, { status: 400 })
    }

    const isEmail = identifier.includes('@')

    if (isEmail) {
      // Option A: Sign in / Sign up via Magic Link for Emails
      const { error } = await supabase.auth.signInWithOtp({
        email: identifier,
        options: {
          emailRedirectTo: `${request.headers.get('origin')}/parent/profile`
        }
      })

      if (error) throw error

      return NextResponse.json({ 
        success: true, 
        method: 'email',
        message: 'Magic link sent to your email! Check your inbox to log in.' 
      })
    } else {
      // Option B: Phone number login using our custom phone_otps table
      const phone = identifier.trim()
      const generatedOtp = Math.floor(1000 + Math.random() * 9000).toString()

      // Save OTP to Supabase phone_otps table
      const { error: otpError } = await supabase
        .from('phone_otps')
        .upsert({ 
          phone, 
          otp_code: generatedOtp, 
          expires_at: new Date(Date.now() + 10 * 60000).toISOString() 
        })

      if (otpError) throw otpError

      // In production, integrate your WhatsApp/SMS gateway here
      console.log(`[TutorMint Parent OTP] Send code ${generatedOtp} to ${phone}`)

      return NextResponse.json({ 
        success: true, 
        method: 'phone',
        phone,
        message: 'OTP verification code generated successfully!' 
      })
    }
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}