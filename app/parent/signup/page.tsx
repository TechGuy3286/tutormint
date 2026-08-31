import { redirect } from 'next/navigation'

// Legacy path kept alive: there is one /register for everyone now.
export default function ParentSignupRedirect() {
  redirect('/register')
}
