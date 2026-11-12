# Astryx inventory: director, executive, charts, map, insights, landing, motion, brand

One row per component instance in these areas: file, the old element, and either the Astryx replacement or `kept: <reason>`.
Chart drawing (ECharts, Recharts, WebGL bar field, 3D globe, map SVG) has no Astryx equivalent and stays. The shared
`components/ui/{sheet,chart,label,sonner}` wrappers and their import sites are owned by a parallel migration and are recorded as kept here.
Lucide glyphs without a semantic Astryx name are now rendered through Astryx `Icon` (`<Icon icon={Glyph} />`).

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

