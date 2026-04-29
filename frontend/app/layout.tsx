import type { Metadata, Viewport } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import { Toaster } from 'sonner'
import { DemoProvider } from '@/lib/demo-context'
import { SimulationProvider } from '@/lib/simulation-context'
import './globals.css'

const geistSans = Geist({ subsets: ["latin"], variable: "--font-sans" })
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono" })

export const metadata: Metadata = {
  title: 'Clinical Operations Platform',
  description: 'Unified clinical monitoring platform for remote patient monitoring with real-time vitals, CDS alerts, and HEDIS care gap tracking.',
  icons: {
    icon: '/icon.svg',
  },
}

export const viewport: Viewport = {
  themeColor: '#00684A',
  width: 'device-width',
  initialScale: 1,
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} font-sans antialiased min-h-screen bg-background text-foreground`}>
        <DemoProvider>
          <SimulationProvider>
            {children}
            <Toaster richColors closeButton position="top-right" />
          </SimulationProvider>
        </DemoProvider>
      </body>
    </html>
  )
}
