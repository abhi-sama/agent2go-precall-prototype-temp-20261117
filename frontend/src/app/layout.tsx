import type { Metadata, Viewport } from "next"
import { GeistMono } from "geist/font/mono"
import localFont from "next/font/local"
import { AppearanceProvider } from "@/lib/appearance/appearance-provider"
import { APPEARANCE_BOOT_SCRIPT } from "@/lib/appearance/appearance-provider"
import { ThemeProvider } from "@/components/theme-provider"
import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"
import { DataProvider } from "@/lib/data/data-provider"
import { SessionProvider } from "@/lib/session/session-provider"
import "./globals.css"

/** Inter (variable, latin) served from our own bundle with an adjusted fallback, so text does not jump when it loads. */
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
  colorScheme: "light dark",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#1c1917" },
  ],
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning data-style="warm" data-density="comfortable" className={`${inter.variable} ${GeistMono.variable} h-full`}>
      <body className="min-h-full">
        <script dangerouslySetInnerHTML={{ __html: APPEARANCE_BOOT_SCRIPT }} />
        <a
          href="#main"
          className="sr-only z-50 rounded-lg bg-primary px-4 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
        >
          Skip to content
        </a>
        <ThemeProvider>
          <TooltipProvider>
            <SessionProvider>
              <DataProvider>
                <AppearanceProvider>{children}</AppearanceProvider>
              </DataProvider>
            </SessionProvider>
          </TooltipProvider>
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  )
}
