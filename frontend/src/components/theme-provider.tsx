"use client"

import { ThemeProvider as NextThemesProvider } from "next-themes"
import type * as React from "react"

/** Class-based theme (`.dark` on <html>), follows the OS until the user picks one. */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      {children}
    </NextThemesProvider>
  )
}
