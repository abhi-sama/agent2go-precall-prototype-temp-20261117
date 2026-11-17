export type Evidence = {
  id: string
  short: string
  label: string
  dataset: "call_activity" | "hcp_raw_insights"
  date: string
  recordId: string
  excerpt: string
}

export const brief = {
  hcp: "Dr. Maya Chen",
  credentials: "MD",
  specialty: "Thoracic oncology",
  institution: "North Valley Cancer Institute",
  meeting: "Tomorrow, 10:30 AM",
  location: "On-site · Building B",
  territory: "Northeast · NE-01",
  generated: "Nov 17, 2026 · 8:42 AM",
  dataThrough: "Nov 14, 2026",
  objective: "Understand how the care team weighs long-term efficacy evidence against access constraints, then agree on the most useful scientific follow-up.",
  nextBestAction: "Lead with the unresolved long-term evidence need, then test whether access criteria are still changing the treatment pathway.",
  facts: [
    ["4", "scientific exchanges"],
    ["7", "recorded insights"],
    ["15 days", "since last interaction"],
    ["2", "open follow-ups"],
  ],
  engagement: [
    "The Oct 30 exchange focused on long-term outcomes and sequencing evidence.",
    "The care team asked for material that can support treatment discussions at the point of care.",
  ],
  perspectives: [
    "Long-term efficacy remains the strongest evidence need in recent responses.",
    "Access criteria and practical implementation recur alongside the scientific discussion.",
    "The HCP prefers concise comparisons first, with deeper study review available as follow-up.",
  ],
  prompts: [
    "Which long-term outcome would be most useful in the next treatment-team discussion?",
    "Where do access criteria create the most friction in the care pathway today?",
    "Would a concise evidence comparison or a deeper study review be more useful next?",
  ],
  agenda: [
    ["05 min", "Reconnect", "Confirm what changed since the last scientific exchange."],
    ["12 min", "Explore", "Clarify the evidence need and access friction."],
    ["08 min", "Respond", "Discuss the most relevant scientific evidence."],
    ["05 min", "Commit", "Agree on the format and owner of follow-up."],
  ],
  watchouts: [
    "Credentials are not recorded in the authorized source profile.",
    "Confirm whether the Aug 15 access concern still reflects the current pathway.",
    "Only the latest 20 of 38 responses were included in this synthesis.",
  ],
}

export const evidence: Evidence[] = [
  {
    id: "call-oct-30",
    short: "Oct 30 call",
    label: "Scientific exchange · Oct 30, 2026",
    dataset: "call_activity",
    date: "2026-10-30",
    recordId: "CALL-NE01-1030-04",
    excerpt: "Discussed long-term outcomes, sequencing evidence, and the care team's request for point-of-care material.",
  },
  {
    id: "insight-oct-28",
    short: "Oct 28 insight",
    label: "Recorded insight · Oct 28, 2026",
    dataset: "hcp_raw_insights",
    date: "2026-10-28",
    recordId: "INS-HCP-042-1028",
    excerpt: "Long-term efficacy evidence was ranked as the highest-priority information need.",
  },
  {
    id: "call-aug-15",
    short: "Aug 15 call",
    label: "Scientific exchange · Aug 15, 2026",
    dataset: "call_activity",
    date: "2026-08-15",
    recordId: "CALL-NE01-0815-11",
    excerpt: "Access criteria and practical implementation were described as recurring barriers in the current pathway.",
  },
  {
    id: "insight-aug-15",
    short: "Aug 15 insight",
    label: "Recorded insight · Aug 15, 2026",
    dataset: "hcp_raw_insights",
    date: "2026-08-15",
    recordId: "INS-HCP-042-0815",
    excerpt: "The HCP preferred a concise evidence comparison before a detailed study review.",
  },
]
