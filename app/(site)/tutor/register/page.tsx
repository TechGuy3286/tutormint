import { permanentRedirect } from 'next/navigation'

// Legacy path kept alive (linked from the homepage and /faq): there is one
// /register for everyone now, with a role chooser.
export default function TutorRegisterRedirect() {
  permanentRedirect('/register')
}
