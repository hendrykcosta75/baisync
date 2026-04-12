import type { Metadata } from 'next'
import { GeistSans } from 'geist/font/sans'
import { GeistMono } from 'geist/font/mono'
import { JetBrains_Mono } from 'next/font/google'

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jetbrains-mono',
})
import './globals.css'
import { Providers } from './providers'

export const metadata: Metadata = {
  title: 'Baisync — Impulsionando Negócios com IA',
  description: 'Plataforma de agentes de IA e consultoria inteligente para impulsionar seu negócio.',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="pt-BR" className={`${GeistSans.variable} ${GeistMono.variable} ${jetbrainsMono.variable} dark text-foreground bg-background`} data-theme="dark" style={{ colorScheme: 'dark' }} suppressHydrationWarning>
      <body suppressHydrationWarning>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
