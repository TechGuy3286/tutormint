import { permanentRedirect } from 'next/navigation'

// Legacy path kept alive: there is one /login for everyone now.
export default function ParentLoginRedirect() {
  permanentRedirect('/login')
}
