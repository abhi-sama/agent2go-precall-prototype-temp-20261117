import { citationNumber, citationsForFact, type AssistantTurn, type CitationItem } from "./events"

/** The in-page link a citation marker uses; the chat's markdown renderer turns it into a button that opens the record. */
export const CITATION_HREF = /^#a2g-cite-(\d{1,3})$/
const citationHref = (n: number) => `#a2g-cite-${n}`

/** The citations a sentence needs: the records behind the figures it repeats, or every record for a qualitative one. */
function citationsFor(sentence: string, turn: Pick<AssistantTurn, "facts" | "citations">): CitationItem[] {
  const facts = turn.facts.filter((fact) => sentence.includes(fact.value.toLocaleString("en-US")) || sentence.includes(String(fact.value)))
  const evidence = facts.length > 0 ? facts.flatMap((fact) => citationsForFact(fact, turn.citations)) : turn.citations
  return evidence.filter((c, i) => evidence.findIndex((x) => x.dataset === c.dataset && x.recordId === c.recordId) === i)
}

/**
 * The answer text as the chat shows it: each sentence followed by numbered markers for the records behind it, so every
 * deterministic claim sits next to its evidence (the same rule the panel always kept). The "Sample limitations"
 * paragraph is left out when the answer shows those limitations in their own labelled block.
 */
export function citeAnswer(text: string, turn: Pick<AssistantTurn, "facts" | "citations" | "sampleLimitations">): string {
  const paragraphs = text.split(/\n{2,}/).filter((p) => p && !(turn.sampleLimitations.length > 0 && /^sample limitations\b/i.test(p.trim())))
  if (turn.citations.length === 0) return paragraphs.join("\n\n")
  return paragraphs
    .map((paragraph) => {
      // Code and tables are left as written: a marker would land inside them.
      if (/^\s*(```|\|)/m.test(paragraph)) return paragraph
      return paragraph
        .split(/(?<=[.!?])[ \t]+/)
        .map((sentence) => {
          const markers = citationsFor(sentence, turn)
            .map((c) => citationNumber(turn.citations, c))
            .filter((n) => n > 0)
            .map((n) => `[${n}](${citationHref(n)})`)
          return markers.length ? `${sentence} ${markers.join(" ")}` : sentence
        })
        .join(" ")
    })
    .join("\n\n")
}

/** The citation a markdown link stands for: only this answer's own `#a2g-cite-<n>` links; anything else is no link. */
export function citationAt(href: string | undefined, citations: readonly CitationItem[]): CitationItem | undefined {
  const match = href ? CITATION_HREF.exec(href) : null
  return match ? citations[Number(match[1]) - 1] : undefined
}

/**
 * Streamdown options for model-written answer text. No rehype plugins means no `rehype-raw`, so raw HTML in the text is
 * dropped rather than parsed (there is nothing to sanitise); links and images are replaced by the renderer.
 */
export const ANSWER_MARKDOWN = { rehypePlugins: [] as [] }
