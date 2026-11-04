import type { LeadershipFigure, LeadershipSummaryExport } from "@/lib/data/executive-themes"
import { formatInstant } from "@/lib/dates"

const SECTIONS: { key: string; title: string }[] = [
  { key: "overview", title: "Overview" },
  { key: "themes", title: "Leading themes" },
  { key: "crossRegion", title: "Topics across regions" },
]

function figureText(f: LeadershipFigure) {
  return f.value.suppressed || f.value.value === null ? "Withheld (small group)" : f.value.value.toLocaleString("en-US")
}

/**
 * The document body shared by the on-screen export preview and the print-only copy. It is built only from the snapshot
 * `exportLeadershipSummary` returned after access was re-checked and audited. Aggregate figures only: a withheld count
 * stays withheld here too.
 */
export function LeadershipDocumentBody({ doc }: { doc: LeadershipSummaryExport }) {
  const number = new Map(doc.citations.map((c, i) => [c.citationId, i + 1]))
  const others = doc.statements.filter((s) => !SECTIONS.some((x) => x.key === s.section))
  return (
    <>
      <header>
        <h1>{doc.title}</h1>
        <dl>
          <div><dt>Scope</dt><dd>{doc.scopeLabel}</dd></div>
          <div><dt>Date range</dt><dd>{doc.from} to {doc.to}</dd></div>
          <div><dt>Data through</dt><dd>{doc.dataThrough ? formatInstant(doc.dataThrough) : "Not available"}</dd></div>
          <div><dt>Generated</dt><dd>{formatInstant(doc.generatedAt)}</dd></div>
          <div><dt>Exported</dt><dd>{formatInstant(doc.exportedAt)}</dd></div>
          <div><dt>Access level</dt><dd>{doc.accessLevel === "AGGREGATE_ONLY" ? "Aggregate only" : "Record-level permission"}</dd></div>
          <div><dt>Metric definitions</dt><dd>{doc.definitionVersion}</dd></div>
        </dl>
      </header>

      {doc.keyFigures.length > 0 && (
        <section>
          <h2>Counted from source records</h2>
          <dl className="brief-print-facts">
            {doc.keyFigures.map((f) => <div key={f.label}><dt>{f.label}</dt><dd>{figureText(f)}</dd></div>)}
          </dl>
        </section>
      )}

      {[...SECTIONS, ...(others.length ? [{ key: "__other", title: "Other findings" }] : [])].map(({ key, title }) => {
        const items = key === "__other" ? others : doc.statements.filter((s) => s.section === key)
        if (items.length === 0) return null
        return (
          <section key={key}>
            <h2>{title}</h2>
            <ul>
              {items.map((s) => (
                <li key={s.statementId}>
                  {s.text}{" "}
                  {s.citationIds.map((id) => number.get(id)).filter(Boolean).map((n) => `[${n}]`).join(" ")}
                </li>
              ))}
            </ul>
          </section>
        )
      })}

      <section>
        <h2>Sample limitations</h2>
        <ul>{doc.sampleLimitations.map((l) => <li key={l}>{l}</li>)}</ul>
      </section>

      <section>
        <h2>Metric definitions</h2>
        <ul>{doc.definitions.map((d) => <li key={d.key}><strong>{d.label}.</strong> {d.text}</li>)}</ul>
      </section>

      <section>
        <h2>Disclosure</h2>
        <p>{doc.disclosureText}</p>
      </section>

      <section>
        <h2>Source citations</h2>
        <ol>
          {doc.citations.map((c) => (
            <li key={c.citationId}>
              {c.label}
              {c.kind === "RECORD" && c.recordId ? ` · record ${c.recordId}` : " · aggregate source"}
            </li>
          ))}
        </ol>
      </section>
    </>
  )
}

/** Hidden on screen, the only thing printed (see `.brief-print-document` in globals.css). */
export function LeadershipPrintDocument({ doc }: { doc: LeadershipSummaryExport }) {
  return (
    <article className="brief-print-document" data-testid="leadership-print-document">
      <LeadershipDocumentBody doc={doc} />
    </article>
  )
}
