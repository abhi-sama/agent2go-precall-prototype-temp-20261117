"use client"

import { LogOut, Menu, PanelLeftClose, PanelLeftOpen } from "lucide-react"
import dynamic from "next/dynamic"
import Link from "next/link"
import { usePathname } from "next/navigation"
import * as React from "react"
import { PERSONA_CONFIG, type NavItem } from "@/components/shell/persona-config"
import { AppearanceSettings } from "@/components/shell/appearance-settings"
import { BrandMark } from "@/components/brand/brand-mark"
import { FirstRunOrientation } from "@/components/state/first-run-orientation"
import { ThemeToggle } from "@/components/shell/theme-toggle"
import { OfflineStatus } from "@/components/shell/offline-status"
import { SharedFilterProvider } from "@/components/filters/filter-context"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
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

const SIDEBAR_COLLAPSED_STORAGE_KEY = "a2g.sidebar.collapsed"

function readCollapsedSidebar() {
  try {
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === "true"
  } catch {
    return false
  }
}

function NavLink({
  item,
  active,
  collapsed = false,
  onNavigate,
}: {
  item: NavItem
  active: boolean
  collapsed?: boolean
  onNavigate?: () => void
}) {
  const Icon = item.icon
  const base = cn(
    "flex min-h-11 shrink-0 items-center gap-2.5 rounded-xl text-sm font-medium transition-colors",
    collapsed ? "justify-center px-0" : "px-4",
  )
  if (!item.href) {
    return (
      <span
        aria-disabled="true"
        title={collapsed ? item.label : undefined}
        className={cn(base, "cursor-not-allowed text-muted-foreground/70")}
      >
        <Icon className="size-[1.1rem]" aria-hidden />
        <span className={cn("whitespace-nowrap", collapsed && "sr-only")}>{item.label}</span>
        <Badge variant="outline" className={cn("ml-auto h-5 px-1.5 text-[0.65rem]", collapsed && "hidden")}>
          Soon
        </Badge>
      </span>
    )
  }
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      aria-label={collapsed ? item.label : undefined}
      title={collapsed ? item.label : undefined}
      onClick={onNavigate}
      className={cn(
        base,
        active
          ? "bg-nav-active text-nav-active-foreground shadow-card"
          : "text-foreground/80 hover:bg-accent hover:text-accent-foreground",
      )}
    >
      <Icon className="size-[1.1rem]" aria-hidden />
      <span className={cn("whitespace-nowrap", collapsed && "sr-only")}>{item.label}</span>
    </Link>
  )
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const { user, signOut } = useSession()
  const config = PERSONA_CONFIG[user.persona]
  const [collapsed, setCollapsed] = React.useState(false)
  const [navigationOpen, setNavigationOpen] = React.useState(false)
  // Several nav entries can share one route (MSL "Insights" lives on the territory page); only the first is current.
  const activeLabel = config.nav.find((item) => item.href === pathname)?.label

  React.useEffect(() => {
    // The saved preference is deliberately a local convenience: it contains no user or access data.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCollapsed(readCollapsedSidebar())
  }, [])

  const toggleCollapsed = () => {
    setCollapsed((current) => {
      const next = !current
      try {
        window.localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, String(next))
      } catch {
        // Private browsing still gets the chosen state for this visit.
      }
      return next
    })
  }

  return (
    <SharedFilterProvider>
    <div className="flex min-h-dvh flex-col bg-background desktop:flex-row">
      {/* Desktop rail */}
      <aside
        data-testid="sidebar-rail"
        data-collapsed={collapsed}
        className={cn(
          "sticky top-0 hidden h-dvh shrink-0 flex-col gap-6 border-r border-sidebar-border bg-sidebar p-4 desktop:flex",
          collapsed ? "w-20" : "w-64",
        )}
      >
        <div className={cn("flex items-center", collapsed ? "flex-col gap-2" : "justify-between gap-2")}>
          <Brand collapsed={collapsed} />
          <Button
            variant="ghost"
            size="icon"
            data-testid="sidebar-collapse"
            aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
            aria-pressed={collapsed}
            onClick={toggleCollapsed}
          >
            {collapsed ? <PanelLeftOpen aria-hidden /> : <PanelLeftClose aria-hidden />}
          </Button>
        </div>
        <nav aria-label="Primary" className="flex flex-col gap-1">
          <p className={cn("px-4 pb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase", collapsed && "sr-only")}>
            {config.tagline}
          </p>
          {config.nav.map((item) => (
            <NavLink key={item.label} item={item} active={item.label === activeLabel} collapsed={collapsed} />
          ))}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="safe-pt sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur-md">
          <div className="safe-px flex min-h-16 items-center justify-between gap-3 py-2">
            <div className="desktop:hidden flex min-w-0 items-center gap-2">
              <Button
                variant="ghost"
                size="icon"
                data-testid="sidebar-menu"
                aria-label="Open navigation"
                aria-expanded={navigationOpen}
                aria-controls="sidebar-sheet"
                onClick={() => setNavigationOpen(true)}
              >
                <Menu aria-hidden />
              </Button>
              <Brand />
            </div>
            <div className="ml-auto flex items-center gap-2">
              {IS_LOCAL_BUILD && (
                <Badge variant="outline" className="hidden h-7 border-warning/50 text-warning sm:inline-flex">
                  Local
                </Badge>
              )}
              <PersonaSwitcher />
              <AppearanceSettings />
              <ThemeToggle />
              <OfflineStatus />
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
        </header>

        <main id="main" className="safe-px safe-pb flex-1 py-6 lg:py-8">
          <div className="mx-auto w-full max-w-[84rem]">
            <FirstRunOrientation />
            {children}
          </div>
        </main>
      </div>
      <Sheet open={navigationOpen} onOpenChange={setNavigationOpen}>
        <SheetContent
          id="sidebar-sheet"
          side="left"
          data-testid="sidebar-sheet"
          className="safe-pt safe-pb gap-0 overflow-y-auto p-4 pr-3 data-[side=left]:w-[min(22rem,calc(100vw-1rem))] data-[side=left]:sm:max-w-none"
        >
          <SheetHeader className="p-0 pr-12">
            <SheetTitle className="sr-only">Navigation</SheetTitle>
            <Brand />
          </SheetHeader>
          <nav aria-label="Primary" className="mt-6 flex flex-col gap-1">
            <p className="px-4 pb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{config.tagline}</p>
            {config.nav.map((item) => (
              <NavLink
                key={item.label}
                item={item}
                active={item.label === activeLabel}
                onNavigate={() => setNavigationOpen(false)}
              />
            ))}
          </nav>
        </SheetContent>
      </Sheet>
    </div>
    </SharedFilterProvider>
  )
}

function Brand({ collapsed = false }: { collapsed?: boolean }) {
  return (
    <Link
      href="/"
      aria-label="MSL Agent home"
      title={collapsed ? "MSL Agent" : undefined}
      className={cn("flex min-h-11 items-center gap-2.5 rounded-xl", collapsed ? "justify-center" : "pr-2")}
    >
      <BrandMark priority />
      <span className={cn("text-base font-semibold tracking-tight", collapsed && "sr-only")}>MSL Agent</span>
    </Link>
  )
}
