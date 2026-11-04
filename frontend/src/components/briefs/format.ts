/** Dates in a brief are source dates and load times, shown in UTC so everyone reads the same day. */
export function formatBriefDay(value: string | null | undefined): string {
  if (!value) return "Not recorded"
  const d = new Date(value.length === 10 ? `${value}T00:00:00Z` : value)
  return Number.isNaN(d.getTime())
    ? "Not recorded"
    : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })
}

export function formatBriefTime(value: string | null | undefined): string {
  if (!value) return "Not recorded"
  const d = new Date(value)
  return Number.isNaN(d.getTime())
    ? "Not recorded"
    : `${d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}, ${d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", timeZone: "UTC", hour12: false })} UTC`
}
