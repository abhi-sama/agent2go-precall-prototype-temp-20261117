import type { BriefExport, BriefStatement } from "@/lib/data/types"
import { formatBriefDay, formatBriefTime } from "./format"

function StatementSection({ title, items }: { title: string; items: BriefStatement[] }) {
  if (items.length === 0) return null
  return (
    <section>
      <h2>{title}</h2>
      <ul>
        {items.map((item) => <li key={item.statementId}>{item.text}</li>)}
      </ul>
    </section>
  )
}

/**
 * This document stays out of the interactive view and is the only thing exposed by print CSS.
 * Its data is the fresh snapshot returned by `exportBrief`, after access was checked and audited.
 */
export function BriefPrintDocument({ brief }: { brief: BriefExport }) {
  const dateRange = brief.dateRangeFrom && brief.dateRangeTo
    ? `${formatBriefDay(brief.dateRangeFrom)} – ${formatBriefDay(brief.dateRangeTo)}`
    : "No dated supporting records"

  return (
    <article className="brief-print-document" data-testid="brief-print-document">
      <header>
        <h1>{brief.hcpName}</h1>
        <dl>
          <div><dt>Scope</dt><dd>{brief.scopeLabel}</dd></div>
          <div><dt>Record date range</dt><dd>{dateRange}</dd></div>
          <div><dt>Data through</dt><dd>{formatBriefTime(brief.dataThrough)}</dd></div>
          <div><dt>Generated</dt><dd>{formatBriefTime(brief.generatedAt)}</dd></div>
          <div><dt>Exported</dt><dd>{formatBriefTime(brief.exportedAt)}</dd></div>
        </dl>
      </header>

      <section>
        <h2>Call objective</h2>
        <p>{brief.objective}</p>
      </section>

      {brief.facts.length > 0 && (
        <section>
          <h2>Counted from source records</h2>
          <dl className="brief-print-facts">
            {brief.facts.map((fact) => <div key={fact.label}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>)}
          </dl>
        </section>
      )}

      <StatementSection title="Previous engagement" items={brief.engagement} />
      <StatementSection title="Recorded perspectives" items={brief.perspectives} />
      <StatementSection title="Possible follow-ups" items={brief.followUps} />

      {brief.prompts.length > 0 && (
        <section>
          <h2>Discussion prompts</h2>
          <ol>{brief.prompts.map((item) => <li key={item.itemId}>{item.text}</li>)}</ol>
        </section>
      )}
      {brief.agenda.length > 0 && (
        <section>
          <h2>Suggested agenda</h2>
          <ol>{brief.agenda.map((item) => <li key={item.itemId}>{item.text}{item.detail ? ` — ${item.detail}` : ""}</li>)}</ol>
        </section>
      )}

      {brief.missing.length > 0 && (
        <section>
          <h2>Information to confirm</h2>
          <ul>{brief.missing.map((item) => <li key={item.code}>{item.message}</li>)}</ul>
        </section>
      )}

      <section>
        <h2>Source citations</h2>
        <ol>
          {brief.citations.map((citation) => (
            <li key={citation.evidenceId}>{citation.label} · {formatBriefDay(citation.date)} · record {citation.recordId}</li>
          ))}
        </ol>
      </section>
    </article>
  )
}
