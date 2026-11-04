import type { Metadata } from "next"
import { DesignSystemShowcase } from "@/components/design/showcase"

export const metadata: Metadata = { title: "Design system" }

export default function DesignPage() {
  return <DesignSystemShowcase />
}
