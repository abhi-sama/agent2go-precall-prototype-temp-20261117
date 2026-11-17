# Astryx inventory

One row per component instance that was an old element, an old wrapper or a lucide icon, with the Astryx replacement or
`kept: <reason>`. Paths are relative to `frontend/src` unless noted. This is the list behind the question "where is the old
component still used": the wave-2 pass (#103 to #108) left raw `<button>`, `<select>`, `<textarea>`, `<table>`, `<details>`,
the base-ui `Sheet`, sonner toasts, the shadcn `Label` and bare lucide icons across the feature components.

Rules used everywhere: every element with an Astryx equivalent uses it (`@astryxdesign/core/<Name>`, never the package root).
Every lucide icon renders through Astryx `Icon`: the semantic name where Astryx ships one (close, check, chevron*, search,
calendar, ...), otherwise the lucide glyph is passed into `Icon` and recorded as `kept: no semantic Astryx icon`. Recharts,
ECharts, the 3D globe, the WebGL bar field and the map SVG have no Astryx equivalent and stay.

| Part | Areas | Rows | Replaced / already Astryx | Kept |
| --- | --- | --- | --- | --- |
| A | director, executive, charts, map, insights, landing, motion, brand | 351 | 243 | 108 |
| B | shared `components/ui` wrappers, chat, activity, hcps, filters, provenance, briefs, post-call, design, appearance, admin/shell/state/login audit | 492 | 389 | 103 |
| **Total** |  | **843** | **632** | **211** |

# Part A: director, executive, charts, map, insights, landing, motion, brand

## Summary

| Slice | Rows | Replaced / already Astryx | Kept |
| --- | --- | --- | --- |
| 1 | 44 | 33 | 11 |
| 2 | 121 | 94 | 27 |
| 3 | 53 | 37 | 16 |
| 4 | 59 | 41 | 18 |
| 5 | 74 | 38 | 36 |
| **Total** | **351** | **243** | **108** |

Slices: 1 director core, 2 director insights + qualitative insights, 3 executive core, 4 executive themes, 5 charts, map, landing, motion, brand.

# Slice 1: director core

| File | Old element | Astryx replacement / kept: reason |
| --- | --- | --- |
| components/director/comparison-panel.tsx | `<p data-testid="compare-hint">` bordered hint | `Card variant="muted"` + `Text type="supporting"` |
| components/director/comparison-panel.tsx | `@/components/ui/skeleton` Skeleton adapter | `@astryxdesign/core/Skeleton` (width/height/radius) |
| components/director/comparison-panel.tsx | `<div className="flex flex-col gap-5">` root | `VStack gap={5}` |
| components/director/comparison-panel.tsx | `<p>` basis line + `<span>`/`<strong>` | `Text as="p"` + nested `Text weight="semibold"` |
| components/director/comparison-panel.tsx | lucide `Scale` raw icon | `Icon icon={Scale}` (no semantic name for Scale) |
| components/director/comparison-panel.tsx | hand-built unequal-populations note (div role=note + lucide `Info` + `<ul>`) | `Banner status="warning" role="note"` (replaces Info icon with the Banner's status icon) + `List listStyle="disc"` / `ListItem` |
| components/director/comparison-panel.tsx | `<div className="grid md:grid-cols-2">` chart grid | container-query `a2g-mix-grid` (layout owned by the dashboard layout system) |
| components/director/comparison-panel.tsx | metric `<figure className="rounded-xl border p-4">` + `<span>` captions | `figure` kept for figcaption semantics, wrapped in `Card`; captions `Text` |
| components/director/comparison-panel.tsx | `<h4>` "Coverage" + `<ul>` coverage lines + `<p>` fallback | `Heading level={4}`, `List`/`ListItem`, `Text` |
| components/director/comparison-panel.tsx | Astryx `Card` coverage card, `Table` compare table | already Astryx; unchanged |
| components/director/comparison-panel.tsx | trailing disclosures `<ul list-disc>` | `List listStyle="disc"` / `ListItem` |
| components/director/comparison-panel.tsx | `ChartContainer`/`ChartTooltip` from `components/ui/chart` | kept: owned by other worker (shared chart wrapper migration) |
| components/director/comparison-panel.tsx | recharts `BarChart`/`Bar`/`XAxis`/`YAxis`/`CartesianGrid`/`Cell` | kept: chart drawing has no Astryx equivalent |
| components/director/director-landing.tsx | lucide `Lightbulb` passed raw to Button `icon` | `Icon icon={Lightbulb}` (no semantic name) |
| components/director/director-landing.tsx | Astryx `Button as={Link}` insights link | already Astryx; unchanged |
| components/director/director-landing.tsx | `LandingSection` | kept: landing slice (slice 5) owns it |
| components/director/director-overview.tsx | `@/components/ui/skeleton` Skeleton adapter | `@astryxdesign/core/Skeleton` |
| components/director/director-overview.tsx | `<div>` loading wrapper and overview root | `VStack` |
| components/director/director-overview.tsx | `<dl>` definitions grid | `MetadataList columns="multi"` / `MetadataListItem` |
| components/director/director-overview.tsx | `<ul>` overview notes | `List listStyle="disc"` / `ListItem` |
| components/director/director-overview.tsx | lucide `BookOpen` raw inline icon | `Icon icon={BookOpen}` |
| components/director/director-overview.tsx | StatCard raw lucide icon render (`<Icon className>`) | Astryx `Icon icon={StatIcon}` |
| components/director/director-overview.tsx | lucide `Users`, `MapPinned`, `CalendarCheck`, `Layers` passed as `icon` to KpiCard | kept: KpiCard (components/landing/kpi-card + charts/kpi-tile, slice 5) takes an SVG component and wraps it in Icon there |
| components/director/director-overview.tsx | Astryx `Card`, `Grid`, `Heading`, `Section`, `Stack`, `Text` | already Astryx; unchanged |
| components/director/director-overview.tsx | `KpiCard`, `EmptyState`/`ErrorState`/`KpiSkeleton` | kept: shared components owned by slice 5 / wave 2 |
| components/director/mix-section.tsx | `<div role="tablist">` + 4 `<button role="tab">` pill buttons | `HStack role="tablist" wrap` + `Button role="tab"` (data-testid kept, `aria-controls` wired to a labelled `role="tabpanel"` `VStack`; `TabList` scrolled sideways in the narrow dashboard column, which the viewport matrix forbids) |
| components/director/mix-section.tsx | `<p data-testid="mix-totals">` + `<strong>` | `Text as="p"` + `Text weight="semibold"` |
| components/director/mix-section.tsx | empty-state `<p>` dashed box | `Card variant="muted"` + `Text` |
| components/director/mix-section.tsx | `<div className="grid lg:grid-cols-2">` | `Grid columns={{minWidth, max: 2}}` |
| components/director/mix-section.tsx | `<div flex-col>` root | `VStack` |
| components/director/mix-section.tsx | two `<figcaption className>` | `Text type="label"` inside figcaption (figure kept for semantics) |
| components/director/mix-section.tsx | `ChartContainer`/`ChartLegend`/`ChartTooltip` | kept: owned by other worker (shared chart wrapper migration) |
| components/director/mix-section.tsx | recharts bars/axes | kept: chart drawing has no Astryx equivalent |
| components/director/team-activity.tsx | `<p data-testid="team-empty">` dashed empty box | `Card variant="muted"` + `Text` |
| components/director/team-activity.tsx | `<div flex-col>` | `VStack` |
| components/director/team-activity.tsx | `<span>` completeness / months | `Text` |
| components/director/team-activity.tsx | `Heatmap` (raw `<table>` inside) and `SequentialLegend` | kept here: migrated in components/charts (slice 5) |
| components/director/territory-table.tsx | lucide `Check` in Button `icon` | `Icon icon="check"` (semantic name) |
| components/director/territory-table.tsx | lucide `Plus` in Button `icon` | `Icon icon={Plus}` (no semantic name) |
| components/director/territory-table.tsx | `<strong>`/`<span>` territory id and name | `Text weight="semibold"` / `Text type="supporting"` |
| components/director/territory-table.tsx | Astryx `Table`, `Button`, `Stack`, `Text` | already Astryx; unchanged |
| components/director/territory-table.tsx | `<span title aria-label>` "Coverage not shown" | kept: native title tooltip carries the accessible label tested by e2e; no behaviour change |
| app/(app)/director/page.tsx | `RoleGate` + `DirectorLanding` | kept: no UI elements (server page wrapper) |
| app/(app)/director/insights/page.tsx | `RoleGate` + `DirectorInsights` | kept: no UI elements (server page wrapper) |

## Slice 2: director insights (`components/director/insights/*`, `components/insights/qualitative-insights.tsx`)

Imports are per-component entries (`@astryxdesign/core/<Name>`). Glyphs without a semantic Astryx name keep their lucide component, now rendered through Astryx `Icon` (the same convention as `components/admin/section-card.tsx`).

| File | Old element | Astryx replacement / kept: reason |
| --- | --- | --- |
| director/insights/shared.tsx | `ui/badge` Badge (outline, "Derived") | Astryx `Badge` variant neutral |
| director/insights/shared.tsx | hand-built status pill `<span>` (StatusBadge) | Astryx `Badge` (info / purple / neutral / warning) with `Icon` |
| director/insights/shared.tsx | lucide `FileText` (evidence chip) | Astryx `Icon icon={FileText}` (no semantic name) |
| director/insights/shared.tsx | lucide `MoveUpRight` | Astryx `Icon icon={MoveUpRight}` (no semantic name) |
| director/insights/shared.tsx | lucide `MoveDownRight` | Astryx `Icon icon={MoveDownRight}` (no semantic name) |
| director/insights/shared.tsx | lucide `Minus` | Astryx `Icon icon={Minus}` (no semantic name) |
| director/insights/shared.tsx | lucide `CircleHelp` | Astryx `Icon icon={CircleHelp}` (no semantic name) |
| director/insights/shared.tsx | PanelMeta `<div>` + `<span>` | Astryx `HStack` + `Text` |
| director/insights/shared.tsx | InsightSection `<section>` / `<h2>` / `<p>` / `<div>` | Astryx `VStack as="section"` + `Heading level 2` + `Text` |
| director/insights/shared.tsx | PanelLoading `animate-pulse` `<div>` | Astryx `Skeleton` (height is now a px number) |
| director/insights/shared.tsx | `CitationSheet` (CitationHost) | kept: wraps `components/ui/sheet`, which the other worker migrates; file is `components/chat`, outside this slice |
| director/insights/shared.tsx | `CitationChip` | kept: shared provenance component outside this slice |
| director/insights/shared.tsx | `DataThroughBadge` | kept: owned by the landing slice |
| director/insights/director-insights.tsx | `Link` + `buttonVariants` (ghost sm, "My region") | Astryx `Button href as={NextLink}` variant ghost |
| director/insights/director-insights.tsx | lucide `ArrowLeft` | Astryx `Icon icon={ArrowLeft}` (no semantic name) |
| director/insights/director-insights.tsx | `<h1>` / `<p>` | Astryx `Heading level 1` / `Text` |
| director/insights/director-insights.tsx | layout `<div>` / `<header>` wrappers (3) | Astryx `VStack` / `HStack` |
| director/insights/director-insights.tsx | `FilterBar`, `ScopeLabel` | kept: shared components outside this slice |
| director/insights/drilldown-panel.tsx | lucide `Lock` | Astryx `Icon icon={Lock}` (no semantic name) |
| director/insights/drilldown-panel.tsx | limit notice `<p>` with border-dashed box | Astryx `Card variant="muted"` + `HStack` + `Text` |
| director/insights/drilldown-panel.tsx | `<nav>` + `<ol>` + `<li>` + crumb `<button>`s | Astryx `Breadcrumbs` + `BreadcrumbItem` (onClick items, `isCurrent` for the last) |
| director/insights/drilldown-panel.tsx | lucide `ChevronRight` breadcrumb separators (2) | Astryx `Icon icon="chevronRight"` as the `separator` |
| director/insights/drilldown-panel.tsx | `<div role=region tabIndex=0>` scroller + `<table>` / `<caption>` / `<thead>` / `<tr>` / `<th>` / `<tbody>` / `<td>` | Astryx `Table` (children mode: `TableHeader`, `TableBody`, `TableRow`, `TableHeaderCell`, `TableCell`); caption becomes `aria-label`, scroller is built in |
| director/insights/drilldown-panel.tsx | `ui/button` Button outline sm (`drill-open`) | Astryx `Button` variant secondary size sm |
| director/insights/drilldown-panel.tsx | lucide `ChevronRight` inside Open / Timeline button | Astryx `Button endContent={<Icon icon="chevronRight" />}` |
| director/insights/drilldown-panel.tsx | `Link` + `buttonVariants` (`ask-agent-territory`) | Astryx `Button href as={NextLink}` variant secondary |
| director/insights/drilldown-panel.tsx | lucide `MessageSquareText` | Astryx `Icon icon={MessageSquareText}` (no semantic name) |
| director/insights/drilldown-panel.tsx | `<section>` HCP panel (`drill-hcp`) | Astryx `Card role=region` + `VStack` |
| director/insights/drilldown-panel.tsx | `<h3>` / `<header>` / `<p>` in HCP panel | Astryx `Heading level 3` / `HStack` / `Text` |
| director/insights/drilldown-panel.tsx | `ui/button` Button ghost sm ("Close") | Astryx `Button` variant ghost size sm |
| director/insights/drilldown-panel.tsx | `<p>` truncated note, numeric cell text | Astryx `Text` |
| director/insights/drilldown-panel.tsx | `EmptyState`, `ErrorState` | kept: `components/state/states.tsx` is already Astryx (wave 2) |
| director/insights/drilldown-panel.tsx | `HcpTimeline` | kept: shared component outside this slice |
| director/insights/emerging-panel.tsx | lucide `Info` | Astryx `Icon icon="info"` (semantic) |
| director/insights/emerging-panel.tsx | rule `<section>` card (`emerging-rule`) | Astryx `Card role=region` + `VStack` |
| director/insights/emerging-panel.tsx | `<h3>` rule heading | Astryx `Heading level 3` |
| director/insights/emerging-panel.tsx | `<dl>` thresholds (4 items) | Astryx `MetadataList` / `MetadataListItem` |
| director/insights/emerging-panel.tsx | `<dl>` windows (2 items) | Astryx `MetadataList` / `MetadataListItem` |
| director/insights/emerging-panel.tsx | `<p role=status>` thin-sample warning | Astryx `Banner status="warning"` |
| director/insights/emerging-panel.tsx | `<ul>` / `<li>` flagged topic grid | kept: semantic list around Cards; no Astryx list-of-cards primitive |
| director/insights/emerging-panel.tsx | scroller `<div>` + `<table>` (`emerging-table`) | Astryx `Table` (children mode) |
| director/insights/emerging-panel.tsx | table cells' share `<span>`s and `<p>` statement | Astryx `Text` |
| director/insights/emerging-panel.tsx | TopicCard `<article>` | Astryx `Card role=article` |
| director/insights/emerging-panel.tsx | TopicCard `<h4>` / `<header>` | Astryx `Heading level 4` / `VStack as="header"` |
| director/insights/emerging-panel.tsx | TopicCard `<dl>` stats (3) | Astryx `MetadataList` |
| director/insights/emerging-panel.tsx | evidence `<blockquote>` | Astryx `Blockquote` |
| director/insights/emerging-panel.tsx | evidence `<figure>` / `<figcaption>` (2) | kept: semantic caption markup, no Astryx equivalent |
| director/insights/emerging-panel.tsx | Sparkline `<svg>` | kept: bespoke 2-colour weekly line; Astryx ships no sparkline component |
| director/insights/emerging-panel.tsx | `StatusBadge`, `DerivedBadge`, `EvidenceChip` | already Astryx via `shared.tsx` |
| director/insights/exceptions-panel.tsx | filter `<div role=group>` + Chip `<button>`s (6 incl. All) | Astryx `ToggleButtonGroup` + `ToggleButton` |
| director/insights/exceptions-panel.tsx | scroller `<div>` + `<table>` (`exceptions-table`) | Astryx `Table` (children mode) |
| director/insights/exceptions-panel.tsx | severity pill `<span>` | Astryx `Badge` (error / warning / neutral) with `Icon` |
| director/insights/exceptions-panel.tsx | lucide `AlertOctagon` | Astryx `Icon icon={AlertOctagon}` (no semantic name) |
| director/insights/exceptions-panel.tsx | lucide `AlertTriangle` | Astryx `Icon icon="warning"` (semantic) |
| director/insights/exceptions-panel.tsx | lucide `Info` | Astryx `Icon icon="info"` (semantic) |
| director/insights/exceptions-panel.tsx | sample-record id `<li>` chips | Astryx `Badge` inside the `<li>` |
| director/insights/exceptions-panel.tsx | rules `<section>` (`exception-rules`) / `<h3>` / `<p>` | Astryx `Card role=region` / `Heading level 3` / `Text` |
| director/insights/exceptions-panel.tsx | rules `<dl>` | kept: long per-category rule paragraphs; `MetadataList` is single-line label/value |
| director/insights/exceptions-panel.tsx | `<ul>` of sample ids | kept: semantic list |
| director/insights/heatmap-panel.tsx | facet `<button>`s ×5 (`facet-*`) | Astryx `ToggleButtonGroup` + `ToggleButton` |
| director/insights/heatmap-panel.tsx | view `<button>`s ×3 (`heatmap-view-*`) | Astryx `ToggleButtonGroup` + `ToggleButton` with `Icon` |
| director/insights/heatmap-panel.tsx | lucide `Rows3`, `Box`, `Table2` | Astryx `Icon` glyphs (no semantic names) |
| director/insights/heatmap-panel.tsx | lucide `MessageSquareText` | Astryx `Icon icon={MessageSquareText}` (no semantic name) |
| director/insights/heatmap-panel.tsx | 3D fallback `<p role=status>` | Astryx `Banner status="info"` |
| director/insights/heatmap-panel.tsx | heatmap surface `<div>` (`topic-heatmap`) | Astryx `Card` |
| director/insights/heatmap-panel.tsx | Legend `<div>` / `<span>`s | Astryx `HStack` + `Text` |
| director/insights/heatmap-panel.tsx | legend gradient swatch `<span aria-hidden>` | kept: decorative CSS gradient key for the colour scale |
| director/insights/heatmap-panel.tsx | `EChart` heatmap drawing | kept: ECharts canvas chart; Astryx has no heatmap chart |
| director/insights/heatmap-panel.tsx | `Heatmap3D` | kept: WebGL scene; no Astryx equivalent |
| director/insights/heatmap-panel.tsx | HeatmapTable scroller `<div>` + `<table>` (`heatmap-table`) | Astryx `Table` (children mode) |
| director/insights/heatmap-panel.tsx | cell `<button>` (`heatmap-cell`, 14 × 6) | Astryx `Button` variant ghost (colour scale kept as data-driven inline background) |
| director/insights/heatmap-panel.tsx | CellDetail `<aside>` | Astryx `Card role=complementary` + `HStack` / `VStack` / `Text` |
| director/insights/heatmap-panel.tsx | `Link` + `buttonVariants` (`ask-agent-cell`) | Astryx `Button href as={NextLink}` |
| director/insights/heatmap-panel.tsx | `<button>` + `buttonVariants` ghost ("Clear") | Astryx `Button` variant ghost |
| director/insights/heatmap-panel.tsx | empty theme-card `<p>` | Astryx `Card variant="muted"` + `Text` |
| director/insights/heatmap-panel.tsx | `<h3>` / `<h4>` headings | Astryx `Heading` |
| director/insights/heatmap-panel.tsx | theme-card `<p>` summary line | Astryx `Text` |
| director/insights/heatmap-panel.tsx | theme-card `<blockquote>` | Astryx `Blockquote` |
| director/insights/heatmap-panel.tsx | theme-card `<figure>` | kept: semantic caption markup |
| director/insights/heatmap-panel.tsx | `AiSummary` | kept: shared provenance component outside this slice |
| director/insights/heatmap-3d.tsx | `BarField` 3D scene | kept: WebGL bar field; no Astryx equivalent; file has no other UI elements |
| director/insights/question-panel.tsx | `ui/label` Label ×2 | Astryx field labels (`TextInput label`, `Selector label`) |
| director/insights/question-panel.tsx | `ui/input` Input (`question-search`) | Astryx `TextInput` with `startIcon="search"` |
| director/insights/question-panel.tsx | lucide `Search` | Astryx semantic icon `"search"` |
| director/insights/question-panel.tsx | raw `<select>` + `<option>`s (`question-type`) | Astryx `Selector` (sentinel value for "All types") |
| director/insights/question-panel.tsx | `<ul role=listbox>` + option `<button>`s (`question-option`) | Astryx `List` + `ListItem` (selected → `aria-current`) |
| director/insights/question-panel.tsx | selector sidebar `<div>` | Astryx `Card` + `VStack` |
| director/insights/question-panel.tsx | two-column page grid `<div>` | kept: responsive 20rem/1fr split; Astryx `Grid` has no asymmetric responsive tracks |
| director/insights/question-panel.tsx | `Link` + `buttonVariants` (`ask-agent-question`) | Astryx `Button href as={NextLink}` |
| director/insights/question-panel.tsx | lucide `MessageSquareText` | Astryx `Icon icon={MessageSquareText}` (no semantic name) |
| director/insights/question-panel.tsx | detail `<article>` | Astryx `Card role=article` |
| director/insights/question-panel.tsx | detail `<header>` / `<h3>` / `<h4>` / `<p>` | Astryx `VStack` / `Heading` / `Text` |
| director/insights/question-panel.tsx | stats `<dl>` (3) | Astryx `MetadataList` (testids move to the value `Text`) |
| director/insights/question-panel.tsx | response-bar track and fill `<span>`s | Astryx `ProgressBar` (label hidden) |
| director/insights/question-panel.tsx | response-bar `<ul>` / `<li>` grid | kept: semantic list of label / bar / count rows |
| director/insights/question-panel.tsx | territory `<li>` chips | Astryx `Badge` inside the `<li>` |
| director/insights/question-panel.tsx | territories and follow-ups `<ul>` | kept: semantic lists |
| director/insights/question-panel.tsx | ParentBlock `<section>` | Astryx `Card role=region` (muted / yellow) |
| director/insights/question-panel.tsx | ParentBlock `<h4>` / `<p>` | Astryx `Text` |
| director/insights/question-panel.tsx | `buttonVariants` import | removed |
| director/insights/summaries-panel.tsx | `ui/button` Button outline (`summaries-toggle`) | Astryx `Button` variant secondary |
| director/insights/summaries-panel.tsx | `ui/button` Button default (`generate-summary`) | Astryx `Button` variant primary with `Icon` |
| director/insights/summaries-panel.tsx | lucide `Sparkles` | Astryx `Icon icon={Sparkles}` (no semantic name) |
| director/insights/summaries-panel.tsx | SummaryCard `<article>` | Astryx `Card role=article` |
| director/insights/summaries-panel.tsx | `<header>` / `<h3>` / `<h4>` / `<p>` / `<span>` | Astryx `HStack` / `Heading` / `Text` |
| director/insights/summaries-panel.tsx | source-figures `<dl>` (4) | Astryx `MetadataList` |
| director/insights/summaries-panel.tsx | theme `<li>` boxes | Astryx `Card variant="muted"` inside the `<li>` |
| director/insights/summaries-panel.tsx | summary-cards `<ul>`, themes `<ul>` | kept: semantic lists |
| director/insights/summaries-panel.tsx | `AssistantTurnView`, `SourceFact` | kept: chat / provenance components outside this slice |
| director/insights/summaries-panel.tsx | `summary-result` `<div aria-live>` | kept: live-region wrapper, no visual role |
| insights/qualitative-insights.tsx | `ui/badge` Badge (outline) | Astryx `Badge` variant neutral |
| insights/qualitative-insights.tsx | `ui/button` Button + lucide `Search` | Astryx `IconButton type=submit` with `Icon icon="search"` |
| insights/qualitative-insights.tsx | `ui/input` Input | Astryx `TextInput` (hidden label keeps `aria-label`) |
| insights/qualitative-insights.tsx | `ui/card` Card / CardHeader / CardTitle / CardDescription / CardContent | Astryx `Card` + `VStack` + `Heading` + `Text` |
| insights/qualitative-insights.tsx | theme-excerpt `<blockquote>` | Astryx `Blockquote` |
| insights/qualitative-insights.tsx | `<h2>` / `<h3>` / `<p>` / layout `<div>`s | Astryx `Heading` / `Text` / `VStack` / `HStack` |
| insights/qualitative-insights.tsx | search-result `<li>` boxes | Astryx `Card` inside the `<li>` |
| insights/qualitative-insights.tsx | `<form>` | kept: native form submission; Astryx has no form-element wrapper |
| insights/qualitative-insights.tsx | result `<ul>`, theme `div` grids | kept: semantic list / responsive 2-up grid |
| insights/qualitative-insights.tsx | `AiSummary`, `Suggestion`, `CitationChip` | kept: shared provenance components outside this slice |
| insights/qualitative-insights.tsx | `CitationSheet` | kept: wraps `components/ui/sheet`, owned by the other worker |

### Slice 3: Executive core (`components/executive/*` except `themes/`, and `app/(app)/executive/page.tsx`)

| File | Old element | Astryx replacement / kept: reason |
| --- | --- | --- |
| executive/count.tsx | lucide `EyeOff` icon | Astryx `Icon icon={EyeOff} size="sm"` |
| executive/count.tsx | `<span>` "Withheld" placeholder chip | kept: inline, em-scaled placeholder inside numbers and table cells; carries `data-suppressed`, `title` and a screen-reader suffix; Astryx `Badge` is a fixed-size label with no inline equivalent |
| executive/count.tsx | `<span>` figure and count-up text | kept: inline text token inside other components' cells |
| executive/executive-landing.tsx | `Card`, `Stack`, `Heading`, `Text`, `Button as={Link}` | already Astryx |
| executive/executive-landing.tsx | lucide `Sparkles` icon | Astryx `Icon icon={Sparkles} size="md"` |
| executive/executive-landing.tsx | lucide `ArrowRight` icon in the themes `Button` | Astryx `Icon icon={ArrowRight}` |
| executive/executive-landing.tsx | `<div className="flex flex-col gap-6">` | Astryx `VStack gap={6}` |
| executive/executive-landing.tsx | `<span>` accent icon tile and text wrapper | kept: decorative tile (no Astryx equivalent for a tinted icon tile); text inside is Astryx `Heading`/`Text` |
| executive/executive-landing.tsx | `LandingSection` | kept: shared landing wrapper, owned by the charts/map/landing slice |
| executive/executive-overview.tsx | `@/components/ui/skeleton` `Skeleton` (adapter) | Astryx `Skeleton` (`width`/`height`/`radius`) |
| executive/executive-overview.tsx | loading `<div>` stack | Astryx `VStack` |
| executive/executive-overview.tsx | loading KPI `<div className="grid ...">` | Astryx `Grid columns={{ minWidth, max }}` |
| executive/executive-overview.tsx | root `<div data-testid="executive-overview">` | Astryx `VStack gap={8}` |
| executive/executive-overview.tsx | `SegmentedControl` (period), `Selector` (rank by), `Stack`, `Text`, `Banner`, `Grid`, `Section`, `Heading`, `Card` | already Astryx |
| executive/executive-overview.tsx | `DataThroughBadge` | kept: shared component, owned by the landing slice |
| executive/executive-overview.tsx | `EmptyState`, `ErrorState`, `KpiSkeleton` | already Astryx-based wave-2 state components (`components/state`) |
| executive/executive-overview.tsx | lucide `Stethoscope`, `Users`, `MessagesSquare` (KPI icons) | Astryx `Icon icon={...} size="md"` inside `Kpi` |
| executive/executive-overview.tsx | lucide `CalendarCheck` (completeness icon) | Astryx `Icon icon={CalendarCheck} size="md"` |
| executive/executive-overview.tsx | lucide `Layers` (coverage withheld heading) | Astryx `Icon icon={Layers} size="sm"` |
| executive/executive-overview.tsx | `Kpi` and completeness header `<div className="flex ...">` (2) | Astryx `HStack justify="between"` |
| executive/executive-overview.tsx | `Kpi` / completeness accent `<span>` icon tile and top rule (4) | kept: decorative tint tile and 4px accent rule, no Astryx equivalent |
| executive/executive-overview.tsx | `<p data-testid="freshness">` | Astryx `Text as="p" type="supporting"` |
| executive/executive-overview.tsx | `<dl>/<dt>/<dd>` definitions | Astryx `MetadataList columns="multi"` + `MetadataListItem` |
| executive/executive-overview.tsx | `<ul>/<li>` data notes | Astryx `List listStyle="disc"` + `ListItem` |
| executive/executive-overview.tsx | depth `<ul>/<li>` bar rows (HCPs by calls received) | kept: hand-drawn data bars on chart tokens (`bg-chart-2`); Astryx `ProgressBar` means task completion, not a data magnitude, and the bar needs withheld-aware rendering |
| executive/executive-overview.tsx | channel `<ul>/<li>` bar rows (calls by channel) | kept: same reason as depth bars (`bg-chart-3`) |
| executive/executive-overview.tsx | `<strong>` suppressed-cells count inside Banner description | kept: inline emphasis inside an Astryx `Banner` description slot |
| executive/executive-overview.tsx | `RankedUnits`, `TrendColumns`, `RecordDrilldown` | migrated in their own rows below |
| executive/ranked-units.tsx | `<div>` rounded card container | Astryx `Card padding={4}` |
| executive/ranked-units.tsx | `<h3>` | Astryx `Heading level={3}` |
| executive/ranked-units.tsx | lucide `FileSearch` icon | Astryx `Icon icon={FileSearch}` |
| executive/ranked-units.tsx | raw `<button data-testid="drill-open">` (per row) | Astryx `IconButton variant="secondary" size="lg"` with the same `label` and test id |
| executive/ranked-units.tsx | `<ol>/<li>` ranked rows (rank, name, bar, value) | kept: custom grid row with the data bar and `data-rank`/`data-unit` hooks used by e2e |
| executive/ranked-units.tsx | bar track and fill `<span>`s | kept: hand-drawn data bar (see engagement bars) |
| executive/ranked-units.tsx | rank, name, territories `<span>` text | kept: text inside the custom row grid |
| executive/trend-columns.tsx | `<div>` rounded card container | Astryx `Card padding={4}` |
| executive/trend-columns.tsx | three raw `<button aria-pressed>` metric toggles | Astryx `SegmentedControl` + 3 `SegmentedControlItem` (size lg, test ids kept) |
| executive/trend-columns.tsx | header `<div className="flex ...">` | Astryx `HStack` |
| executive/trend-columns.tsx | legend `<p>` | Astryx `Text as="p" type="supporting"` |
| executive/trend-columns.tsx | raw `<button data-testid="trend-table-toggle">` | Astryx `Button variant="ghost"` with `aria-expanded` |
| executive/trend-columns.tsx | raw `<table>` + `thead/tbody/tr/th/td` + `<div overflow-x-auto>` wrapper | Astryx `Card padding={0}` + `Table` (children mode: `TableHeader`, `TableBody`, `TableRow`, `TableHeaderCell`, `TableCell`), `aria-label` replaces the sr-only caption |
| executive/trend-columns.tsx | `<ol>/<li>` month columns, bar `<div>`s and labels | kept: hand-drawn column chart (hatched withheld stubs, outlined partial months, `data-*` hooks); no Astryx chart |
| executive/record-drilldown.tsx | `Sheet`, `SheetContent`, `SheetHeader`, `SheetTitle`, `SheetDescription` (5) | kept: owned by other worker (shared `components/ui/sheet` migration to Drawer) |
| executive/record-drilldown.tsx | raw `<select data-testid="drill-month">` | Astryx `Selector variant="secondary" presentation="adaptive"` (test id kept; see risk note) |
| executive/record-drilldown.tsx | header `<div className="flex ...">` | Astryx `HStack` |
| executive/record-drilldown.tsx | two raw `<button aria-pressed>` Calls/Responses toggles | Astryx `SegmentedControl` + 2 `SegmentedControlItem` |
| executive/record-drilldown.tsx | `@/components/ui/skeleton` `Skeleton` (3) | Astryx `Skeleton` (3) |
| executive/record-drilldown.tsx | loading and result `<div className="flex flex-col ...">` (3) | Astryx `VStack` (3) |
| executive/record-drilldown.tsx | `<p data-testid="drill-count">` | Astryx `Text as="p" type="supporting"` |
| executive/record-drilldown.tsx | empty-state `<p>` dashed box | Astryx `Card variant="muted"` + `Text` |
| executive/record-drilldown.tsx | raw `<table data-testid="drill-table">` + rows, `<div overflow-x-auto>` | Astryx `Card padding={0}` + `Table` children mode (`TableRow data-testid="drill-row"`, `TableHeaderCell scope="row"`), `aria-label` added |
| executive/record-drilldown.tsx | `DataThroughBadge`, `ErrorState` | kept: shared components owned by other slices / wave 2 |
| app/(app)/executive/page.tsx | `ExecutiveLanding`, `RoleGate` | kept: server page shell with no UI elements of its own; `RoleGate` is shared shell (already Astryx-based) |

## Slice 4: Executive themes

Paths relative to `frontend/src`. `T` = `components/executive/themes`.

| File | Old element | Astryx replacement / kept: reason |
| --- | --- | --- |
| app/(app)/executive/themes/page.tsx | RoleGate + workspace (no UI elements) | kept: no raw UI elements; route wrapper only |
| T/executive-themes.tsx | lucide `ArrowLeft` in back Button | `Icon icon={ArrowLeft}` (no semantic name for it) |
| T/executive-themes.tsx | Astryx Button (back link) | already Astryx |
| T/executive-themes.tsx | Astryx Banner x2 (AccessBanner) | already Astryx |
| T/executive-themes.tsx | Astryx SegmentedControl (facet tabs) | already Astryx |
| T/executive-themes.tsx | Astryx Selector (matrix facet value) | already Astryx |
| T/executive-themes.tsx | Astryx Heading / Text | already Astryx |
| T/executive-themes.tsx | `PanelLoading` heights as class strings | numeric `height` (shared PanelLoading is now an Astryx Skeleton, slice 2) |
| T/executive-themes.tsx | `EmptyState`, `ErrorState` (`@/components/state`) | kept: wave-2 wrappers around Astryx EmptyState |
| T/executive-themes.tsx | `FilterBar`, `ScopeLabel`, `InsightSection`, `PanelMeta`, `CitationHost` | kept: shared app components owned by other slices |
| T/leadership-document.tsx | `h1`, `h2`, `dl`, `ul`, `ol`, `section` (export body) | kept: print/export document; it must stay semantic HTML styled by `.brief-print-document` and the export preview selectors, so Astryx layout components do not apply |
| T/leadership-summaries.tsx | `Button` adapter x9 (Generate, Export, Regenerate, Open, Try to open, Print) | Astryx `Button` (variant primary/secondary, `isDisabled`, `label`) |
| T/leadership-summaries.tsx | lucide Sparkles, Download, RefreshCw, Printer, Lock, FileClock | `Icon icon={...}` |
| T/leadership-summaries.tsx | lucide `ShieldAlert` + bordered div (AccessChanged) | Astryx `Banner status="error"` (role alert, same test id) |
| T/leadership-summaries.tsx | `Badge` adapter (stub model) | Astryx `Badge variant="warning"` |
| T/leadership-summaries.tsx | hand-built "newer data" pill span | Astryx `Badge variant="warning"` + `Icon` |
| T/leadership-summaries.tsx | `article` styled as card (border, shadow, padding) | Astryx `Card` inside the `article` |
| T/leadership-summaries.tsx | `h3` title, `h4` section headings, `h4` Sources, `h3` Saved summaries | Astryx `Heading` |
| T/leadership-summaries.tsx | `dl` summary meta (scope, dates, generated, definitions) | Astryx `MetadataList` horizontal |
| T/leadership-summaries.tsx | `<details>` Metric definitions | Astryx `Collapsible` (`defaultIsOpen={false}`); e2e click target updated |
| T/leadership-summaries.tsx | `animate-pulse` placeholder divs x2 | Astryx `Skeleton` |
| T/leadership-summaries.tsx | saved-summary `li` with border classes | `li` kept, Astryx `Card` inside (muted when inaccessible) |
| T/leadership-summaries.tsx | `span` / `p` helper text | Astryx `Text` |
| T/leadership-summaries.tsx | `dl` key figures, `dl` metric definitions | kept: dt/dd inside a data-provenance block and inside the Collapsible; Astryx MetadataList has no multi-column wrapping equivalent |
| T/leadership-summaries.tsx | inline `a` source marker `[n]` | kept: an in-sentence footnote anchor (WCAG 2.5.8 inline-target exception); Astryx Link is block-styled and routes through the Next link provider |
| T/leadership-summaries.tsx | `Sheet` (export drawer) | kept: owned by other worker (shared Sheet migration) |
| T/leadership-summaries.tsx | `toast` from sonner | kept: owned by other worker (shared sonner migration) |
| T/leadership-summaries.tsx | `AiSummary`, `SourceFact`, `DataThroughBadge` | kept: shared provenance and landing components owned by other slices |
| T/org-analysis.tsx | raw `label` + `input#org-question` | Astryx `TextInput` (label prop, `data-testid="org-question"`, 500-char cap via `onChange`) |
| T/org-analysis.tsx | `Button` adapter (Ask) | Astryx `Button` primary, `type="submit"` |
| T/org-analysis.tsx | raw `button` x3 (suggested questions) | Astryx `Button` secondary |
| T/org-analysis.tsx | lucide `Send`, `MessagesSquare` | `Icon icon={...}` |
| T/org-analysis.tsx | dashed `p` empty note | Astryx `Card variant="muted"` + `Text` |
| T/org-analysis.tsx | `p` helper text | Astryx `Text` |
| T/org-analysis.tsx | question bubble `p` | kept: chat bubble; no Astryx equivalent in this slice, chat components belong to the chat area |
| T/org-analysis.tsx | `AssistantTurnView` | kept: chat component owned by the chat area |
| T/parts.tsx | hand-built trend pill (`span` + lucide arrow) | Astryx `Badge` (variant by trend) + `Icon`; hover `title` dropped (Badge has no `title`), word stays visible |
| T/parts.tsx | lucide ArrowUpRight, ArrowDownRight, Minus, EyeOff, CircleHelp | `Icon icon={...}` (no semantic names) |
| T/parts.tsx | `section` + `h4` + lucide `Info` (SampleLimitations) | Astryx `Banner status="warning" collapsible={false}` |
| T/parts.tsx | lucide `FileText` (aggregate chip) | `Icon icon={FileText}` |
| T/parts.tsx | aggregate citation chip `li` | kept: list row with border; Astryx Badge would clip long citation labels |
| T/parts.tsx | `EvidenceChip` | kept: shared director-insights component (slice 2) |
| T/theme-cards.tsx | Astryx Card, Grid, Heading, Text | already Astryx |
| T/theme-cards.tsx | dashed empty `p` | Astryx `Card variant="muted"` + `Text` |
| T/theme-cards.tsx | `p` x2 (groups left out, note) | Astryx `Text` |
| T/theme-cards.tsx | `dl` per card (HCPs, regions, earlier period) | kept: three-up dt/dd grid with count components inside; no Astryx equivalent that keeps the 3-column card layout |
| T/theme-cards.tsx | `AnimatedNumber` span, `CountValue` | kept: animated figure with test ids and `data-value` |
| T/theme-cards.tsx | `DerivedBadge` | kept: shared director-insights component (slice 2) |
| T/topic-matrix.tsx | raw `table` (thead, tbody, tr, th, td) | Astryx `Table` children mode (`TableHeader`, `TableBody`, `TableRow`, `TableHeaderCell scope`, `TableCell`), caption kept |
| T/topic-matrix.tsx | `small-sample` span pill + lucide AlertTriangle | Astryx `Badge variant="warning"` + `Icon` |
| T/topic-matrix.tsx | `cross-region` span pill + lucide BellRing | Astryx `Badge variant="info"` + `Icon` |
| T/topic-matrix.tsx | Thresholds `aside` card with `h3`, approved/unapproved pills (ShieldCheck, ShieldQuestion) | Astryx `Card` + `Heading` + `Badge` + `Icon` |
| T/topic-matrix.tsx | Thresholds `dl` | Astryx `MetadataList` (2 columns) |
| T/topic-matrix.tsx | disclosure dashed `p` | Astryx `Card variant="muted"` + `Text` |
| T/topic-matrix.tsx | mobile stack `li` cards | `li` kept, Astryx `Card` inside |
| T/topic-matrix.tsx | `p` legend and note | Astryx `Text` |
| T/topic-matrix.tsx | heat-map `Cell` div with `sequentialFill` background | kept: data-driven colour per cell; no Astryx equivalent |
| T/topic-matrix.tsx | `RegionHead` spans | kept: composition of Text-like spans inside the header cell; count component inside |
| T/topic-matrix.tsx | `TrendIndicator`, `SampleLimitations` | Astryx-backed (see parts.tsx) |

## Slice 5: charts, map, landing, motion, brand, root page

Paths are under `frontend/src/`. "Replaced" = now an Astryx component; "kept" = no Astryx equivalent, or owned by another worker.

| File | Old element | Astryx replacement / kept: reason |
| --- | --- | --- |
| components/charts/bar-field/bar-field.tsx | 3 raw `<button>` (zoom in, zoom out, reset view; `title`) | `IconButton` with `label` + `tooltip` (test ids `bar-field-zoom-in/-zoom-out/-reset` kept) |
| components/charts/bar-field/bar-field.tsx | 3 lucide icons (ZoomIn, ZoomOut, RotateCcw) rendered raw | `Icon icon={ZoomIn/ZoomOut/RotateCcw}` (no semantic name exists; lucide glyph through Icon) |
| components/charts/bar-field/bar-field.tsx | `<div role="group">` control row | `HStack role="group" aria-label="3D view controls"` |
| components/charts/bar-field/bar-field.tsx | 2 `<p>` (help text, readout, `aria-live`) | `Text as="p" type="supporting"` (ids / test ids kept) |
| components/charts/bar-field/bar-field.tsx | `BlockSkeleton` loading fallback | already Astryx `Skeleton` (via `state/states`) |
| components/charts/bar-field/bar-field.tsx | 3D canvas host `<div role="group" tabIndex=0>`, axis-label overlay `<div>`/`<span>`s | kept: WebGL scene host; positioned/projection-driven labels, keyboard camera control, no Astryx 3D equivalent |
| components/charts/bar-field/bar-field.tsx | outer layout `<div>` x2 | kept: flex wrapper with responsive wrap; Astryx `HStack` cannot replace without changing the `className` passthrough contract |
| components/charts/bar-field/bar-field-scene.tsx | react-three-fiber `Canvas`, OrbitControls, three meshes | kept: WebGL 3D chart drawing, no Astryx equivalent |
| components/charts/distribution-bars.tsx | `<ul>/<li>` list of rows | kept: ranked answer rows with a bespoke bar; no Astryx list renders a measured bar track |
| components/charts/distribution-bars.tsx | `<div role="meter">` track + fill (2 `<div>`) | kept: Astryx `ProgressBar` only takes semantic variants (accent/success/...), not the per-row ordinal colour ramp (`sequentialFill`) or the grow animation |
| components/charts/distribution-bars.tsx | label/count `<div>` + `<span>`s | kept: tabular count/percent readout beside bar |
| components/charts/echart.tsx | `<div role="img" data-testid="echart">` host for Apache ECharts | kept: chart drawing (ECharts canvas); Astryx has no chart component |
| components/charts/heatmap.tsx | raw `<table>` `<caption>` `<thead>` `<tbody>` `<tr>` `<th>` `<td>` (all) | Astryx `Table` (children mode) + `TableHeader` / `TableBody` / `TableRow` / `TableHeaderCell` / `TableCell`; caption became `aria-label`; `rowTestId` / `cellTestId` / `data-member` / `data-calls` kept |
| components/charts/heatmap.tsx | cell `<span>` with sequential fill / hatched zero | kept: heat-tint cell is chart drawing (colour = value); inside `TableCell` |
| components/charts/heatmap.tsx | row sublabel `<span>` | `Text type="supporting"` |
| components/charts/heatmap.tsx | scroll/border wrapper `<div data-testid>` | kept: carries the e2e test id, `max-h` scroll and border around the Astryx Table |
| components/charts/kpi-tile.tsx | `icon: LucideIcon` rendered raw `<Icon className="size-5">` | Astryx `Icon icon={glyph} size="md"` (prop API unchanged; callers still pass lucide glyphs) |
| components/charts/kpi-tile.tsx | `Card`, `Heading`, `Stack`, `Text` | already Astryx |
| components/charts/kpi-tile.tsx | top colour rule `<span>` and icon tile `<span>` | kept: measure-colour decoration from the chart palette (series colour), no Astryx equivalent |
| components/charts/legend.tsx | `<ul>/<li>` series legend + colour swatch `<span>` | kept: chart legend; Astryx has no chart legend (StatusDot is a status, not a series key) |
| components/charts/legend.tsx | `SequentialLegend` gradient ramp `<div role="img">` | kept: colour-ramp key for sequential encodings; no Astryx equivalent |
| components/charts/timeline.tsx | 4 lucide icons (CheckCircle2, AlertTriangle, XCircle, CircleDot) | Astryx `Icon` semantic names `success`, `warning`, `error`, `info` |
| components/charts/timeline.tsx | 3 `<p>` per event | `Text as="p"` (`type="supporting"`, tabular numbers, `color="inherit"` + status tone class) |
| components/charts/timeline.tsx | `<ol>/<li>` event list | kept: ordered event timeline; Astryx `List` has no timeline layout, markup is semantic |
| components/charts/trend-area-chart.tsx | `@/components/ui/chart` wrapper (`ChartContainer`, `ChartTooltip`, `ChartLegend`) + Recharts `AreaChart` | kept: chart drawing is Recharts; the `chart.tsx` wrapper is owned by the other worker (components/ui) |
| components/charts/viz/data-table.tsx | raw `<table>` `<caption>` `<thead>` `<tbody>` `<tr>` `<th>` `<td>` (all) | Astryx `Table` (children mode) with `TableHeader` / `TableBody` / `TableRow` / `TableHeaderCell` / `TableCell`; `data-testid="table-row"`, `data-key`, `data-value` kept |
| components/charts/viz/data-table.tsx | wrapper `<div data-testid>` | kept: carries the e2e test id and border |
| components/charts/viz/line-chart.tsx | hand-drawn SVG line/area chart, `<svg>`, `<defs>`, text, circles (5 SVG groups) | kept: chart drawing, no Astryx chart |
| components/charts/viz/line-chart.tsx | `<div>` x2 layout + `Readout` | kept: layout wrappers around the chart; readout is Astryx `Text` (see shared.tsx) |
| components/charts/viz/ranked-bars.tsx | raw `<button data-testid="bar-row">` per row | Astryx `Button variant="ghost" width="100%"` (secondary while active); label = old `aria-label`; hover/focus/click handlers and `data-key` / `data-value` kept |
| components/charts/viz/ranked-bars.tsx | bar track + fill `<span>`s | kept: chart drawing (value bar inside the button) |
| components/charts/viz/ranked-bars.tsx | `<ul>/<li>` list | kept: semantic list of rows |
| components/charts/viz/shared.tsx | `Readout` `<p aria-live>` | Astryx `Text as="p"` (test id and `aria-live` kept) |
| components/charts/viz/shared.tsx | `niceScale`, `useWidth`, `stagger`, `fmt` helpers | kept: non-UI helpers |
| components/charts/viz/timeline-chart.tsx | hand-drawn SVG timeline (`<svg>`, `<line>`, `<circle>`, `<text>`, `<rect>`) | kept: chart drawing, no Astryx chart |
| components/charts/viz/timeline-chart.tsx | `<div>` x2 layout + `Readout` | kept: layout wrappers; readout is Astryx `Text` |
| components/map/flat-map.tsx | `<div role="img" data-testid="flat-map-canvas">` ECharts geo map host | kept: map drawing (ECharts canvas), no Astryx equivalent |
| components/map/globe-view.tsx | `react-globe.gl` + three.js globe in `<div>` | kept: 3D globe, no Astryx equivalent |
| components/map/territory-map.tsx | 4 raw `<button>` crumbs (`crumb-world`, `crumb-country`) in `<nav aria-label="Map level">` | Astryx `Breadcrumbs label="Map level"` + `BreadcrumbItem` (`onClick`, `isCurrent` for the last level); `crumb-*` test ids kept |
| components/map/territory-map.tsx | `Row` raw `<button>` country options (`country-option-*`) | Astryx `Button width="100%"` (label = name + count) |
| components/map/territory-map.tsx | `Row` raw `<button aria-pressed>` territory options (`territory-option-*`) | Astryx `ToggleButton isPressed` |
| components/map/territory-map.tsx | `<h2>` "Territory map" | Astryx `Heading level={2}` |
| components/map/territory-map.tsx | 5 lucide icons (ChevronRight, Globe2, Lock, MapPin, Navigation) rendered raw | Astryx `Icon`: `chevronRight` semantic name (breadcrumb separator); `Icon icon={Globe2/Lock/MapPin/Navigation}` for the rest |
| components/map/territory-map.tsx | "Your territory" pill `<p>` | Astryx `Badge variant="info"` with `Icon` |
| components/map/territory-map.tsx | ~12 `<p>`/`<span>` text blocks (range, scope, counts, notes, legend title) | Astryx `Text` / `HStack` (`display-2` for the call counts); `map-range`, `territory-calls`, `country-calls`, `suppression-note` test ids kept |
| components/map/territory-map.tsx | `BlockSkeleton` x2 loading fallbacks | already Astryx `Skeleton` (via `state/states`) |
| components/map/territory-map.tsx | `Legend` gradient bar `<span>` | kept: colour-ramp key |
| components/map/territory-map.tsx | `<ul>/<li>` option lists x2 | kept: semantic lists of option buttons |
| components/map/territory-map.tsx | `<section>` card shell with `border bg-card shadow-card`, `<aside>` panel, layout `<div>`s | kept: shell with responsive 2-column grid, `data-*` hooks for e2e, `drill-in` view transition classes; Astryx `Card` has no responsive column split |
| components/landing/admin-data-quality.tsx | 3 raw lucide icons in Astryx slots (RefreshCw in `Button icon`, CircleAlert in `ListItem startContent`, Link2 in `Button icon`) | Astryx `Icon icon={RefreshCw/CircleAlert/Link2}` (severity colour through `Icon color`) |
| components/landing/admin-data-quality.tsx | `Badge`, `Banner`, `Button`, `Card`, `Heading`, `HStack`, `List`/`ListItem`, `Table`, `Text`, `VStack`, `SectionCard` (DatabaseZap, GitFork icons via `SectionCard icon`) | already Astryx |
| components/landing/admin-data-quality.tsx | 8 layout `<div>`s (responsive grids `grid-cols-3`, `lg:grid-cols-2/3`, stacks) | kept: Astryx `Grid columns` takes a fixed count and cannot switch by breakpoint |
| components/landing/admin-data-quality.tsx | `BlockSkeleton` x2 | already Astryx `Skeleton` |
| components/landing/admin-landing.tsx | 3 raw lucide icons in Astryx slots (Search in `Button icon`, UserCheck inline, CircleAlert in `Banner icon`) | Astryx `Icon`: `search` semantic name; `Icon icon={UserCheck}` / `Icon icon={CircleAlert}` |
| components/landing/admin-landing.tsx | `AlertDialog`, `Badge`, `Banner`, `Button`, `Card`, `CheckboxList`, `DateTimeInput`, `Heading`, `HStack`, `Selector`, `Table`, `Text`, `TextInput`, `VStack`, `SectionCard` (UserCheck, KeyRound, Clock3 icons via `SectionCard icon`) | already Astryx |
| components/landing/admin-landing.tsx | 2 `<form>` (scope-assignment, access-audit filters) | kept: Astryx has no `Form` component; native form keeps submit/Enter and `aria-label` |
| components/landing/admin-landing.tsx | 9 layout `<div>`s (responsive grids, padding wrappers) | kept: responsive grids as above |
| components/landing/admin-landing.tsx | `BlockSkeleton` x3 | already Astryx `Skeleton` |
| components/landing/data-through-badge.tsx | custom pill `<span data-testid="data-through">` with border/bg classes | Astryx `Badge` (`variant` success / warning / neutral; `data-testid` and `data-stale` kept) |
| components/landing/data-through-badge.tsx | 3 lucide icons (CircleAlert, CircleCheck, Hourglass) | Astryx `Icon`: semantic `warning`, `success`; `Icon icon={Hourglass}` |
| components/landing/kpi-card.tsx | wrapper over `KpiTile` | kept: pure mapping of tone to chart slot, no UI element |
| components/landing/landing-section.tsx | `@/components/ui/button` `Button variant="outline"` ("Show 90 days") | Astryx `Button variant="secondary" label` |
| components/landing/landing-section.tsx | `<h1>` title + `<p>` description | Astryx `Heading level={1}` + `Text as="p"` |
| components/landing/landing-section.tsx | range label `<span data-testid="range-label">` | Astryx `Text` |
| components/landing/landing-section.tsx | flex `<div>`s for title block and scope row | Astryx `VStack` / `HStack` |
| components/landing/landing-section.tsx | territory loading `<div class="animate-pulse ...">` | Astryx `Skeleton` (`territory-loading` test id kept) |
| components/landing/landing-section.tsx | aggregate-only `<p data-testid="aggregate-only-note">` | Astryx `Banner status="info"` (`collapsible={false}`, test id kept) |
| components/landing/landing-section.tsx | 3 lucide KPI glyphs (Stethoscope, Users, MessagesSquare) passed as `icon` to `KpiCard` | Astryx `Icon` inside `KpiTile` (glyphs are lucide: no semantic names) |
| components/landing/landing-section.tsx | KPI grid `<div data-testid="kpi-grid">` with scroll-snap carousel classes, outer page `<div>`s, map busy wrapper `<div>` | kept: horizontal scroll-snap carousel on phones / 3-col grid; Astryx `Carousel` would change touch behaviour |
| components/landing/landing-section.tsx | `ParallaxScene`, `SceneLayers`, `ScopeLabel`, `EmptyState`, `ErrorState`, `KpiSkeleton` | `EmptyState` / `ErrorState` / `KpiSkeleton` already Astryx (via `state/states`); `ParallaxScene` kept, see motion row |
| components/motion/expand.tsx | `<div className="expand"><div>` height-animating wrapper | kept: controlled mount/unmount with `grid-template-rows` 0fr to 1fr and reduced-motion fade; Astryx `Collapsible` is a trigger plus content disclosure (owns the toggle button), not a headless height primitive, and used by non-disclosure callers |
| components/motion/parallax-scene.tsx | pointer-driven tilt stage `<div>` x2 + `ParallaxLayer`/`SceneLayers` decorative layers | kept: no Astryx parallax / scene primitive (searched "parallax": no result); respects reduced motion and fine-pointer only |
| components/brand/brand-mark.tsx | `next/image` of `/icon.svg` | kept: product logo; Astryx has no logo component, and `Icon` is not for raster/branded art |
| app/page.tsx | `redirect("/msl")` | kept: no UI element |

# Part B: shared ui wrappers, chat, activity, hcps, filters, provenance, briefs, post-call, design, appearance, admin/shell/state/login

The `components/ui/{sheet,label,sonner,popover,switch,tabs}` wrappers are removed in this part, together with the `ui/input|button|badge|card|skeleton` adapters once Part A stopped importing them. Rows in Part A that say "owned by a parallel migration" (executive `record-drilldown` and `leadership-summaries`, director `question-panel`) now use `Drawer`, `useAppToast` and `FieldLabel`.

## Shared wrappers (`components/ui`)

| file | old element | Astryx replacement or "kept: <reason>" |
| --- | --- | --- |
| ui/popover.tsx | base-ui Popover wrapper, no importer | deleted; Astryx `Popover` when needed |
| ui/switch.tsx | base-ui Switch wrapper, no importer | deleted; Astryx `Switch` when needed |
| ui/tabs.tsx | base-ui Tabs wrapper, no importer | deleted; Astryx `TabList` / `Tab` (already used by admin panels) |
| ui/sheet.tsx | base-ui dialog "Sheet" (6 callers: chat-drawer, citation-sheet, visual-card, activity/evidence-drawer, executive/record-drilldown, executive/themes/leadership-summaries) | deleted; callers use Astryx `Drawer` + `DrawerHeader` (`Dialog variant="fullscreen"` for the visual card) |
| ui/sonner.tsx, `<Toaster />` in app/layout.tsx, `sonner` dependency | sonner toasts (9 files, 14 call sites) | removed; Astryx `Toast` through `useAppToast()` (components/state/use-app-toast.tsx) which keeps the `toast.success/error(title, { description, id })` call shape |
| ui/label.tsx | shadcn Label (4 callers: activity/flag-form, filters/filter-bar, post-call/optional-workspace, director/insights/question-panel) | deleted; Astryx fields render their own label (`TextInput`, `TextArea`, `Selector`, `DateInput`), `FieldLabel` where the control is not an Astryx field |
| ui/chart.tsx | shadcn chart wrapper around recharts (4 callers: activity-charts, charts/trend-area-chart, director/comparison-panel, director/mix-section) | kept: Astryx ships no chart components, so the recharts container stays. Its tooltip and legend chrome, previously raw divs and spans, is rebuilt on Astryx `Card`, `HStack`, `VStack` and `Text` |
| ui/input.tsx | native input restyled on base-ui | deleted; every caller uses `TextInput` / `NumberInput` / `DateInput` |
| ui/button.tsx, ui/badge.tsx, ui/card.tsx, ui/skeleton.tsx | adapters over Astryx (`Button` + `buttonVariants`, `Badge`, `Card`, `Skeleton`) | deleted; nothing imports them any more (Part A callers moved to `@astryxdesign/core/*` in the same release). The `@base-ui/react` and `class-variance-authority` dependencies went with them |

## Adjustments found by the responsive and appearance matrices

The matrices (`responsive.spec.ts`, `appearance-matrix.spec.ts`) caught places where the Astryx component behaves differently from
the element it replaced. Each is fixed in place and recorded here so the exception is visible.

| file | change | reason |
| --- | --- | --- |
| theme-patches.css | pressed `ToggleButton` text uses `--color-text-primary` | accent text on the pressed wash is 4.27:1 in the neutral theme (AA needs 4.5:1) |
| provenance/provenance.tsx | `CitationChip` keeps `pointer-coarse:min-h-11`; the chip's inner runs stay plain spans (number, record id, detail) | Astryx `Text` blocks inside the chip set their own line-height and overlapped neighbours; the detail text lost contrast on the secondary Button wash |
| provenance/provenance.tsx | `Frame` body is a plain `div` (kept: running prose with inline citation chips) | a `Text as="div"` wrapper sets display and line-height of its own |
| chat/answer-rows.tsx | Table `style={{ minWidth: "34rem" }}`, `min-w-*` on the id, date and number cells | Astryx cells collapse to about 22px when the answer panel is narrow; below the floor the table scrolls sideways in its own wrapper |
| chat/assistant-turn.tsx | KPI tile `gap={3}` | `display-3` numbers overlapped their label in the matcha theme |
| hcps/hcp-timeline.tsx | `MetadataList` for levels 0 and 1, plain label/value `Text` pairs below; collapsible trigger set to full width with a shrinkable label | ten nested follow-ups narrow the card below `MetadataList`'s minimum column width; the trigger is a shrink-to-fit button whose label could not truncate |
| filters/insight-discovery.tsx | Saved-views `Card` uses the default variant (was `muted`) | the muted variant draws dark text on a dark wash in the chocolate and gothic looks |
| TextArea with a character limit (chat feedback, flag form, briefs) | `data-layout-ok="overlap"` | the Astryx counter sits inside the field by design |
| state/use-app-toast.tsx | errors auto-hide like every toast | sonner auto-dismissed errors; Astryx persists them unless `isAutoHide` is set |
| e2e (`screens.ts`, `smoke`, `chat-drawer`, `motion`, `layout-checks`) | selectors moved from `select`, `[data-sonner-toast]` and `[data-slot=sheet-content]` to the Astryx `Selector` options, `.astryx-toast` and the drawer test id | the elements they pointed at no longer exist |

## Chat

Historical: Ask the agent has since moved to CopilotKit's components (docs/adr/0018). `chat-conversation.tsx` is gone, and
`chat-drawer.tsx` and `chat-panel.tsx` no longer use the Astryx chat parts listed below; `assistant-turn.tsx`,
`answer-feedback.tsx`, `answer-rows.tsx`, `citation-sheet.tsx` and `visual-card.tsx` remain as listed.

Paths are relative to `frontend/src`. One row per old element / old wrapper / lucide icon that existed before the change.
Astryx imports are always from the component's own entry (`@astryxdesign/core/<Name>`).

### Table

#### components/chat/chat-drawer.tsx

| file | old element | Astryx replacement or "kept: <reason>" |
| --- | --- | --- |
| chat-drawer.tsx | `ui/sheet` (`Sheet`, `SheetContent`, `SheetTitle`, `SheetDescription`, `SheetClose`) wrapping the panel | `Drawer` (side end, `width="var(--chat-panel-w)"`, `isOpen`/`onOpenChange`, `label="Ask the agent"`) + `Layout`/`LayoutContent` + `DrawerHeader`. The iPad-portrait "sheet" presentation is also `Drawer` at `width="100%"` (+ `experimental.isFullWidthOnMobile`): `BottomSheet` is capped at 640px wide and 92% tall, which would break the full-screen geometry `e2e/chat-drawer.spec.ts` measures. `data-testid="chat-drawer"` and `data-presentation` kept on the `<dialog>` (testid only while open, so a closed panel is absent like before). Escape closes (purpose `info`), focus returns to the opener, cursor goes to the composer on fine pointers via `data-autofocus` (replaces `initialFocus`). |
| chat-drawer.tsx | `SheetTitle` / `SheetDescription` (sr-only description) | `DrawerHeader title="Ask the agent"` (h2) and Drawer `label` for the dialog name. The sr-only description sentence was dropped (Drawer has no description slot; the visible context chips and composer placeholder carry it). |
| chat-drawer.tsx | `ui/button` `Button variant="outline"` (ChatTrigger, `chat-open`) | Astryx `Button variant="secondary"` with `icon`, `label`; running state: `StatusDot` (`chat-running`) and an aria-label "Ask AI, an answer is being written" replacing the sr-only span |
| chat-drawer.tsx | `<span className="relative inline-flex">` + `<span ... bg-primary>` running dot | `HStack as="span"` + Astryx `StatusDot variant="accent" isPulsing` |
| chat-drawer.tsx | `<span className="sr-only">An answer is being written</span>` | Astryx Button `label` (accessible name) + `StatusDot label` |
| chat-drawer.tsx | `ui/button` ghost icon `Button` (`chat-new`, aria-label "New conversation") | Astryx `IconButton variant="ghost" label="New conversation"` |
| chat-drawer.tsx | `SheetClose render={<Button ghost icon chat-close>}` | Astryx `IconButton variant="ghost" label="Close chat"` (`chat-close` kept) calling `setOpen(false)`; `DrawerHeader` has no `data-testid` on its own close button, so a custom one stays |
| chat-drawer.tsx | `<header>` flex row | `DrawerHeader` (`startContent`, `endContent`, `hasDivider`) inside `Layout header` |
| chat-drawer.tsx | `ContextChips`: `<section>`, `<span>` label, per-chip `<span>` pill | `HStack as="section"` / `HStack as="span"` + `Text`. Chips keep `data-testid="chat-chip"`, `data-kind`; pill look (border, rounded-full, bg-muted) is a token-backed utility: kept: Astryx `Token`/`Badge` are not a fit (Badge = status/category only; Token wants onRemove/onClick semantics and its own testid is not forwardable) |
| chat-drawer.tsx | lucide `Sparkles` (trigger) | kept: no semantic Astryx icon, rendered through Astryx `Icon` |
| chat-drawer.tsx | lucide `Sparkles` (header) | kept: no semantic Astryx icon, rendered through Astryx `Icon` (in `DrawerHeader startContent`) |
| chat-drawer.tsx | lucide `X` | `Icon icon="close"` |
| chat-drawer.tsx | lucide `MessageSquarePlus` | kept: no semantic Astryx icon, rendered through Astryx `Icon` |
| chat-drawer.tsx | lucide `LayoutDashboard` (screen chip) | kept: no semantic Astryx icon, rendered through Astryx `Icon` |
| chat-drawer.tsx | lucide `CalendarRange` (range chip) | `Icon icon="calendar"` |
| chat-drawer.tsx | lucide `MapPin` (territory chip) | kept: no semantic Astryx icon, rendered through Astryx `Icon` |
| chat-drawer.tsx | lucide `CircleHelp` (question chip) | kept: no semantic Astryx icon, rendered through Astryx `Icon` |
| chat-drawer.tsx | `cn()` + `data-[side=...]` Tailwind arbitrary-ish width classes on SheetContent | removed; `Drawer width` prop |

#### components/chat/citation-sheet.tsx

| file | old element | Astryx replacement or "kept: <reason>" |
| --- | --- | --- |
| citation-sheet.tsx | `ui/sheet` (`Sheet`, `SheetContent`, `SheetHeader`, `SheetTitle`, `SheetDescription`) | `Drawer` (side end, `width="28rem"`, `label` = "Source record" / "Aggregate source") + `Layout`/`LayoutContent` + `DrawerHeader title subtitle onOpenChange` (visible close button). `data-testid="citation-sheet"` kept (only while open). Last citation stays rendered during the slide-out (`useKeepMounted`). Nested inside the chat Drawer; Astryx layer stack closes only the topmost on Escape. |
| citation-sheet.tsx | `ui/skeleton` `Skeleton data-testid="citation-loading"` | Astryx `Skeleton` (`height`, `width`, `radius`) |
| citation-sheet.tsx | `<p role="status" data-testid="citation-unavailable">` dashed box | Astryx `Banner status="info" role="status"` (`citation-unavailable` kept) |
| citation-sheet.tsx | `<dl data-testid="citation-fields">` grid with `<dt>/<dd>` | Astryx `MetadataList` + `MetadataListItem` (`citation-fields` kept) |
| citation-sheet.tsx | raw `<button data-testid="show-rows">` | Astryx `Button variant="secondary"` with `icon` |
| citation-sheet.tsx | raw `<button data-testid="export-rows">` | Astryx `Button variant="secondary"` with `icon`, `isDisabled` |
| citation-sheet.tsx | raw `<table data-testid="chat-rows">` + `<caption>` + `<thead>/<tbody>/<tr>/<th>/<td>` | Astryx `Table` (children mode: `TableHeader`, `TableBody`, `TableRow`, `TableHeaderCell`, `TableCell`), `density="compact"`; scroll wrapper and focusable group come from Table. Caption became a `Text` linked by `aria-labelledby`. Rows keep `data-testid="chat-row"`; first cell `scope="row" role="rowheader"`. |
| citation-sheet.tsx | raw `<button>` Field sort toggle in `<th>` (text arrow "↑/↓") | Astryx `Button variant="ghost" size="sm"` with `endContent=<Icon arrowUp/arrowDown>`; `th aria-sort` set |
| citation-sheet.tsx | `<p data-testid="aggregate-citation">`, `<p ...-detail>` | `Text as="p"` (testids kept) |
| citation-sheet.tsx | dashed `<p>` note in AggregateBody | Astryx `Banner status="info"` (same wording split into title + description) |
| citation-sheet.tsx | layout `<div>`s (button row, grid wrappers) | `HStack`, `VStack` |
| citation-sheet.tsx | lucide `Rows3` | kept: no semantic Astryx icon, rendered through Astryx `Icon` |
| citation-sheet.tsx | lucide `Download` | kept: no semantic Astryx icon (Astryx has `upload`, no download), rendered through Astryx `Icon` |
| citation-sheet.tsx | unicode arrows "↑/↓" in sort label | `Icon "arrowUp"/"arrowDown"` |

#### components/chat/visual-card.tsx

| file | old element | Astryx replacement or "kept: <reason>" |
| --- | --- | --- |
| visual-card.tsx | `ui/sheet` (`Sheet`, `SheetContent side="bottom"`, `SheetHeader`, `SheetTitle`, `SheetDescription`) full-screen chart view | Astryx `Dialog variant="fullscreen"` + `DialogHeader title subtitle onOpenChange`. Chosen over `BottomSheet` (max 640px wide, would shrink the "full-screen" chart) and `Drawer` (side panel). `data-testid="visual-sheet"` kept (only while open, so `toHaveCount(0)` after Escape still holds). Escape closes, focus returns to the expand button. |
| visual-card.tsx | `ui/button` `Button variant="outline" size="sm"` (`visual-toggle`, `aria-pressed`) | Astryx `Button variant="secondary" size="sm"` with `icon`, `aria-pressed` kept |
| visual-card.tsx | `ui/button` `Button variant="outline" size="icon"` (`visual-expand`, aria-label `Expand <title>`) | Astryx `IconButton variant="secondary" size="sm" label="Expand <title>"` |
| visual-card.tsx | local `Skeleton()` function (div bars + shimmer + text) | `VisualPending`: `VStack` + Astryx `Skeleton` x2 + `Text` (`visual-pending`, role status, aria-label kept) |
| visual-card.tsx | `<article>`, `<header>`, `<footer>` layout, `<h4>`, `<p>`, `<span>`, `<strong>` | `VStack as="article"/"footer"`, `HStack as="header"/"p"`, `Heading level={4}`, `Text` (testids `visual`, `visual-title`, `visual-total` and data attrs kept; card frame stays token utilities) |
| visual-card.tsx | `<h5>` "The same numbers as a table" | `Heading level={5}` |
| visual-card.tsx | `<div data-testid="distribution-chart">` | `VStack` |
| visual-card.tsx | lucide `Maximize2` | kept: no semantic Astryx icon, rendered through Astryx `Icon` |
| visual-card.tsx | lucide `Table2` | kept: no semantic Astryx icon, rendered through Astryx `Icon` |
| visual-card.tsx | lucide `BarChart3` | kept: no semantic Astryx icon, rendered through Astryx `Icon` |
| visual-card.tsx | `Chart` (`LineChart`, `TimelineChart`, `Heatmap`, `RankedBars`, `DistributionBars`) and `DataTable` (`TableView`) | kept: `components/charts/**` is another area (custom SVG/visualisation; no Astryx chart component); not touched |

#### components/chat/answer-feedback.tsx

| file | old element | Astryx replacement or "kept: <reason>" |
| --- | --- | --- |
| answer-feedback.tsx | `sonner` `toast.error("Your rating could not be saved")` | `useAppToast().error(...)` |
| answer-feedback.tsx | raw `<button>` x2 thumbs (`rate-up`/`rate-down`, `aria-pressed`, `aria-label`) | Astryx `ToggleButton isIconOnly isPressed onPressedChange` (renders `aria-pressed`; label "Helpful"/"Not helpful"; testids kept) |
| answer-feedback.tsx | `<label>` + `<span>` text + raw `<textarea data-testid="rating-note-input">` | Astryx `TextArea` with its own `label`, `maxLength`, `rows`, `width="100%"`, testid kept on the field |
| answer-feedback.tsx | `ui/button` `Button type="submit" variant="outline"` (`rating-note-save`) | Astryx `Button type="submit" variant="secondary"` |
| answer-feedback.tsx | `<section>`, layout `<div>`, `<p>`, `<span role=status>` | `VStack as="section"`, `HStack`, `Text`, `HStack as="span" role="status"` |
| answer-feedback.tsx | `<form onSubmit>` | kept: native `<form>` (submit semantics, Enter handling); Astryx `FormLayout` is layout only |
| answer-feedback.tsx | lucide `Check` | `Icon icon="check"` |
| answer-feedback.tsx | lucide `ThumbsUp` | kept: no semantic Astryx icon, rendered through Astryx `Icon` |
| answer-feedback.tsx | lucide `ThumbsDown` | kept: no semantic Astryx icon, rendered through Astryx `Icon` |

#### components/chat/answer-rows.tsx

| file | old element | Astryx replacement or "kept: <reason>" |
| --- | --- | --- |
| answer-rows.tsx | `sonner` `toast.success("Rows exported", ...)` | `useAppToast().success(...)` |
| answer-rows.tsx | `sonner` `toast.error(...)` x1 (two titles) | `useAppToast().error(...)` |
| answer-rows.tsx | `ui/button` `Button` toggle (`answer-rows-toggle`, `aria-expanded`, `aria-controls`, `className="press"`) | Astryx `Button variant="secondary"` with `icon` and `endContent=<Icon chevronDown>` (rotates on open); `press` scale class dropped (Astryx buttons show a pressed overlay, `e2e/motion.spec.ts`) |
| answer-rows.tsx | `Expand` motion primitive around the panel | kept: app motion primitive (grid-rows open/close with unmount after exit); Astryx `Collapsible` owns its own trigger and cannot carry `data-testid="answer-rows-toggle"` / `aria-expanded` that e2e relies on |
| answer-rows.tsx | raw `<button>` pills (`row-set-option`, `aria-pressed`, `data-row-set`, `data-count`) | Astryx `ToggleButton size="sm" isPressed onPressedChange` (single choice among row sets; `SegmentedControl` would drop the data attributes) |
| answer-rows.tsx | `ui/skeleton` `Skeleton` x2 | Astryx `Skeleton` x2 |
| answer-rows.tsx | `<p data-testid="answer-rows-empty" role="status">` dashed box | Astryx `Banner status="info"` |
| answer-rows.tsx | `RowsError` `<div role="alert">` + `ui/button` Try again | Astryx `Banner status="error" role="alert"` with `endContent` Astryx `Button` |
| answer-rows.tsx | `ui/button` `Button` Export CSV (`answer-rows-export`) | Astryx `Button variant="secondary"` with `icon` |
| answer-rows.tsx | `ui/button` Previous / Next (`answer-rows-prev`/`-next`) | Astryx `Button size="sm" variant="secondary"` |
| answer-rows.tsx | `<nav aria-label="Row pages">`, `<span data-testid="answer-rows-range" aria-live>` | `HStack as="nav"`, `Text` (aria-live kept) |
| answer-rows.tsx | raw `<div role="region" tabIndex=0 data-testid="answer-rows-scroll">` scroll wrapper | `VStack` (keeps `answer-rows-scroll` and `data-layout-ok="overlap"`); the Astryx `Table` provides the focusable named scroll group (name from the table's `aria-label`, same text as before) |
| answer-rows.tsx | raw `<table data-testid="answer-rows-table" data-sort-by data-sort-dir>` + `<caption class="sr-only">` + `<thead>/<tbody>/<tr>/<th>/<td>` | Astryx `Table` (children mode, `density="compact"`, `verticalAlign="top"`), `TableHeader`/`TableBody`/`TableRow`/`TableHeaderCell`/`TableCell`; `data-sort-by`/`data-sort-dir`, `th aria-sort`, `answer-row`/`data-row-id`, cell `data-column` kept; caption is a `VisuallyHidden` `Text` referenced by `aria-describedby`; first column `TableCell scope="row" role="rowheader"` (sticky) |
| answer-rows.tsx | raw `<button data-testid="answer-rows-sort" data-column>` in each `<th>` | Astryx `Button variant="ghost" size="sm"` with `endContent=<SortIcon>` (min 44px under coarse pointer comes from `globals.css`) |
| answer-rows.tsx | `<p data-testid="answer-rows-summary">`, `<p ...-match>`, `<strong>`, `<p ...-exported role=status>`, `<p ...-export-denied>` | `Text`, `HStack as="p"` (testids and `data-match` kept) |
| answer-rows.tsx | `<section>`, layout `<div>`s, `<div id={panelId}>` | `VStack as="section"`, `HStack`, `VStack` |
| answer-rows.tsx | lucide `Rows3` | kept: no semantic Astryx icon, rendered through Astryx `Icon` |
| answer-rows.tsx | lucide `ChevronDown` | `Icon icon="chevronDown"` |
| answer-rows.tsx | lucide `Download` | kept: no semantic Astryx icon, rendered through Astryx `Icon` |
| answer-rows.tsx | lucide `Lock` | kept: no semantic Astryx icon, rendered through Astryx `Icon` |
| answer-rows.tsx | lucide `CheckCircle2` | `Icon icon="success"` |
| answer-rows.tsx | lucide `AlertTriangle` | `Icon icon="warning"` |
| answer-rows.tsx | lucide `ChevronsUpDown` (unsorted column) | `Icon icon="arrowsUpDown"` |
| answer-rows.tsx | lucide `ArrowUp` | `Icon icon="arrowUp"` |
| answer-rows.tsx | lucide `ArrowDown` | `Icon icon="arrowDown"` |

#### components/chat/assistant-turn.tsx

| file | old element | Astryx replacement or "kept: <reason>" |
| --- | --- | --- |
| assistant-turn.tsx | `ui/badge` `Badge variant="outline"` (`stub-badge`) | Astryx `Badge variant="warning" label=...` |
| assistant-turn.tsx | `<section data-testid="sample-limitations">` + `<h4>` + `<ul>` + lucide `Info` | Astryx `Banner status="warning" icon={<Icon "info">}` (title "Sample limitations", list as children); `<ul list-disc>` stays raw: kept: bullet list, Astryx `List` is row-based |
| assistant-turn.tsx | `<p role="alert" data-testid="number-warning">` + lucide `AlertTriangle` | Astryx `Banner status="warning" role="alert"` |
| assistant-turn.tsx | `<p role="alert" data-testid="chat-error">` | Astryx `Banner status="error" role="alert"` |
| assistant-turn.tsx | `<p data-testid="aggregate-only-note">` + lucide `Lock` | Astryx `Banner status="info" icon={<Icon Lock>}` (title + description) |
| assistant-turn.tsx | `<section data-testid="citations">`, `<h4>`, `<ul flex-wrap>` | `VStack as="section"`, `Heading level={4}`, `HStack as="ul"` |
| assistant-turn.tsx | `CitationChip` (from `components/provenance`, a raw `<button>` there) | kept: shared provenance component owned by another area (it renders the raw button); used here only as the call site |
| assistant-turn.tsx | `<section data-testid="chat-fact-chart">` hand-drawn bars (`style={{ width }}`) | Astryx `ProgressBar` per fact (`label`, `value`, `max`, `hasValueLabel`, `formatValueLabel`) inside `VStack as="section"` (testid kept); removes the inline `style` |
| assistant-turn.tsx | `KpiTile` `<div>` with `<dt>/<dd>/<p>` | `VStack` + `Text` (display-3 for the number); `<dt>`/`<dd>`/`<dl>` kept: definition-list semantics have no Astryx equivalent (`MetadataList` has no per-tile testid/count-up), testids `fact-*`, `data-value`, `source-facts` kept |
| assistant-turn.tsx | `<dl data-testid="source-facts" className="grid gap-3 sm:grid-cols-3">` | kept: `dl` semantics for the KPI tiles; token-backed grid utilities |
| assistant-turn.tsx | `<section data-testid="visuals" grid>` | `VStack as="section"` |
| assistant-turn.tsx | `<div data-testid="ai-summary" aria-live>` | `VStack` |
| assistant-turn.tsx | `<p key={i}>` prose paragraphs + typing-cursor `<span>` | kept: streamed prose with inline `Markdown` and citation markers; no Astryx equivalent for the blinking caret |
| assistant-turn.tsx | spans in provenance `meta` (`fact-data-through`, "Counted by database queries…", "Generated by AI…") | `Text type="supporting"` |
| assistant-turn.tsx | `<p>` "Thinking…", `<p data-testid="saved-note">` | `Text as="p"` |
| assistant-turn.tsx | `<div className="flex justify-end">` around `ExportButton` | `HStack hAlign="end"`. `ExportButton`, `AiSummary`, `SourceFact`, `Suggestion`: kept (provenance family, other area) |
| assistant-turn.tsx | already Astryx before this change: `Avatar`, `Button` (suggestions), `Citation`, `ChatMessage*`, `ChatToolCalls`, `Markdown` | unchanged |
| assistant-turn.tsx | lucide `AlertTriangle` | `Icon icon="warning"` (via Banner status) |
| assistant-turn.tsx | lucide `Info` | `Icon icon="info"` |
| assistant-turn.tsx | lucide `Lock` | kept: no semantic Astryx icon, rendered through Astryx `Icon` |
| assistant-turn.tsx | lucide `BarChart3` | kept: no semantic Astryx icon, rendered through Astryx `Icon` |
| assistant-turn.tsx | lucide `FileText` | kept: no semantic Astryx icon, rendered through Astryx `Icon` |

#### components/chat/chat-panel.tsx

| file | old element | Astryx replacement or "kept: <reason>" |
| --- | --- | --- |
| chat-panel.tsx | `ui/button` `Button variant="outline"` (`chat-new`) | Astryx `Button variant="secondary"` with `icon` |
| chat-panel.tsx | `<h1>` | `Heading level={1}` |
| chat-panel.tsx | `<p>` intro | `Text as="p" color="secondary"` |
| chat-panel.tsx | `<span data-testid="chat-context">` pill | `HStack as="span"` + `Text` |
| chat-panel.tsx | `<div>`/`<header>` layout, `min-h-[calc(...)]` arbitrary class | `VStack`, `HStack as="header"`, `minHeight` prop |
| chat-panel.tsx | lucide `MessageSquarePlus` | kept: no semantic Astryx icon, rendered through Astryx `Icon` |
| chat-panel.tsx | `ScopeLabel` (components/shell) | kept: other area |

#### components/chat/chat-conversation.tsx

| file | old element | Astryx replacement or "kept: <reason>" |
| --- | --- | --- |
| chat-conversation.tsx | already Astryx: `Button` (starters), `EmptyState`, `ChatLayout`, `ChatComposer`, `ChatComposerInput`, `ChatSendButton`, `ChatMessageList`, `ChatMessage`, `ChatMessageBubble`, `ChatSystemMessage` | unchanged |
| chat-conversation.tsx | `<div className="flex flex-wrap justify-center gap-2">` (starters) | `HStack hAlign="center" wrap="wrap"` |
| chat-conversation.tsx | `<span data-testid="turn-context">` | `Text as="span" type="supporting"` |
| chat-conversation.tsx | `inputRef` prop + `setRef` (for Sheet `initialFocus`) | replaced by `autoFocusInput` prop that sets `data-autofocus` on the composer's editable when the pointer is fine; Astryx Drawer focuses that element on open |

#### other files

| file | old element | Astryx replacement or "kept: <reason>" |
| --- | --- | --- |
| components/chat/chat-provider.tsx | no UI elements (context provider only) | nothing to migrate |
| app/(app)/chat/page.tsx | no UI elements (Suspense + `ChatPanel`) | nothing to migrate |
| components/chat/use-keep-mounted.ts | new hook (no old element) | keeps Drawer/Dialog children mounted for the slide-out (`--duration-medium` + 90ms), because Astryx `Drawer`/`Dialog` always render their host element and keep given children |

### Counts

Replaced (old element/wrapper/icon -> Astryx or Astryx idiom): 80
- ui/sheet -> Drawer / Dialog: 3 (chat-drawer, citation-sheet, visual-card)
- raw `<button>` -> Button / IconButton / ToggleButton: 8 (answer-feedback 2, answer-rows 4 incl. sort/row-set, citation-sheet 3 incl. sort)
- raw `<table>` -> Table: 2 (answer-rows, citation-sheet)
- raw `<textarea>` + `<label>` -> TextArea: 1 (answer-feedback)
- sonner toast -> useAppToast: 3 call sites in 2 files (answer-feedback 1, answer-rows 2)
- ui/button -> Astryx Button / IconButton: 13 call sites
- ui/badge -> Badge: 1; ui/skeleton -> Skeleton: 4 (citation-sheet, answer-rows x2, visual-card local skeleton)
- dashed/alert `<p>`/`<div>` status messages -> Banner: 8
- `<dl>` record fields -> MetadataList: 1; hand-drawn bars -> ProgressBar: 1
- headings/paragraph/spans/layout divs -> Heading/Text/HStack/VStack: ~30 instances
- lucide icons swapped to a semantic Astryx icon name: 10 (X, CalendarRange, Check, ChevronDown, CheckCircle2, AlertTriangle x2, ChevronsUpDown, ArrowUp, ArrowDown, Info)

Kept (with reason above): 27
- lucide glyphs with no semantic Astryx name, now rendered through Astryx `Icon`: 17 (Sparkles x2, MessageSquarePlus x2, LayoutDashboard, MapPin, CircleHelp, Rows3 x2 + 1 in answer-rows, Download x2, Maximize2, Table2, BarChart3 x2, FileText, ThumbsUp, ThumbsDown, Lock x2)
- `Expand` motion primitive, native `<form>`, `<dl>`/`<dt>`/`<dd>` KPI tiles + grid, bullet `<ul>`, streamed prose `<p>` and caret span, `CitationChip`/provenance family (other area), charts/`DataTable` (other area), `ScopeLabel` (other area): 10

Remaining `ui/*`, `sonner`, raw `<button>/<table>/<textarea>/<label>/<select>/<details>` in the area: 0.

### Modern Web Guidance

Searches run (`npx modern-web-guidance@latest search "<task>"`):

- "modal dialog drawer side panel bottom sheet": navigation-drawer, dialog, prevent-page-scroll-under-modal-dialog, platform-controls-dismiss-dialog, light-dismiss-a-dialog, persistent-top-layer-ui (all satisfied by the native `<dialog>` that Astryx `Drawer`/`Dialog` use: top layer, focus trap, scroll lock, Escape, light dismiss per `purpose`).
- "accessible data table sortable columns": sortable-table, responsive-table, accessibility, single-line-overflow (satisfied: Astryx `Table` renders real `<table>` with header cells, `aria-sort` set on sorted `<th>`, a focusable named scroll group for narrow screens).
- "textarea form field feedback note": forms, ime-safe-enter-submit, required-field-feedback (the note field is optional, has a visible label, `maxLength`; no Enter-to-submit handling is added).

`npx modern-web-guidance@latest legacy-scan src/components/chat`:

```
Modern Web Guidance Analyzer — src/components/chat
0 findings from 33 qualified guides.
Note: legacy-scan covers legacy patterns for 33 guides (~20% of the guidance corpus). Use 'modern-web-guidance search <topic>' for general UI/platform guidance.
```

## Activity, HCPs, filters, provenance

Paths relative to `frontend/src`. One row per component instance that existed before the change (kept ones included).

| file | old element | Astryx replacement or kept |
| --- | --- | --- |
| components/activity/evidence-drawer.tsx | ui/sheet Sheet + SheetContent (data-testid=evidence-drawer, data-slot=sheet-content) | Astryx Drawer (side end, width 42rem, purpose form for the flag view / info for evidence, data-testid kept on the dialog). Last view stays mounted while it slides out |
| components/activity/evidence-drawer.tsx | ui/sheet SheetHeader + SheetTitle + SheetDescription (flag view) | Layout + DrawerHeader (title, subtitle, close button) + LayoutContent |
| components/activity/evidence-drawer.tsx | ui/sheet SheetHeader + SheetTitle + SheetDescription (evidence view) | Layout + DrawerHeader (title, subtitle, close button) + LayoutContent |
| components/activity/evidence-drawer.tsx | ui/button Button size=icon (Previous month) | Astryx IconButton (label + tooltip, isDisabled) |
| components/activity/evidence-drawer.tsx | ui/button Button size=icon (Next month) | Astryx IconButton (label + tooltip, isDisabled) |
| components/activity/evidence-drawer.tsx | raw <button aria-pressed> x2 (Calls / HCPs metric toggle in div role=group) | Astryx ToggleButtonGroup + ToggleButton x2 (label Metric) |
| components/activity/evidence-drawer.tsx | raw <select data-testid=evidence-channel> | Astryx Selector (label Channel hidden, data-testid kept; all-channels sentinel value) |
| components/activity/evidence-drawer.tsx | ui/skeleton Skeleton x4 (loading) | Astryx Skeleton x4 (height/radius props) |
| components/activity/evidence-drawer.tsx | ui/button Button variant=ghost size=sm (Flag, in Table action column) | Astryx Button (variant ghost, size sm, aria-label kept, data-testid kept) |
| components/activity/evidence-drawer.tsx | div / section / p / strong / span layout (toolbar, freshness panel, count line, cell contents) | VStack / HStack / Card variant blue (data-testid evidence-freshness) with inner section aria-label Freshness / Text |
| components/activity/evidence-drawer.tsx | raw <p data-testid=evidence-empty> dashed box | Astryx EmptyState (isCompact, data-testid kept) |
| components/activity/evidence-drawer.tsx | Table cells built from span.font-mono / span.block | Text type=code / VStack inside the existing Astryx Table (Table and Pagination were already Astryx) |
| components/activity/evidence-drawer.tsx | lucide ChevronLeft | Icon "chevronLeft" |
| components/activity/evidence-drawer.tsx | lucide ChevronRight | Icon "chevronRight" |
| components/activity/evidence-drawer.tsx | lucide Flag (row action) | kept: no semantic Astryx icon, rendered through Astryx Icon |
| components/activity/flag-form.tsx | ui/button Button (Done) | Astryx Button variant primary |
| components/activity/flag-form.tsx | ui/button Button type=submit (Send flag, data-testid=flag-submit) | Astryx Button variant primary size lg, isLoading while sending, isDisabled when invalid |
| components/activity/flag-form.tsx | ui/button Button type=button variant=outline (Cancel) | Astryx Button variant secondary size lg |
| components/activity/flag-form.tsx | raw <button role=radio aria-checked data-testid=flag-kind-*> x3 in div role=radiogroup | Astryx RadioList + RadioListItem x3 (real radios; data-testid kept; isDisabled when the preset cannot take that kind) |
| components/activity/flag-form.tsx | fieldset + legend "What is wrong?" | RadioList label="What is wrong?" |
| components/activity/flag-form.tsx | raw <select id=flag-target-type data-testid=flag-target-type> | Astryx Selector (label Type, id and data-testid kept) |
| components/activity/flag-form.tsx | ui/label Label x3 (Type, id field, note) | label prop of Selector / TextInput / TextArea (no separate label) |
| components/activity/flag-form.tsx | ui/input Input id=flag-target-id (maxLength 128) | Astryx TextInput (id/data-testid kept; 128 cap enforced in onChange because TextInput has no maxLength) |
| components/activity/flag-form.tsx | raw <textarea id=flag-note data-testid=flag-note> | Astryx TextArea (built-in counter via maxLength=500, error status over the limit, 550 hard cap kept in onChange, description "Do not include patient details.") |
| components/activity/flag-form.tsx | p role=alert flag-error | Astryx Banner status=error role=alert (data-testid kept) |
| components/activity/flag-form.tsx | div / h3 / p "Flag received" panel (data-testid=flag-sent, role=status) | Astryx Card variant muted + Heading + Text + HStack/VStack (role/status testid kept) |
| components/activity/flag-form.tsx | div layout of the manual target row and form stack | FormLayout direction=horizontal / VStack / HStack |
| components/activity/flag-form.tsx | lucide Flag (pulsing icon while sending) | removed: Button isLoading shows the spinner |
| components/activity/flag-form.tsx | lucide Send | kept: no semantic Astryx icon, rendered through Astryx Icon |
| components/activity/flag-status-badge.tsx | custom span pill (title=hint, data-testid=flag-status, data-status) with class recipe per status | Astryx Badge (variant per status: yellow/blue/green/neutral, data-testid + data-status kept) wrapped in Astryx Tooltip (replaces title) |
| components/activity/flag-status-badge.tsx | lucide Icon from FLAG_STATUS_META (CircleDashed, CircleDot, CircleCheck, CircleSlash) | Icon "success" for RESOLVED; CircleDashed / CircleDot / CircleSlash: kept: no semantic Astryx icon, rendered through Astryx Icon |
| components/activity/format.ts | lucide CircleCheck (RESOLVED) | Icon "success" |
| components/activity/format.ts | lucide CircleDashed (OPEN) | kept: no semantic Astryx icon, rendered through Astryx Icon |
| components/activity/format.ts | lucide CircleDot (IN_REVIEW) | kept: no semantic Astryx icon, rendered through Astryx Icon |
| components/activity/format.ts | lucide CircleSlash (DISMISSED) | kept: no semantic Astryx icon, rendered through Astryx Icon |
| components/activity/flags-panel.tsx | ui/button Button variant=outline (Flag an issue, data-testid=flag-open) | Astryx Button variant secondary with icon |
| components/activity/flags-panel.tsx | ui/skeleton Skeleton | Astryx Skeleton |
| components/activity/flags-panel.tsx | section with rounded-2xl border bg-card shadow-card classes | Astryx Card (padding 5, elevation low, data-testid=flags-panel) with inner section aria-labelledby |
| components/activity/flags-panel.tsx | ul/li divide-y list of flags (data-testid=flag-item) | Astryx List + ListItem (hasDividers, label/description/endContent) |
| components/activity/flags-panel.tsx | p data-testid=flags-empty dashed box | Astryx EmptyState (isCompact, data-testid kept) |
| components/activity/flags-panel.tsx | div / h2 / p / span layout | VStack / HStack / Heading level 2 / Text |
| components/activity/flags-panel.tsx | lucide Plus | kept: no semantic Astryx icon, rendered through Astryx Icon |
| components/activity/flags-panel.tsx | lucide Flag (empty state) | kept: no semantic Astryx icon, rendered through Astryx Icon |
| components/activity/activity-charts.tsx | ui/chart ChartContainer (MonthlyBarChart) | kept: recharts has no Astryx equivalent; ui/chart is already an Astryx-composed recharts adapter (Card/Text/HStack/VStack tooltip + legend). See Chart wrapper note |
| components/activity/activity-charts.tsx | ui/chart ChartTooltip + ChartTooltipContent (MonthlyBarChart) | kept: recharts tooltip hook; content already renders Astryx Card/Text |
| components/activity/activity-charts.tsx | ui/chart ChartContainer (ChannelStackChart) | kept: see Chart wrapper note |
| components/activity/activity-charts.tsx | ui/chart ChartTooltip + ChartTooltipContent + ChartLegend + ChartLegendContent (ChannelStackChart) | kept: see Chart wrapper note |
| components/activity/activity-charts.tsx | recharts BarChart/Bar/XAxis/YAxis/CartesianGrid/Cell | kept: recharts SVG drawing, no Astryx chart component; colours are var(--chart-n) / palette tokens so they follow the theme with no resolveCssColor needed (SVG, not canvas) |
| components/activity/activity-trends.tsx | div data-testid=activity-trends + header + div/h1/p/span page header and window label | VStack / VStack as=header / Heading level 1 / Text (data-testids kept) |
| components/activity/activity-trends.tsx | div grid sm:grid-cols-2 (trend-totals) | Astryx Grid columns minWidth 300 max 2 |
| components/activity/activity-trends.tsx | ChartCard div/h2/p/p layout inside the (already Astryx) Card | VStack / HStack / Heading level 2 / Text; Card, Button and Skeleton were already Astryx |
| components/activity/activity-trends.tsx | lucide Stethoscope (passed to KpiCard icon prop) | kept: handed to KpiCard/KpiTile (components/landing, out of my area) which renders it |
| components/activity/activity-trends.tsx | lucide Users (passed to KpiCard icon prop) | kept: handed to KpiCard/KpiTile (components/landing, out of my area) which renders it |
| components/filters/filter-bar.tsx | raw <button aria-pressed data-testid=range-7d|30d|90d|qtd|ytd> x5 (preset map) | Astryx ToggleButtonGroup (label Date range presets) + ToggleButton x5 (data-testid and aria-pressed kept) |
| components/filters/filter-bar.tsx | raw <button aria-pressed data-testid=range-custom> | Astryx ToggleButton value custom in the same group |
| components/filters/filter-bar.tsx | ui/button Button variant=ghost size=sm (Reset) | Astryx Button variant ghost size sm with icon |
| components/filters/filter-bar.tsx | ui/input Input type=date id=range-from | Astryx DateInput (id kept; native picker on touch, calendar popover with a fine pointer) |
| components/filters/filter-bar.tsx | ui/input Input type=date id=range-to | Astryx DateInput (id kept; min/max and error status wired) |
| components/filters/filter-bar.tsx | ui/label Label From / To | label prop of DateInput |
| components/filters/filter-bar.tsx | raw <select id=filter-{id}> per SelectFilter (territory, molecule, landscape, study, survey, question, ...) | Astryx Selector (id filter-{id} kept, presentation adaptive = bottom sheet on touch, all-option sentinel mapped back to empty string) |
| components/filters/filter-bar.tsx | ui/label Label per select | label prop of Selector |
| components/filters/filter-bar.tsx | section with rounded-2xl border bg-card shadow-card (data-testid=filter-bar, aria-label=Filters) | Astryx Card (data-testid=filter-bar) with inner section aria-label Filters |
| components/filters/filter-bar.tsx | p role=alert "Pick a start date on or before the end date." | DateInput status error with message (announced by the field) |
| components/filters/filter-bar.tsx | div/span flex layout | HStack / VStack / Text |
| components/filters/filter-bar.tsx | lucide CalendarRange | Icon "calendar" |
| components/filters/filter-bar.tsx | lucide RotateCcw | kept: no semantic Astryx icon, rendered through Astryx Icon |
| components/filters/insight-discovery.tsx | ui/button Button variant=outline size=sm per saved view | Astryx Button variant secondary size sm (aria-label "<name>, reopen saved view") |
| components/filters/insight-discovery.tsx | ui/button Button (Save) | Astryx Button variant primary, isLoading while saving |
| components/filters/insight-discovery.tsx | ui/input Input aria-label=Saved view name (maxLength 80) | Astryx TextInput label hidden (80 cap in onChange) |
| components/filters/insight-discovery.tsx | ui/badge Badge variant=outline "Question-level" | Astryx Badge neutral with icon |
| components/filters/insight-discovery.tsx | ui/badge Badge status (default/outline) on question card | Astryx Badge (blue for active, neutral otherwise) |
| components/filters/insight-discovery.tsx | ui/badge Badge outline tags per question (topic, molecule, tumor type, study, survey) | Astryx Badge neutral |
| components/filters/insight-discovery.tsx | ui/card Card + CardHeader + CardTitle + CardDescription + CardContent (DistributionCard) | Astryx Card + Heading level 3 + Text + VStack |
| components/filters/insight-discovery.tsx | ui/card Card + CardHeader + CardTitle + CardDescription + CardContent x2 (question catalog card) | Astryx Card + Heading level 3 + Text + HStack/Badge |
| components/filters/insight-discovery.tsx | section.rounded-xl.bg-secondary/55 saved-views strip | Astryx Card variant muted with inner section aria-label Saved views |
| components/filters/insight-discovery.tsx | p.rounded-xl.bg-muted x2 (no responses / no catalog questions) | Astryx EmptyState (isCompact) |
| components/filters/insight-discovery.tsx | div / h2 / p / grid layout | VStack / HStack / Heading level 2 / Text / Grid |
| components/filters/insight-discovery.tsx | lucide BookmarkPlus | kept: no semantic Astryx icon, rendered through Astryx Icon |
| components/filters/insight-discovery.tsx | lucide Check (shown while saving) | removed: Button isLoading shows the spinner |
| components/filters/insight-discovery.tsx | lucide ClipboardList | kept: no semantic Astryx icon, rendered through Astryx Icon |
| components/filters/insight-discovery.tsx | lucide SlidersHorizontal | kept: no semantic Astryx icon, rendered through Astryx Icon |
| components/filters/filter-context.tsx | no UI elements (React context provider) | n/a |
| components/hcps/hcp-search.tsx | ui/badge Badge variant=outline "Missing" | Astryx Badge neutral |
| components/hcps/hcp-search.tsx | div / h2 / h3 / p / span / grid xl:grid-cols layout (Card, TextInput, Button, List, EmptyState, Skeleton, MetadataList were already Astryx) | Grid / VStack / HStack / Heading / Text; raw <form role=search> kept: Astryx has no form element |
| components/hcps/hcp-search.tsx | lucide Search (section header) | Icon "search" |
| components/hcps/hcp-search.tsx | lucide Search (EmptyState icon) | Icon "search" |
| components/hcps/hcp-search.tsx | lucide Search (TextInput startIcon) | startIcon "search" (semantic name, Astryx renders it through Icon) |
| components/hcps/hcp-search.tsx | lucide ChevronRight | Icon "chevronRight" |
| components/hcps/hcp-search.tsx | lucide UserRound (list item) | kept: no semantic Astryx icon, rendered through Astryx Icon |
| components/hcps/hcp-search.tsx | lucide UserRound (profile placeholder) | kept: no semantic Astryx icon, rendered through Astryx Icon |
| components/hcps/hcp-search.tsx | lucide Building2 | kept: no semantic Astryx icon, rendered through Astryx Icon |
| components/hcps/hcp-search.tsx | lucide ClipboardList | kept: no semantic Astryx icon, rendered through Astryx Icon |
| components/hcps/hcp-timeline.tsx | ui/badge Badge variant=outline (Chips) | Astryx Badge neutral inside HStack |
| components/hcps/hcp-timeline.tsx | raw <button aria-expanded aria-controls data-testid=response-toggle-*> (response disclosure; the doc comment called it <details>) | Astryx Collapsible (controlled; data-testid kept on the trigger content; follow-ups still mounted only when open) |
| components/hcps/hcp-timeline.tsx | div.rounded-xl.border response card (data-testid=response-*, data-depth) | Astryx Card padding 0 |
| components/hcps/hcp-timeline.tsx | ol/li call timeline with absolute icon bubbles (data-testid=hcp-call-timeline, call-*) | Astryx List + ListItem (no Astryx timeline component; rail dropped, icon in startContent) |
| components/hcps/hcp-timeline.tsx | dl/dt/dd response details (answer, date, source) | Astryx MetadataList + MetadataListItem |
| components/hcps/hcp-timeline.tsx | dl/dt/dd call details (channel, products, topics) | VStack of Text label + Badge chips inside ListItem description |
| components/hcps/hcp-timeline.tsx | ul/li perspective history rows (date | answer grid) | Astryx MetadataList (label position start, width 7rem) |
| components/hcps/hcp-timeline.tsx | div.rounded-xl.bg-fact-soft perspective history (data-testid=hcp-perspective-history) | Astryx Card variant blue |
| components/hcps/hcp-timeline.tsx | div.animate-pulse.bg-muted loading block (data-testid=hcp-timeline-loading) | Astryx Skeleton |
| components/hcps/hcp-timeline.tsx | border-l follow-up indentation and border-t section rule | Astryx Divider (vertical / horizontal) + HStack/VStack |
| components/hcps/hcp-timeline.tsx | div / h2 / h3 / p / span layout + 2-column grid | Grid / VStack / HStack / Heading / Text |
| components/hcps/hcp-timeline.tsx | lucide CalendarDays | Icon "calendar" |
| components/hcps/hcp-timeline.tsx | lucide ChevronDown (rotating disclosure chevron) | removed: Collapsible draws its own chevron |
| components/hcps/hcp-timeline.tsx | lucide MessageSquareText | kept: no semantic Astryx icon, rendered through Astryx Icon |
| components/hcps/hcp-timeline.tsx | lucide PhoneCall | kept: no semantic Astryx icon, rendered through Astryx Icon |
| components/hcps/hcp-timeline.tsx | lucide Tag | kept: no semantic Astryx icon, rendered through Astryx Icon |
| components/provenance/provenance.tsx | raw <button> CitationChip (onOpen given; data-testid=citation) | Astryx Button variant secondary size sm (aria-label/name, data-testid, className pass-through kept) |
| components/provenance/provenance.tsx | span CitationChip (no onOpen, static record id) | Astryx Badge neutral |
| components/provenance/provenance.tsx | KindBadge: Astryx Badge already, icon was a raw lucide element | Astryx Badge unchanged; icon now Icon (fact: color secondary; ai/suggestion keep the --ai/--suggest tint class: Astryx Icon has no colour value for them) |
| components/provenance/provenance.tsx | section Frame with FRAME classes (fact border, ai tinted, suggestion dashed outline) | kept: the dashed outline and --ai/--suggest tints are the app's provenance signal; Astryx Card has no dashed or provenance variant. Tokens only |
| components/provenance/provenance.tsx | div / span flex layouts (header row, citations row, meta/actions row, body) | HStack / Text |
| components/provenance/provenance.tsx | ExportButton: already Astryx Button; icon was raw <Download> | Astryx Button unchanged; icon through Icon |
| components/provenance/provenance.tsx | lucide Database (fact) | kept: no semantic Astryx icon, rendered through Astryx Icon |
| components/provenance/provenance.tsx | lucide Sparkles (ai) | kept: no semantic Astryx icon, rendered through Astryx Icon |
| components/provenance/provenance.tsx | lucide Lightbulb (suggestion) | kept: no semantic Astryx icon, rendered through Astryx Icon |
| components/provenance/provenance.tsx | lucide FileText (citation chip) | kept: no semantic Astryx icon, rendered through Astryx Icon |
| components/provenance/provenance.tsx | lucide Download (export) | kept: no semantic Astryx icon, rendered through Astryx Icon |
| app/(app)/msl/activity/page.tsx | no raw elements (RoleGate + ActivityTrendsSection) | n/a: nothing to migrate |
| app/(app)/msl/follow-up/page.tsx | no raw elements (RoleGate + OptionalWorkspace from components/post-call, another agent's area) | n/a: nothing to migrate in this file |

### Chart wrapper note (ui/chart.tsx)

`activity/activity-charts.tsx` keeps `@/components/ui/chart` (ChartContainer, ChartTooltip(Content), ChartLegend(Content)). Recharts draws SVG (not canvas), so tokens work through CSS variables and no `resolveCssColor`/`useThemeSignature` is needed for the bars. Rendering without the wrapper would mean copying its ~100-line tooltip and legend into this file. The wrapper has already been rewritten onto Astryx Card/Text/HStack/VStack and three other files still import it (`director/mix-section.tsx`, `director/comparison-panel.tsx`, `charts/trend-area-chart.tsx`). Recommendation: keep `components/ui/chart.tsx` (it is the Astryx-composed recharts adapter), do not delete it.

### Counts

Total instances: 118. Replaced: 87. Kept: 31.

| category | replaced | kept |
| --- | --- | --- |
| ui/sheet | 3 | 0 |
| buttons (raw / ui/button / chips) | 17 | 0 |
| select | 3 | 0 |
| skeleton | 3 | 0 |
| div/span/p/h* layout | 16 | 0 |
| empty states | 3 | 0 |
| table | 1 | 0 |
| lucide icons (all now render through Astryx Icon; kept = lucide component passed into Icon) | 13 | 25 |
| ui/label | 3 | 0 |
| input / ui/input | 4 | 0 |
| textarea | 1 | 0 |
| ui/badge / badge-like spans | 8 | 0 |
| ui/card / card-like frames | 7 | 0 |
| lists / details / dl | 5 | 0 |
| ui/chart + recharts | 0 | 5 |
| provenance frame | 0 | 1 |

Notes: every lucide icon is rendered through Astryx `Icon`; 'kept' there means the lucide glyph is still the source because Astryx has no semantic name for it. Three icons were removed outright (Collapsible chevron, Button isLoading spinners). `activity-trends.tsx` Stethoscope/Users are handed to KpiCard (out of area).
### Modern Web Guidance

Searches run (`npx modern-web-guidance@latest search "<q>"`), relevant hits only:

- "side drawer dialog panel": `dialog`, `light-dismiss-a-dialog`, `platform-controls-dismiss-dialog`, `navigation-drawer`. Astryx `Drawer` is a native `<dialog>` (showModal, Escape + scrim light dismiss, focus restore); `purpose="form"` is used for the flag form so a stray scrim click does not lose typing.
- "disclosure collapsible details": `accordion`, `search-hidden-content`, `html` (native Details). Astryx `Collapsible` replaces the hand-rolled button+aria-expanded; follow-up answers stay unmounted until opened (as before).
- "date range filter native date input": `forms`, `capture-location-agnostic-data`. Astryx `DateInput` default presentation `adaptive-native` keeps the browser picker on touch and a calendar popover with a fine pointer; values stay ISO `YYYY-MM-DD` calendar dates (no Date/time-zone conversion).
- "form textarea validation": `validate-input-after-interaction`, `accessible-error-announcement`, `ime-safe-enter-submit`, `forms`. Astryx TextArea/TextInput/Selector carry aria-invalid and announce status messages themselves; the flag form's error is an Astryx `Banner role="alert"` shown after submit, not while typing.

`npx modern-web-guidance@latest legacy-scan <dir>` after the change:

```
src/components/activity    0 findings from 33 qualified guides.
src/components/hcps        0 findings from 33 qualified guides.
src/components/filters     0 findings from 33 qualified guides.
src/components/provenance  0 findings from 33 qualified guides.
```

## Briefs, post-call, design guide, appearance

Area: `components/briefs/**`, `components/post-call/**`, `components/design/**`, `lib/appearance/**`, `app/(app)/design/page.tsx`, `app/(app)/msl/briefs/page.tsx`, `app/(app)/msl/page.tsx`. Paths are relative to `frontend/src`. "Astryx X" means `@astryxdesign/core/X`.

### components/briefs/brief-view.tsx

| file | old element | Astryx replacement or "kept: reason" |
| --- | --- | --- |
| briefs/brief-view.tsx | sonner `toast` (success x2, error x2) | `useAppToast()` (Astryx Toast) |
| briefs/brief-view.tsx | ui/button "Edit/Done editing" icon button (size icon, ghost) | IconButton variant ghost, `label` = old aria-label, `aria-pressed` kept |
| briefs/brief-view.tsx | ui/button "Remove" icon button | IconButton variant ghost |
| briefs/brief-view.tsx | ui/button "Add prompt / agenda item" (outline, disabled) | Button variant secondary, `isDisabled`, `icon` |
| briefs/brief-view.tsx | ui/button "Print / Save PDF" (data-testid brief-export, aria-describedby) | Button variant secondary |
| briefs/brief-view.tsx | ui/button "Regenerate brief" (data-testid brief-regenerate, animate-spin icon) | Button variant primary with `isLoading` |
| briefs/brief-view.tsx | ui/button "Discard" | Button variant secondary |
| briefs/brief-view.tsx | ui/button "Save changes" (data-testid brief-save) | Button variant primary with `isLoading` / `isDisabled` |
| briefs/brief-view.tsx | raw `<button>` supporting-record chips (hover:bg-accent...) | Button size sm variant secondary with Icon |
| briefs/brief-view.tsx | raw `<textarea>` item text (aria-label "<label> text", autoFocus, maxLength) | TextArea `isLabelHidden`, `hasAutoFocus`; max length enforced in `onChange` (Astryx does not enforce natively) |
| briefs/brief-view.tsx | raw `<textarea>` item detail (aria-label "<label> detail") | TextArea `isLabelHidden`; 800-char cap in `onChange` |
| briefs/brief-view.tsx | raw `<textarea>` call objective (data-testid brief-objective, aria-invalid) | TextArea with `status={{type:"error"}}` when invalid |
| briefs/brief-view.tsx | raw `<label htmlFor="brief-objective">` | TextArea `label="Call objective"` |
| briefs/brief-view.tsx | ui/badge outline "Added by you" | Badge neutral |
| briefs/brief-view.tsx | ui/badge secondary "Generated · edited" | Badge variant info |
| briefs/brief-view.tsx | ui/badge outline "Generated" | Badge neutral |
| briefs/brief-view.tsx | ui/badge model-mode (data-testid brief-model-mode) | Badge neutral |
| briefs/brief-view.tsx | `<header>` card (rounded border bg-card shadow) | Card padding 5 + VStack as header |
| briefs/brief-view.tsx | `<p>` eyebrow + `<h2>` HCP name | Text type label + Heading level 2 |
| briefs/brief-view.tsx | `<dl>/<dt>/<dd>` Scope, Data through, Generated, Last interaction | MetadataList columns multi + MetadataListItem (testids moved onto Text) |
| briefs/brief-view.tsx | `<dl>` facts grid (data-testid brief-facts) | MetadataList columns 2 |
| briefs/brief-view.tsx | `<div role="status">` stale panel (data-testid brief-stale) | Banner status warning with `role="status"`, endContent Button |
| briefs/brief-view.tsx | `<ul><li>` statements (data-testid statement, data-evidence-count) | List + ListItem |
| briefs/brief-view.tsx | `<ol><li>` editable prompts/agenda rows (rounded card + numbered circle) | List listStyle decimal + ListItem (native numbering) |
| briefs/brief-view.tsx | `<ul>` missing information (bullet span) | List listStyle disc + ListItem |
| briefs/brief-view.tsx | two `<section>` cards (rounded border bg-card) | section kept for landmark + Card padding 5 |
| briefs/brief-view.tsx | sticky unsaved-changes bar `<div>` | Card elevation med (sticky via token utilities) + HStack |
| briefs/brief-view.tsx | `<div class="grid ... xl:grid-cols-2">` x2, `space-y-5` x3, flex wrappers | Grid columns minWidth/max, VStack, HStack |
| briefs/brief-view.tsx | `<span>` supporting-records count "(n)" | Badge (count) |
| briefs/brief-view.tsx | `<span>` meta wrappers x4, `<p>` copy | Text |
| briefs/brief-view.tsx | `<span class="mt-1.5 flex">` citations row | HStack |
| briefs/brief-view.tsx | lucide CalendarClock | Icon (lucide component passed in): kept lucide import, no semantic Astryx icon |
| briefs/brief-view.tsx | lucide Check | Icon "check" (semantic), lucide import removed |
| briefs/brief-view.tsx | lucide ClipboardList | Icon (lucide component): kept, no semantic Astryx icon |
| briefs/brief-view.tsx | lucide Database | Icon (lucide component): kept, no semantic Astryx icon |
| briefs/brief-view.tsx | lucide FileText (x2: citation chip, evidence button) | Icon (lucide component) size xsm: kept, no semantic Astryx icon |
| briefs/brief-view.tsx | lucide Pencil | Icon (lucide component): kept, no semantic Astryx icon |
| briefs/brief-view.tsx | lucide Plus | Icon (lucide component): kept, no semantic Astryx icon |
| briefs/brief-view.tsx | lucide Printer | Icon (lucide component): kept, no semantic Astryx icon |
| briefs/brief-view.tsx | lucide RefreshCw | Icon (lucide component): kept, no semantic Astryx icon |
| briefs/brief-view.tsx | lucide Save | Icon (lucide component): kept, no semantic Astryx icon |
| briefs/brief-view.tsx | lucide Trash2 | Icon (lucide component): kept, no semantic Astryx icon |
| briefs/brief-view.tsx | lucide Undo2 | Icon (lucide component): kept, no semantic Astryx icon |
| briefs/brief-view.tsx | `CitationChip`, `SourceFact`, `AiSummary`, `Suggestion` (components/provenance) | kept: app provenance family, outside this area (peer owns it) |
| briefs/brief-view.tsx | `CitationSheet` (ui/sheet based) | kept: out of area; the lead/peer migrates it to Drawer |

### components/briefs/precall-brief-workspace.tsx

| file | old element | Astryx replacement or "kept: reason" |
| --- | --- | --- |
| briefs/precall-brief-workspace.tsx | sonner `toast` (success, error) | `useAppToast()` |
| briefs/precall-brief-workspace.tsx | ui/button search submit (size lg, aria-label Search, icon only) | IconButton type submit size lg label "Search" |
| briefs/precall-brief-workspace.tsx | ui/button "Generate brief" (data-testid brief-generate, w-full) | Button variant primary width 100% `isDisabled` (aria-disabled, as the adapter already did) |
| briefs/precall-brief-workspace.tsx | raw `<button>` HCP pick row (data-testid brief-pick-*) in `<ul>` | List hasDividers + ListItem `onClick`, `isSelected` |
| briefs/precall-brief-workspace.tsx | raw `<button>` "My briefs" row (data-testid my-brief-*, data-accessible, aria-current) | ListItem `onClick`, `isSelected` (aria-current), data attrs forwarded |
| briefs/precall-brief-workspace.tsx | ui/badge stale (data-testid my-brief-stale, custom warning classes) | Badge variant warning |
| briefs/precall-brief-workspace.tsx | `<form role="search" class="flex gap-2">` | HStack as form (native form kept for Enter submit) + StackItem fill |
| briefs/precall-brief-workspace.tsx | TextInput, TextArea, FormLayout (already Astryx) | kept as is |
| briefs/precall-brief-workspace.tsx | generating panel `<div>` card + 3 pulse `<div>` skeletons | Card + Skeleton x3 |
| briefs/precall-brief-workspace.tsx | "My briefs" loading pulse `<div>` | Skeleton |
| briefs/precall-brief-workspace.tsx | brief loading pulse `<div>` (data-testid brief-loading) | Skeleton |
| briefs/precall-brief-workspace.tsx | `<p>` no-match box (data-testid brief-hcp-empty) | EmptyState isCompact |
| briefs/precall-brief-workspace.tsx | placeholder dashed `<div>` (data-testid brief-placeholder) | Card muted + EmptyState |
| briefs/precall-brief-workspace.tsx | denied `<div role="alert">` (data-testid brief-denied) | Card role alert + EmptyState |
| briefs/precall-brief-workspace.tsx | selected-HCP `<div>` box (data-testid brief-selected) | Card variant muted + Text |
| briefs/precall-brief-workspace.tsx | `<section>` cards x2, header `<div>/<h1>/<p>`, `space-y-*` stacks, `<h2>` x2, `<p>` copy | section kept, Card, VStack, HStack, Heading, Text |
| briefs/precall-brief-workspace.tsx | `<div class="grid xl:grid-cols-[minmax(0,24rem)_minmax(0,1fr)]">` + right pane `<div class="max-xl:order-first">` | kept: asymmetric 24rem/1fr two-column workspace that reorders on narrow screens; Astryx Grid only offers equal tracks and has no order control |
| briefs/precall-brief-workspace.tsx | lucide ChevronRight | Icon "chevronRight" (semantic) |
| briefs/precall-brief-workspace.tsx | lucide ClipboardList | Icon (lucide component): kept, no semantic Astryx icon |
| briefs/precall-brief-workspace.tsx | lucide Lock (x3: row, denied) | Icon (lucide component): kept, no semantic Astryx icon |
| briefs/precall-brief-workspace.tsx | lucide Search | Icon "search" (semantic); lucide import removed |
| briefs/precall-brief-workspace.tsx | lucide Sparkles (x4) | Icon (lucide component): kept, no semantic Astryx icon |
| briefs/precall-brief-workspace.tsx | lucide UserRound | Icon (lucide component): kept, no semantic Astryx icon |
| briefs/precall-brief-workspace.tsx | `ErrorState` (components/state) | kept: already the Astryx state family |

### components/briefs/brief-print-document.tsx, format.ts

| file | old element | Astryx replacement or "kept: reason" |
| --- | --- | --- |
| briefs/brief-print-document.tsx | semantic print `<article>/<header>/<section>/<h1>/<h2>/<dl>/<ul>/<ol>` (class brief-print-document, styled by print CSS only) | kept: print-only document; its markup and the global print CSS are the contract, Astryx components add on-screen chrome and would break the print layout |
| briefs/format.ts | none (date formatting) | n/a |

### components/post-call/optional-workspace.tsx

| file | old element | Astryx replacement or "kept: reason" |
| --- | --- | --- |
| post-call/optional-workspace.tsx | ui/badge outline "Optional · production inputs required" | Badge variant warning |
| post-call/optional-workspace.tsx | ui/button "Create review draft" | Button variant primary width 100% |
| post-call/optional-workspace.tsx | ui/button "Confirm draft" | Button variant secondary width 100% |
| post-call/optional-workspace.tsx | ui/button "Confirm task" | Button variant primary width 100% |
| post-call/optional-workspace.tsx | ui/button "Save alert rule" | Button variant primary width 100% |
| post-call/optional-workspace.tsx | ui/card Card + CardHeader/CardTitle/CardDescription/CardContent (post-call-drafts) | Astryx Card padding 5, HStack + Heading level 3 + Text supporting |
| post-call/optional-workspace.tsx | ui/card ... (confirmed-tasks) | same |
| post-call/optional-workspace.tsx | ui/card ... (topic-alerts) | same |
| post-call/optional-workspace.tsx | ui/input + ui/label "Task" (data-testid task-description) | TextInput `label`, same data-testid |
| post-call/optional-workspace.tsx | ui/input type date + ui/label "Due date" | DateInput `label` (value kept as ISO string) |
| post-call/optional-workspace.tsx | ui/input + ui/label "Topic phrase" (data-testid alert-topic) | TextInput `label` |
| post-call/optional-workspace.tsx | ui/input type number + ui/label "Threshold" | NumberInput `label`, min 1 |
| post-call/optional-workspace.tsx | ui/input type number + ui/label "Days" | NumberInput `label`, min 1 max 366 |
| post-call/optional-workspace.tsx | TextArea + FormLayout "Entered notes" (already Astryx) | kept as is |
| post-call/optional-workspace.tsx | `<p role="status">` notice (data-testid post-call-notice) | Banner (success or error) with `role="status"`; messages now carry a status |
| post-call/optional-workspace.tsx | `<ul><li>` draft structured lines | List listStyle disc + ListItem |
| post-call/optional-workspace.tsx | `<ul><li>` confirmed tasks / empty `<li>` | List hasDividers + ListItem / Text |
| post-call/optional-workspace.tsx | `<ul><li>` alert results (warning boxes) | Banner status warning per alert |
| post-call/optional-workspace.tsx | draft `<div class="bg-ai-soft">` | Card variant muted |
| post-call/optional-workspace.tsx | `<section>`, header `<div>`, `grid` wrappers, `<p>`, `<h2>` | VStack as section, HStack, Grid, Text, Heading |
| post-call/optional-workspace.tsx | lucide BellRing | Icon (lucide component): kept, no semantic Astryx icon |
| post-call/optional-workspace.tsx | lucide CheckCircle2 (x3) | Icon (lucide component): kept, no semantic Astryx icon |
| post-call/optional-workspace.tsx | lucide ClipboardCheck | Icon (lucide component): kept, no semantic Astryx icon |
| post-call/optional-workspace.tsx | lucide ListTodo | Icon (lucide component): kept, no semantic Astryx icon |
| post-call/optional-workspace.tsx | lucide Plus | Icon (lucide component): kept, no semantic Astryx icon |
| post-call/optional-workspace.tsx | lucide Sparkles | Icon (lucide component): kept, no semantic Astryx icon |

### components/design/**

| file | old element | Astryx replacement or "kept: reason" |
| --- | --- | --- |
| design/app-patterns.tsx | sonner `toast()` in ProvenanceSection | `useAppToast().info(...)`; text now says "side panel" instead of "side sheet" |
| design/app-patterns.tsx | `<div data-testid="state-family-preview" class="grid xl:grid-cols-2">` | Grid columns minWidth 360 max 2 |
| design/app-patterns.tsx | `<span>` meta | Text type inherit |
| design/app-patterns.tsx | lucide Stethoscope (passed as `icon` to KpiTile) | kept: KpiTile (components/charts, out of area) takes a lucide component and renders it; no semantic Astryx icon |
| design/app-patterns.tsx | recharts/echarts demos (TrendAreaChart, EChart, Heatmap, Timeline...) | kept: no Astryx chart equivalent |
| design/components-in-use.tsx | sonner `toast("Saved and audited")` | `useAppToast`: "Show toast" (success) plus new "Show error toast" demo; snippet in "Show code" updated |
| design/components-in-use.tsx | prose "Transient confirmations use the app Toaster." | now "...use Toast, shown through the app's useAppToast hook." (no "sheet" prose existed here) |
| design/components-in-use.tsx | lucide Inbox | Icon (lucide component) size lg: kept, no semantic Astryx icon |
| design/components-in-use.tsx | lucide Plus (x2: Add draft, New request) | Icon (lucide component): kept, no semantic Astryx icon |
| design/components-in-use.tsx | lucide RefreshCw | Icon (lucide component): kept, no semantic Astryx icon |
| design/components-in-use.tsx | lucide Search (TextInput startIcon) | Icon "search" (semantic string); lucide import removed |
| design/components-in-use.tsx | lucide Settings (IconButton) | Icon "wrench" (semantic: settings/configuration); lucide import removed |
| design/components-in-use.tsx | `<div data-contrast-ok>` around locked Switch | VStack |
| design/components-in-use.tsx | everything else (Button, Card, Table, Tab, Banner, Dialog...) | already Astryx |
| design/guide-section.tsx | `<div class="max-w-3xl">` x2, `<div data-layout-ok data-contrast-ok>` | VStack |
| design/guide-section.tsx | TokenSwatch `<figure>/<div style>` | kept: renders a live token as a colour swatch; needs an inline `var(--token)` value, no Astryx swatch component |
| design/showcase.tsx | root `<div>` flex column, `max-w-3xl` `<div>` | VStack |
| design/showcase.tsx | `<nav>` wrapping TabList | kept: landmark element around Astryx TabList |
| design/foundations.tsx | `<div class="flex ...">` rows x3, `w-28` label `<div>` x3, flex-col radius/shadow `<div>` x2 | HStack / VStack / Text |
| design/foundations.tsx | ThemePreview wrapper `<div style>`, colour strip, card sample, TextSample `<div style>`, `<span style>` demos, motion track, spacing bar, radius box | kept: token demonstrations. They must read live tokens (`var(--color-*)`, `--radius-*`, `--spacing-*`, `--shadow-*`) through inline style so each nested Theme paints itself; Astryx has no component that draws a bare token swatch |
| design/foundations.tsx | lucide / sonner / ui/* | none present |

### lib/appearance/**

| file | old element | Astryx replacement or "kept: reason" |
| --- | --- | --- |
| lib/appearance/appearance-provider.tsx | sonner `toast.error("Couldn't save your appearance...", {id})` | Astryx Toast via `useAppToast()` in a new child component `SaveFailureToast` rendered inside the root `<Theme>` (the provider counts failed saves in state; the child toasts on each increase, same `id` so repeats replace). `useToast` is not called in the component that renders `<Theme>` |
| lib/appearance/appearance-provider.tsx | root `<Theme>` and `<LinkProvider>` | kept: they are Astryx already |
| lib/appearance/astryx-registry.ts, themes.ts, theme-fonts.ts | no UI elements | n/a |

### app routes

| file | old element | Astryx replacement or "kept: reason" |
| --- | --- | --- |
| app/(app)/msl/page.tsx | `<div class="mt-8">` around HcpSearch | VStack paddingBlockStart 8 |
| app/(app)/msl/briefs/page.tsx | none (already Astryx Skeleton in Suspense fallback) | n/a |
| app/(app)/design/page.tsx | none | n/a |

### Counts

Replaced (instances above, excluding "already Astryx" and n/a rows; a row covering several nodes counts once):

- Toasts (sonner -> Astryx Toast via useAppToast): 6 files/sites (brief-view, precall-brief-workspace, app-patterns, components-in-use, appearance-provider; appearance via child component).
- Buttons (ui/button or raw `<button>` -> Button/IconButton/ListItem): brief-view 8 (7 ui/button + 1 raw), precall 4 (2 ui/button + 2 raw -> ListItem), optional-workspace 4.
- Textarea / label: raw `<textarea>` 3 and `<label>` 1 -> TextArea (brief-view).
- Inputs / labels: ui/input 5 + ui/label 5 -> TextInput 2, DateInput 1, NumberInput 2 (optional-workspace).
- Badge: ui/badge 5 -> Astryx Badge (brief-view 4, precall 1) plus optional-workspace 1 = 6.
- Card: ui/card 3 (with their header/title/description/content parts) -> Astryx Card.
- Lists: `<ul>/<ol>/<dl>` -> List/ListItem/MetadataList: 9 sites.
- Banner: 3 (stale panel, post-call notice, topic-alert items).
- Skeleton / EmptyState: 5 skeleton/pulse divs, 3 empty/denied/placeholder boxes.
- lucide icons: every icon now renders through Astryx Icon. Semantic names used: check, chevronRight, search (x3 sites), wrench. Lucide components passed into Icon (kept: no semantic Astryx icon): 29 usages (brief-view 12, precall 5 distinct, optional-workspace 6, components-in-use 3, app-patterns 1 via KpiTile).
- Layout `<div>/<span>/<p>/<h*>` -> VStack/HStack/Grid/Text/Heading: roughly 60 nodes across the area.

Kept (documented): 5 categories.

- 1 asymmetric responsive two-column grid + order-first pane (precall-brief-workspace).
- 1 print document (brief-print-document).
- Token-demonstration divs/spans with inline `var(--token)` styles (foundations, TokenSwatch): about 9 nodes.
- KpiTile lucide `icon` prop, provenance family, CitationSheet, ErrorState (outside the area or already Astryx).
- Recharts/ECharts demos in the design guide (no Astryx chart).

### Modern Web Guidance

Searches run: `npx modern-web-guidance@latest search "forms textarea labels buttons toast status messages"`. Relevant ids returned: `forms`, `persistent-toast-notifications`, `required-field-feedback`, `validate-input-after-interaction`, `accessibility`, `ime-safe-enter-submit`. Applied: every field keeps a programmatic label (Astryx `label`, hidden with `isLabelHidden` where the label was an aria-label before), toast copy stays short and error toasts persist until dismissed, the objective only shows its error state through `status` (already conditional on the existing validity check, unchanged behaviour), search still submits on Enter through a native `<form role="search">`.

Legacy scan (`npx modern-web-guidance@latest legacy-scan <path>`) after editing:

```
src/components/briefs      0 findings from 33 qualified guides.
src/components/post-call   0 findings from 33 qualified guides.
src/components/design      0 findings from 33 qualified guides.
src/lib/appearance         0 findings from 33 qualified guides. (Skipped 2 docs and test files)
src/app/(app)/msl/page.tsx 0 findings from 33 qualified guides.
```

## Admin, shell, state, login (audit)

Area: `components/admin/**`, `components/shell/**`, `components/state/**` (except `use-app-toast.tsx`, the lead's), `app/login/**`,
`app/(app)/admin/**`, `app/(app)/layout.tsx`, `app/(app)/template.tsx`. Paths are relative to `frontend/src`.

Baseline found by grep before editing: these files were already migrated in earlier waves. There was **no** raw `<button>`,
`<select>`, `<textarea>`, `<table>`, `<details>/<summary>`, `<input>`, `<label>`, `<dialog>`, `<hr>`, `title=` tooltip,
hand-rolled disclosure/popover/menu, sonner import or `components/ui/*` import except `ui/badge` (offline-status). Tabs were
already Astryx `TabList`/`Tab`. What remained: 18 lucide-react files rendering icons as bare SVGs, one `ui/badge` import, and about 90
layout `<div>/<span>/<p>/<ul>/<dl>/<strong>` elements.

### Raw interactive / structural elements

| file | old element | Astryx replacement or "kept: reason" |
| --- | --- | --- |
| components/admin/panel-tabs.tsx | `TabList role="tablist"` + `Tab` | already Astryx TabList/Tab (no change) |
| components/admin/panel-tabs.tsx | `<div role="tabpanel">` | `VStack role="tabpanel"` (Astryx has no TabPanel component; the panel stays an ARIA tabpanel, now a stack) |
| components/admin/evals/eval-panel.tsx | `TabList role="tablist"` + `Tab` | already Astryx TabList/Tab (no change) |
| components/admin/evals/eval-panel.tsx | `<div role="tabpanel">` | `VStack role="tabpanel"` (same reason as above) |
| components/admin/evals/eval-panel.tsx | `<section data-testid="run-section">` | `VStack as="section"` |
| components/admin/evals/eval-panel.tsx | `<section data-testid="suite-card">` | `VStack as="section"` |
| components/admin/evals/eval-panel.tsx | 3 flex `<div>` in SuiteCard | `HStack` / `VStack` |
| components/admin/evals/eval-panel.tsx | `<div className="mt-1 max-w-2xl">`, `<div className="mt-2">` | `VStack paddingBlockStart maxWidth` |
| components/admin/evals/eval-panel.tsx | `<div>` x6 (eval-panel root, persona-picker, tabpanel, no-runs, compare-empty, role=note) | `VStack` (testids and roles kept) |
| components/admin/governance-workspace.tsx | `<div className="flex flex-col gap-6 pb-8">` | `VStack gap paddingBlockEnd` |
| components/admin/governance-catalog.tsx | `<div className="grid gap-3 md:grid-cols-2">` | `Grid columns={{minWidth}}` |
| components/admin/governance-catalog.tsx | `<div data-testid>` x3 (definition-catalog, lifecycle-queue, issue-assistant) | `VStack` |
| components/admin/governance-catalog.tsx | `<form className="flex ...">` x2 | `<form>` kept (Astryx FormLayout docs: "`<form>` has no Astryx replacement"); inner layout is now `HStack` |
| components/admin/access-timeline.tsx | `<form>` (scope-change-form) | kept: `<form>` has no Astryx replacement; fields laid out with `VStack` + `Grid` |
| components/admin/access-timeline.tsx | 3 grid/col-span `<div>` | `Grid columns={{minWidth}}`; the "Reason" field is a full-width `TextInput` under the grid |
| components/admin/access-timeline.tsx | `<div data-testid>` x2 (access-timeline, approval-requests) | `VStack` |
| components/admin/access-timeline.tsx | `<span className="break-words">` in Banner description | `Text` |
| components/admin/authorization-verification-grid.tsx | `<div data-testid>` | `VStack` |
| components/admin/hierarchy-view.tsx | `<VStack as="ul">` + `<li>` holders list | Astryx `List` / `ListItem` (density compact) |
| components/admin/hierarchy-view.tsx | `<div className="grid ... lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">` | `Grid columns={{minWidth, max: 2}}` (3:2 split became 1:1; arbitrary track value removed) |
| components/admin/hierarchy-view.tsx | `<div data-testid>` x2 (hierarchy-tree, hierarchy-unreached) | `VStack` |
| components/admin/hierarchy-view.tsx | `<span className="break-all/break-words">` x3 | `Text` |
| components/admin/visibility-matrices.tsx | grid `<div>` | `Grid columns={{minWidth, max: 2}}` |
| components/admin/visibility-matrices.tsx | `<div key>` x2 + `<div className="py-3">` | `VStack` (`paddingBlock`) |
| components/admin/page-header.tsx | `<div className="max-w-3xl">`, `<div>` around ScopeLabel | `Text className="max-w-3xl"`, `HStack` |
| components/admin/section-card.tsx | `<section aria-labelledby>` | kept: named landmark; Astryx has no Section component (body is Card + VStack/HStack/Heading/Text already) |
| components/admin/evals/run-view.tsx | score tile wrappers `<div>` x3 | `VStack` (testids, `data-value` kept) |
| components/admin/evals/run-view.tsx | run-scores `<div>` + 2 grid `<div>` | `VStack` + `Grid columns={{minWidth, max}}` |
| components/admin/evals/run-view.tsx | `<section data-testid="category-strip">`, per-group `<section>` x2, `<section human-ratings-strip>` | `VStack as="section"` |
| components/admin/evals/run-view.tsx | category strip `<ul className="grid ...">` + `<li>` | kept: semantic list of ClickableCards; Astryx `Grid` has no `as`, `List` would wrap cards in rows |
| components/admin/evals/run-view.tsx | `<span className="flex ...">` triggers x4 (category card, result row x2, chain card) | `HStack as="span"` / `VStack as="span"` (spans because they sit inside the Collapsible button) |
| components/admin/evals/run-view.tsx | `<span className="inline-flex ...">` Metric | `HStack as="span"` |
| components/admin/evals/run-view.tsx | `<dl>/<dt>/<dd>` Facts | Astryx `MetadataList columns="multi"` + `MetadataListItem` |
| components/admin/evals/run-view.tsx | `<p>` x4 (expected-text, database says, unverified-sample) | `Text as="p"` |
| components/admin/evals/run-view.tsx | `<strong>` x2 | `Text weight="bold"` |
| components/admin/evals/run-view.tsx | `<span className="font-mono text-sm">`, `<span className="tabular-nums">` | `Text type="code"`, `Text hasTabularNumbers` |
| components/admin/evals/run-view.tsx | `<ul data-testid result-reasons / visual-notes / run-failure-reasons>`, `<ol chain-turns>`, 2 group `<ul>` | `VStack as="ul"/"ol"` (still direct `<li>` children: `e2e/evals.spec.ts` asserts `locator("> li")` count 12) |
| components/admin/evals/run-view.tsx | `<li>` Card rows (ResultRow, ChainCard, banner rows, notes) | kept: list items of Card/Collapsible rows; e2e depends on `li` children and data-testids |
| components/admin/evals/run-view.tsx | `<div>` x10 (question/answer blocks, run-progress, run-error, RunBody, Skeleton wrappers, self-test badge wrapper `<span>`, `max-w-3xl`) | `VStack` / `HStack` / `Text` |
| components/admin/evals/run-view.tsx | `Collapsible` (x2), `ClickableCard`, `Banner`, `ProgressBar`, `CodeBlock`, `Badge`, `Button` | already Astryx |
| components/admin/evals/history-compare.tsx | `<div data-testid>` x4 (history-empty, run-history, suite-changed, compare-picker grid) | `VStack` / `Grid` |
| components/admin/evals/history-compare.tsx | `<section aria-label>`, `<div className="mt-2">` | `VStack as="section"`, `VStack paddingBlockStart` |
| components/admin/evals/history-compare.tsx | `<p data-testid="diff-counts" className="flex ...">` | `HStack` |
| components/admin/evals/history-compare.tsx | `<span>` x4 (history cell, DiffRow trigger x2, metric label) | `VStack as="span"`, `HStack as="span"`, `Text` |
| components/admin/evals/history-compare.tsx | DiffRow body grid `<div>`, per-side `<div>` | `Grid` + `VStack` |
| components/admin/evals/history-compare.tsx | `<ul>` x3, `<li>` DiffRow | `<ul>`s are `VStack as="ul"`; `<li>` kept (Card + Collapsible row) |
| components/admin/evals/history-compare.tsx | `Table` x2, `Selector` x2, `Button`, `Collapsible`, `EmptyState`, `Banner` | already Astryx |
| components/admin/evals/ratings-panel.tsx | `<dl>/<dt>/<dd>` stat tiles | `Grid` of `Card` > `VStack` > `Text`/`Heading` |
| components/admin/evals/ratings-panel.tsx | `<ul>` + `<li>` rating items | `<ul>` is `VStack as="ul"`; `<li>` kept (testid `rating-item`) |
| components/admin/evals/ratings-panel.tsx | `<div>` x3, `<p>` x2, `<strong>` x2, `<span>` | `HStack`, `VStack`, `Text` |
| components/admin/evals/verdict.tsx | `<span className="inline-flex">` x3 | `HStack as="span"` (testids kept) |
| components/shell/app-shell.tsx | `<div className="safe-px safe-pb py-6 lg:py-8"><div className="mx-auto w-full max-w-[84rem]">` | kept: page-frame wrappers inside the Astryx AppShell. Changing block to flex-column changes how wide children overflow, and `responsive.spec.ts` depends on it. Not touched (shell must stay selector-safe). Note `max-w-[84rem]` is an arbitrary value from an earlier wave. |
| components/shell/scope-label.tsx | root `<span>` pill | kept: inline-flex pill used by 8 callers (landing, chat, activity, director, executive). The inner two spans are now `Text`. |
| components/shell/role-gate.tsx | `<div animate-pulse bg-muted>` loading placeholder | `Skeleton` |
| components/shell/theme-picker.tsx | (audit) | already Astryx `Selector` + `SegmentedControl` + `Text` + `VStack` |
| components/shell/appearance-settings.tsx | (audit) | already Astryx `Popover` + `IconButton` |
| components/shell/persona-switcher.tsx | (audit) | already Astryx `Popover` + `List`/`ListItem` + `Banner` + `Button` |
| components/shell/seeded-logins.tsx | (audit) | already Astryx (`List`, `Banner`, `VStack as="section"`) |
| components/shell/offline-status.tsx | `Badge` from `@/components/ui/badge` (variant outline) | Astryx `Badge` (`@astryxdesign/core/Badge`): `variant="warning"` (Offline), `variant="neutral"` (Syncing), `label` + `icon` |
| components/state/first-run-orientation.tsx | `<div className="mb-[var(--page-gap)]">` | `VStack paddingBlockEnd` |
| components/state/states.tsx | `<section data-testid role>` | `VStack as="section"` (role stays status/alert) |
| components/state/states.tsx | `Card`, `EmptyState`, `Skeleton`, `Button`, `Text` | already Astryx |
| components/state/state-actions.tsx | (audit) | already Astryx `Button` (`as={NextLink}`) |
| app/login/page.tsx | `<form method="post">` | kept: `<form>` has no Astryx replacement (autofill form, MWG autofill-sign-in-form); fields are Astryx `TextInput`, `Button`, `VStack` |
| app/login/page.tsx | `<div className="flex min-h-dvh flex-col ...">`, `<header>`, `<main>` | `VStack`, `HStack as="header"`, `HStack as="main" id="main"` |
| app/(app)/template.tsx | `<div className="page-in">` | kept: a plain CSS-animation wrapper (`page-in` enter animation); no Astryx equivalent |
| app/(app)/layout.tsx | (audit) | renders `AppShell` only |
| app/(app)/admin/page.tsx, governance/page.tsx, evals/page.tsx | (audit) | server pages that only mount `RoleGate` and the workspace components; no raw elements |

### lucide-react icons

Rendered through Astryx `Icon` in every place (directly, or by passing the lucide component to an Astryx component's `icon` prop,
which renders through `Icon`). Semantic name used where Astryx has one.

| file | lucide icon | Icon "name" / kept |
| --- | --- | --- |
| components/admin/access-timeline.tsx | Check | `<Icon icon="check" />` |
| components/admin/access-timeline.tsx | X | `<Icon icon="close" />` |
| components/admin/access-timeline.tsx | ArrowRightLeft, CalendarClock, History | kept: no semantic Astryx icon; `SectionCard` `icon` prop (now typed `IconProps["icon"]`, rendered through `Icon`) |
| components/admin/authorization-verification-grid.tsx | CheckCircle2 (passed badge) | `<Icon icon="success" size="xsm" />` |
| components/admin/authorization-verification-grid.tsx | ShieldCheck | kept: no semantic Astryx icon; `SectionCard` icon |
| components/admin/governance-catalog.tsx | CheckCircle2 ("Approve version") | `<Icon icon="check" />` |
| components/admin/governance-catalog.tsx | Plus x2 | kept: no semantic Astryx icon; `<Icon icon={Plus} />` |
| components/admin/governance-catalog.tsx | GitCompareArrows, ShieldCheck (Banner icons) | kept: no semantic Astryx icon; `<Icon icon={...} size="md" />` |
| components/admin/governance-catalog.tsx | ClipboardList, Bot | kept: no semantic Astryx icon; `SectionCard` icon |
| components/admin/hierarchy-view.tsx | Network, GitBranch | kept: no semantic Astryx icon; `SectionCard` icon |
| components/admin/visibility-matrices.tsx | BookOpen, FileLock2 | kept: no semantic Astryx icon; `SectionCard` icon |
| components/admin/evals/eval-panel.tsx | Play, ShieldCheck | kept: no semantic Astryx icon; `<Icon icon={...} />` in Button |
| components/admin/evals/run-view.tsx | Link2 | kept: no semantic Astryx icon; `<Icon icon={Link2} />` in Button |
| components/admin/evals/run-view.tsx | ShieldCheck (self-test badge) | kept: no semantic Astryx icon; `<Icon icon={ShieldCheck} size="xsm" />` |
| components/admin/evals/history-compare.tsx | ArrowRight (between badges) | kept: no semantic Astryx icon; `<Icon icon={ArrowRight} size="sm" color="secondary" />` |
| components/admin/evals/history-compare.tsx | ArrowRight / ArrowUpRight / ArrowDownRight (delta badge) | kept: no semantic Astryx icon (Astryx arrowUp/arrowDown are straight arrows, the diagonal "better/worse" glyphs are different); `<Icon icon={Glyph} size="xsm" />` |
| components/admin/evals/ratings-panel.tsx | ThumbsUp, ThumbsDown | kept: no semantic Astryx icon; `<Icon icon={Glyph} size="xsm" />` |
| components/admin/evals/verdict.tsx | CircleCheck | `<Icon icon="success" size="xsm" />` |
| components/admin/evals/verdict.tsx | CircleX | `<Icon icon="error" size="xsm" />` |
| components/admin/evals/verdict.tsx | ShieldAlert (leak) | kept: no semantic Astryx icon; `<Icon icon={ShieldAlert} size="xsm" />` |
| components/shell/app-shell.tsx | LogOut | kept: no semantic Astryx icon; `<Icon icon={LogOut} />` in IconButton |
| components/shell/appearance-settings.tsx | Palette | kept: no semantic Astryx icon; `<Icon icon={Palette} />` in IconButton |
| components/shell/persona-switcher.tsx | Check (active persona) | `<Icon icon="check" size="sm" />` |
| components/shell/persona-switcher.tsx | UserRound | kept: no semantic Astryx icon; `<Icon icon={UserRound} />` in Button |
| components/shell/offline-status.tsx | CloudOff, CloudUpload | kept: no semantic Astryx icon; `<Icon icon={...} size="xsm" />` in Badge |
| components/shell/scope-label.tsx | ShieldCheck | kept: no semantic Astryx icon; `<Icon icon={ShieldCheck} size="sm" />` |
| components/shell/persona-config.ts | Map, Activity, ClipboardList, BarChart3, MessagesSquare, Users, LayoutDashboard, Sparkles, FileSearch, FlaskConical, Network, ShieldCheck + `LucideIcon` type | kept: no semantic Astryx icons; these are nav entries passed to Astryx `SideNavItem` `icon` (renders through Astryx Icon) |
| components/state/states.tsx | TriangleAlert | `"warning"` (error state icon, via `Icon icon="warning"`) |
| components/state/states.tsx | CalendarSearch, LockKeyhole, Sparkles | kept: no semantic Astryx icon; `Icon` with the lucide component |
| components/state/state-actions.tsx | CalendarSearch, RefreshCw, LockKeyhole | kept: no semantic Astryx icon; `<Icon icon={...} />` in Button |
| app/login/page.tsx | LogIn | kept: no semantic Astryx icon; `<Icon icon={LogIn} />` in Button |

### Counts

- Replaced with Astryx components (layout/structure): roughly 90 raw `div`/`span`/`section`/`ul`/`ol`/`dl`/`p`/`strong`/`header`/`main` elements across 17 files became VStack/HStack/Grid/Text/List/MetadataList/Skeleton (see rows above); `ui/badge` -> Astryx Badge (2 uses in offline-status).
- Already Astryx before this pass (audited, unchanged): TabList/Tab x2, Selector, SegmentedControl, Popover, Table x3, Collapsible x2, AlertDialog, Banner, Button/IconButton, List/ListItem, TreeList, EmptyState, TextInput/DateTimeInput, MetadataList (hierarchy).
- lucide icons: 19 lucide-import files in the area. 8 icon usages moved to semantic names (check x3, close, success x2, error, warning); the other lucide components are kept (no semantic Astryx name) and rendered through Astryx `Icon`.
- Kept (documented above): 4 `<form>` (no Astryx replacement), 1 `<section>` in SectionCard, `<li>`/`<ul>` of Card rows (e2e `> li`), category-strip `<ul>` grid, 2 page-frame `<div>` in app-shell, ScopeLabel root pill, `template.tsx` animation `<div>`, tabpanel (no Astryx TabPanel component, now `VStack role="tabpanel"`).
- Not present in this area (nothing to migrate): raw `<button>`, `<select>`, `<textarea>`, `<table>`, `<details>`, `<input>`, `<label>`, `<dialog>`, `<hr>`, `title=` tooltips, sonner, ui/sheet, ui/label, ui/chart, ui/card, ui/input.

Test / selector notes: no unit tests changed (30 files, 255 tests pass). `e2e/evals.spec.ts` keeps the `> li` direct-children contract of `chain-turns-*`;
`admin-governance.spec.ts` asserts "Dana Whitfield primary via REGION-NE" inside `hierarchy-detail`, which is now one `ListItem` label (same text). The lead should
run `evals`, `admin-governance`, `offline`, `smoke`, `responsive` and `appearance` e2e specs.

### Modern Web Guidance

`npx modern-web-guidance@latest legacy-scan` on each touched dir (admin, shell, state, app/login, app/(app)/admin):

```
Modern Web Guidance Analyzer — src/components/admin
0 findings from 33 qualified guides.
Modern Web Guidance Analyzer — src/components/shell
0 findings from 33 qualified guides.
Modern Web Guidance Analyzer — src/components/state
0 findings from 33 qualified guides.
Modern Web Guidance Analyzer — src/app/login
0 findings from 33 qualified guides.
Modern Web Guidance Analyzer — src/app/(app)/admin
0 findings from 33 qualified guides.
```

`search "tabs tab panel disclosure"` returned `tabs` ("Build a responsive tabbed interface ... when not all tabs fit"), `html` (native Dialog/Popover/Details) and
`accessibility`. Existing code already follows them: Astryx `TabList role="tablist"` with `overflow="scroll"` and `panelId` pointing at one labelled `tabpanel`;
overlays are Astryx Popover/AlertDialog; disclosures are Astryx Collapsible.

