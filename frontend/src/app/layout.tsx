// First: declares the cascade-layer order before any stylesheet names a layer (Astryx migration-setup).
import "./layers.css"
import "./globals.css"
import "./theme-patches.css"

import type { Metadata, Viewport } from "next"
import { GeistMono } from "geist/font/mono"
import localFont from "next/font/local"
import { APPEARANCE_BOOT_SCRIPT, AppearanceProvider } from "@/lib/appearance/appearance-provider"
import { Toaster } from "@/components/ui/sonner"
import { DataProvider } from "@/lib/data/data-provider"
import { SessionProvider } from "@/lib/session/session-provider"
import { OfflineProvider } from "@/lib/offline/offline-provider"

/** Inter (variable, latin) served from our own bundle: the fallback face under each Astryx theme's own type. */
const inter = localFont({
  src: "../../node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2",
  variable: "--font-inter",
  weight: "100 900",
  display: "swap",
})

export const metadata: Metadata = {
  title: { default: "MSL Agent", template: "%s · MSL Agent" },
  description: "Field insight workspace for Medical Science Liaisons.",
  appleWebApp: { capable: true, title: "MSL Agent", statusBarStyle: "default" },
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
  // MWG dark-mode: declare both schemes up front so the first canvas paint already matches the device.
  colorScheme: "light dark",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#1b1b1b" },
  ],
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // The boot script writes the saved look onto <html> before hydration, hence suppressHydrationWarning.
    <html lang="en" suppressHydrationWarning data-density="comfortable" className={`${inter.variable} ${GeistMono.variable} h-full`}>
      <body className="min-h-full">
        <script dangerouslySetInnerHTML={{ __html: APPEARANCE_BOOT_SCRIPT }} />
        <SessionProvider>
          <OfflineProvider>
            <DataProvider>
              <AppearanceProvider>
                {children}
                <Toaster />
              </AppearanceProvider>
            </DataProvider>
          </OfflineProvider>
        </SessionProvider>
      </body>
    </html>
  )
}
