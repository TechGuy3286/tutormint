import type { Metadata } from 'next'
import { EDIT_PROFILE_LABEL } from '@/lib/memberNav'

// The tutor's Edit Profile page (owner, 4 Nov 2026: was "Settings"). The
// address /tutor/dashboard/settings is unchanged. The page is a client
// component, so its title is set here.
export const metadata: Metadata = {
  title: `${EDIT_PROFILE_LABEL} | TutorMint`,
  robots: { index: false, follow: false },
}

export default function EditProfileLayout({ children }: { children: React.ReactNode }) {
  return children
}
