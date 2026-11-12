import { Activity, BarChart3, ClipboardList, FileSearch, FlaskConical, LayoutDashboard, Map, Network, ShieldCheck, Sparkles, Users } from "lucide-react"
import type { LucideIcon } from "lucide-react"
import type { Persona } from "@/lib/data/types"

export interface NavItem {
  label: string
  /** Null renders a disabled "Soon" item: the route belongs to a later ticket. */
  href: string | null
  icon: LucideIcon
}

export interface PersonaConfig {
  persona: Persona
  label: string
  home: string
  tagline: string
  nav: NavItem[]
}

export const PERSONA_CONFIG: Record<Persona, PersonaConfig> = {
  msl: {
    persona: "msl",
    label: "MSL",
    home: "/msl",
    tagline: "Field workspace",
    nav: [
      { label: "My territory", href: "/msl", icon: Map },
      { label: "My activity", href: "/msl/activity", icon: Activity },
      { label: "Pre-call brief", href: "/msl/briefs", icon: ClipboardList },
      { label: "Post-call workflow", href: "/msl/follow-up", icon: ClipboardList },
      { label: "Insights", href: "/msl/insights", icon: BarChart3 },
    ],
  },
  director: {
    persona: "director",
    label: "Director",
    home: "/director",
    tagline: "Regional view",
    nav: [
      { label: "My region", href: "/director", icon: Users },
      { label: "Insights", href: "/director/insights", icon: BarChart3 },
    ],
  },
  executive: {
    persona: "executive",
    label: "Executive",
    home: "/executive",
    tagline: "Aggregate view",
    nav: [
      { label: "Overview", href: "/executive", icon: LayoutDashboard },
      { label: "Themes & summaries", href: "/executive/themes", icon: Sparkles },
      { label: "Trends", href: "/executive/trends", icon: BarChart3 },
    ],
  },
  admin: {
    persona: "admin",
    label: "Administrator",
    home: "/admin",
    tagline: "Data and security",
    nav: [
      { label: "Overview", href: "/admin", icon: ShieldCheck },
      { label: "Hierarchy and coverage", href: "/admin/governance", icon: Network },
      { label: "Ingestion runs", href: "/admin/ingestion", icon: FileSearch },
      { label: "AI evaluation", href: "/admin/evals", icon: FlaskConical },
    ],
  },
}
