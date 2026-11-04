"use client"

import { LogOut, Stethoscope } from "lucide-react"
import dynamic from "next/dynamic"
import Link from "next/link"
import { usePathname } from "next/navigation"
import type * as React from "react"
import { PERSONA_CONFIG, type NavItem } from "@/components/shell/persona-config"
import { ThemeToggle } from "@/components/shell/theme-toggle"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { IS_LOCAL_BUILD } from "@/lib/env"
import { useSession } from "@/lib/session/session-provider"
import { cn } from "@/lib/utils"

/**
 * Local builds only. In any other build the switcher is not rendered and a stored identity is
 * ignored (session-provider falls back to the default); checked against a non-local `next start`.
 */
const PersonaSwitcher =
  process.env.NEXT_PUBLIC_APP_ENV === "local"
    ? dynamic(() => import("@/components/shell/persona-switcher").then((m) => m.PersonaSwitcher))
    : () => null

function NavLink({ item, active, rail }: { item: NavItem; active: boolean; rail: boolean }) {
  const Icon = item.icon
  const base = cn(
    "flex min-h-11 shrink-0 items-center gap-2.5 rounded-xl px-4 text-sm font-medium transition-colors",
    rail ? "w-full" : "snap-item",
  )
  if (!item.href) {
    return (
      <span aria-disabled="true" className={cn(base, "cursor-not-allowed text-muted-foreground/70")}>
        <Icon className="size-[1.1rem]" aria-hidden />
        <span className="whitespace-nowrap">{item.label}</span>
        <Badge variant="outline" className="ml-auto h-5 px-1.5 text-[0.65rem]">
          Soon
        </Badge>
      </span>
    )
  }
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        base,
        active
          ? "bg-primary text-primary-foreground shadow-card"
          : "text-foreground/80 hover:bg-accent hover:text-accent-foreground",
      )}
    >
      <Icon className="size-[1.1rem]" aria-hidden />
      <span className="whitespace-nowrap">{item.label}</span>
    </Link>
  )
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const { user, signOut } = useSession()
  const config = PERSONA_CONFIG[user.persona]

  return (
    <div className="flex min-h-dvh flex-col bg-background lg:flex-row">
      {/* Desktop rail */}
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col gap-6 border-r border-sidebar-border bg-sidebar p-4 lg:flex">
        <Brand />
        <nav aria-label="Primary" className="flex flex-col gap-1">
          <p className="px-4 pb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{config.tagline}</p>
          {config.nav.map((item) => (
            <NavLink key={item.label} item={item} active={item.href === pathname} rail />
          ))}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="safe-pt sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur-md">
          <div className="safe-px flex min-h-16 items-center justify-between gap-3 py-2">
            <div className="lg:hidden">
              <Brand />
            </div>
            <div className="ml-auto flex items-center gap-2">
              {IS_LOCAL_BUILD && (
                <Badge variant="outline" className="hidden h-7 border-warning/50 text-warning sm:inline-flex">
                  Local
                </Badge>
              )}
              <PersonaSwitcher />
              <ThemeToggle />
              {signOut && (
                <Button
                  variant="outline"
                  size="icon"
                  data-testid="sign-out"
                  aria-label="Sign out"
                  onClick={() => void signOut()}
                >
                  <LogOut aria-hidden />
                </Button>
              )}
            </div>
          </div>
          {/* Swipeable section tabs for iPad portrait and phones */}
          <nav aria-label="Sections" className="safe-px scroll-snap-x flex gap-1.5 overflow-x-auto pb-2 lg:hidden">
            {config.nav.map((item) => (
              <NavLink key={item.label} item={item} active={item.href === pathname} rail={false} />
            ))}
          </nav>
        </header>

        <main id="main" className="safe-px safe-pb flex-1 py-6 lg:py-8">
          <div className="mx-auto w-full max-w-[84rem]">{children}</div>
        </main>
      </div>
    </div>
  )
}

function Brand() {
  return (
    <Link href="/" className="flex min-h-11 items-center gap-2.5 rounded-xl pr-2" aria-label="MSL Agent home">
      <span className="grid size-9 place-items-center rounded-xl bg-primary text-primary-foreground shadow-lift">
        <Stethoscope className="size-5" aria-hidden />
      </span>
      <span className="flex flex-col leading-none">
        <span className="text-[1.05rem] font-semibold tracking-tight">MSL Agent</span>
        <span className="mt-0.5 text-[0.68rem] font-medium tracking-wide text-muted-foreground uppercase">agent2go</span>
      </span>
    </Link>
  )
}
