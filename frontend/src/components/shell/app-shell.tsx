"use client"

import { AppShell as AstryxAppShell, useAppShellMobile } from "@astryxdesign/core/AppShell"
import { Badge } from "@astryxdesign/core/Badge"
import { HStack } from "@astryxdesign/core/HStack"
import { Icon } from "@astryxdesign/core/Icon"
import { IconButton } from "@astryxdesign/core/IconButton"
import { Layout, LayoutContent, LayoutPanel } from "@astryxdesign/core/Layout"
import { MobileNavToggle } from "@astryxdesign/core/MobileNav"
import { SideNav, SideNavCollapseButton, SideNavItem, SideNavSection } from "@astryxdesign/core/SideNav"
import { TopNav, TopNavHeading, useTopNavRenderMode } from "@astryxdesign/core/TopNav"
import { LogOut } from "lucide-react"
import dynamic from "next/dynamic"
import { usePathname } from "next/navigation"
import * as React from "react"
import { ChatDock, ChatDrawer, ChatTrigger } from "@/components/chat/chat-drawer"
import { ChatProvider, useChatSession } from "@/components/chat/chat-provider"
import { PageFrame } from "@/components/layout/page-frame"
import { PERSONA_CONFIG } from "@/components/shell/persona-config"
import { AppearanceSettings } from "@/components/shell/appearance-settings"
import { BrandMark } from "@/components/brand/brand-mark"
import { FirstRunOrientation } from "@/components/state/first-run-orientation"
import { OfflineStatus } from "@/components/shell/offline-status"
import { SharedFilterProvider } from "@/components/filters/filter-context"
import { useChatPresentation } from "@/hooks/use-chat-presentation"
import { IS_LOCAL_BUILD } from "@/lib/env"
import { useSession } from "@/lib/session/session-provider"

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

/**
 * Below this width the side navigation moves into a drawer opened from the header. `xl` (1280px) keeps portrait
 * iPads (up to the 1024px Pro) on the drawer and the 1366px landscape iPad Pro and desktops on the inline rail.
 */
const MOBILE_BREAKPOINT = "xl" as const

/**
 * Opens the navigation drawer below the breakpoint (it renders nothing above it). The TopNav heading is reused as the
 * drawer's header, so the toggle hides itself there instead of appearing twice.
 */
function NavigationToggle() {
  const mode = useTopNavRenderMode()
  if (mode === "drawer") return null
  return <MobileNavToggle data-testid="sidebar-menu" label="Open navigation" />
}

/** The navigation drawer closes itself after a route change, so the new page is not hidden behind it. */
function CloseDrawerOnNavigate() {
  const pathname = usePathname()
  const { closeMobileNav, isMobileNavOpen } = useAppShellMobile()
  const previous = React.useRef(pathname)
  React.useEffect(() => {
    if (previous.current === pathname) return
    previous.current = pathname
    if (isMobileNavOpen) closeMobileNav()
  }, [pathname, isMobileNavOpen, closeMobileNav])
  return null
}

/**
 * The authenticated frame: Astryx AppShell with a TopNav (brand and global actions), a collapsible SideNav built from
 * the persona's navigation (persona-config.ts is the single source of routes and access), and the Astryx mobile
 * drawer below the `xl` breakpoint. The page scrolls with the window (`height="auto"`), as before.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const { user, signOut } = useSession()
  const config = PERSONA_CONFIG[user.persona]
  const [collapsed, setCollapsed] = React.useState(false)
  // Several nav entries can share one route (MSL "Insights" lives on the territory page); only the first is current.
  const activeLabel = config.nav.find((item) => item.href === pathname)?.label

  React.useEffect(() => {
    // The saved preference is deliberately a local convenience: it contains no user or access data.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCollapsed(readCollapsedSidebar())
  }, [])

  const onCollapsedChange = React.useCallback((next: boolean) => {
    setCollapsed(next)
    try {
      window.localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, String(next))
    } catch {
      // Private browsing still gets the chosen state for this visit.
    }
  }, [])
  const collapsible = React.useMemo(
    () => ({ isCollapsed: collapsed, onCollapsedChange, hasButton: false }),
    [collapsed, onCollapsedChange],
  )

  const topNav = (
    <TopNav
      label="Workspace"
      heading={
        <HStack gap={1} vAlign="center">
          <NavigationToggle />
          <TopNavHeading logo={<BrandMark priority />} heading="MSL Agent" headingHref="/" />
        </HStack>
      }
      endContent={
        <HStack gap={2} vAlign="center" wrap="nowrap">
          {IS_LOCAL_BUILD && <Badge variant="warning" label="Local" className="hidden sm:inline-flex" />}
          <OfflineStatus />
          <ChatTrigger />
          <PersonaSwitcher />
          <AppearanceSettings />
          {signOut && (
            <IconButton
              data-testid="sign-out"
              label="Sign out"
              tooltip="Sign out"
              variant="ghost"
              icon={<Icon icon={LogOut} />}
              onClick={() => void signOut()}
            />
          )}
        </HStack>
      }
    />
  )

  const renderSideNav = (docked: boolean) => {
    // A docked inspector turns the shell into a three-pane workspace. Keep navigation available as an icon rail so
    // the primary workspace still has the minimum width needed for dashboard pairs at the 1366px docking threshold.
    const isCollapsed = docked || collapsed
    const dockAwareCollapsible = { ...collapsible, isCollapsed }
    return (
      <SideNav
        aria-label="Primary"
        data-testid="sidebar-rail"
        data-collapsed={String(isCollapsed)}
        collapsible={dockAwareCollapsible}
        footerIcons={
          docked ? undefined : (
            <SideNavCollapseButton
              data-testid="sidebar-collapse"
              collapsible={dockAwareCollapsible}
              label={isCollapsed ? "Expand navigation" : "Collapse navigation"}
            />
          )
        }
      >
        <SideNavSection title={config.tagline}>
          {config.nav.map((item) => (
            <SideNavItem
              key={item.label}
              label={item.label}
              icon={item.icon}
              href={item.href ?? undefined}
              isSelected={item.label === activeLabel}
              isDisabled={!item.href}
              size="lg"
              endContent={item.href ? undefined : <Badge variant="neutral" label="Soon" />}
            />
          ))}
        </SideNavSection>
      </SideNav>
    )
  }

  return (
    <SharedFilterProvider>
      <ChatProvider>
        <WorkspaceShell topNav={topNav} renderSideNav={renderSideNav}>{children}</WorkspaceShell>
      </ChatProvider>
    </SharedFilterProvider>
  )
}

/** Owns the main/supporting-pane split once the chat session context is available. */
function WorkspaceShell({ topNav, renderSideNav, children }: { topNav: React.ReactNode; renderSideNav: (docked: boolean) => React.ReactNode; children: React.ReactNode }) {
  const { open } = useChatSession()
  const presentation = useChatPresentation()
  const docked = open && presentation === "docked"

  return (
    <>
      <AstryxAppShell
        height={docked ? "fill" : "auto"}
        variant="section"
        topNav={topNav}
        sideNav={renderSideNav(docked)}
        mobileNav={{ hasToggle: false, breakpoint: MOBILE_BREAKPOINT }}
      >
        <CloseDrawerOnNavigate />
        <Layout
          height={docked ? "fill" : "auto"}
          content={
            <LayoutContent padding={0} isScrollable={docked}>
              <PageFrame>
                <FirstRunOrientation />
                {children}
              </PageFrame>
            </LayoutContent>
          }
          end={
            docked ? (
              <LayoutPanel data-testid="chat-dock" width={420} padding={0} hasDivider isScrollable={false} role="complementary" label="Ask the agent">
                <ChatDock />
              </LayoutPanel>
            ) : undefined
          }
        />
      </AstryxAppShell>
      <ChatDrawer />
    </>
  )
}
