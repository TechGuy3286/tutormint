import './globals.css'

export const metadata = {
  title: 'TutorMint | Verified Home & Online Tutors Network',
  description: 'Find verified private tutors instantly with zero middlemen.',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-[#F8FAFC] font-sans text-[#334155] antialiased">
        {children}
      </body>
    </html>
  )
}