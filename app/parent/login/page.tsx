import { redirect } from 'next/navigation'

// Legacy path kept alive: there is one /login for everyone now.
export default function ParentLoginRedirect() {
  redirect('/login')
}
