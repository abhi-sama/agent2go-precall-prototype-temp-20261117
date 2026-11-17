import type { Metadata } from "next"
import "@fontsource/fustat/400.css"
import "@fontsource/fustat/500.css"
import "@fontsource/fustat/600.css"
import "@fontsource/fustat/700.css"
import "@fontsource/crimson-text/600.css"
import "./reimagined.css"
import { PrecallPrototype } from "./precall-prototype"

export const metadata: Metadata = {
  title: "Reimagined pre-call brief prototypes",
  description: "Three standalone visual directions for an evidence-linked MSL pre-call brief.",
}

export default async function PrecallBriefPrototypePage({
  searchParams,
}: {
  searchParams: Promise<{ v?: string }>
}) {
  const { v } = await searchParams
  const requested = Number(v)
  const initialVariant = requested >= 1 && requested <= 3 ? requested - 1 : 0
  return <PrecallPrototype initialVariant={initialVariant as 0 | 1 | 2} />
}
