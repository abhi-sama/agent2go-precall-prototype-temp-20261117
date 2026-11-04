"use client"

import { Moon, Sun } from "lucide-react"
import { useTheme } from "next-themes"
import * as React from "react"
import { Button } from "@/components/ui/button"
import { log } from "@/lib/log/logger"

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme()
  // False on the server and during hydration, true afterwards: avoids a theme icon mismatch.
  const mounted = React.useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  )

  const isDark = mounted && resolvedTheme === "dark"
  const next = isDark ? "light" : "dark"

  return (
    <Button
      variant="outline"
      size="icon"
      data-testid="theme-toggle"
      aria-label={`Switch to ${next} mode`}
      aria-pressed={isDark}
      onClick={() => {
        setTheme(next)
        log.info("theme changed", { theme: next })
      }}
    >
      {isDark ? <Sun aria-hidden /> : <Moon aria-hidden />}
    </Button>
  )
}
