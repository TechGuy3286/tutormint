import { permanentRedirect } from 'next/navigation'

// Legacy path kept alive: there is one /login for everyone now. Permanent (308)
// so a crawler and a browser cache the move rather than re-requesting it.
export default function TutorLoginRedirect() {
  permanentRedirect('/login')
}