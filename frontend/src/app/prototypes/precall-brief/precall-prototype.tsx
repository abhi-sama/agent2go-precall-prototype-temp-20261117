"use client"

import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { brief, evidence, type Evidence } from "./data"

const variants = ["Signal Map", "Field Dossier", "Evidence Mosaic"] as const

type VariantIndex = 0 | 1 | 2

function SourceButton({ source, onOpen }: { source: Evidence; onOpen: (source: Evidence) => void }) {
  return (
    <button className="source-button" type="button" onClick={() => onOpen(source)}>
      <span className="source-pulse" aria-hidden="true" />
      {source.short}
    </button>
  )
}

function PrintButton() {
  return <button className="print-button" type="button" onClick={() => window.print()}>Print / save PDF</button>
}

function EvidencePanel({ source, onClose }: { source: Evidence | null; onClose: () => void }) {
  if (!source) return null
  return (
    <aside className="evidence-panel" aria-label="Source record" aria-live="polite">
      <div className="evidence-panel-topline">
        <span>Verified source</span>
        <button type="button" onClick={onClose} aria-label="Close source preview">Close</button>
      </div>
      <h2>{source.label}</h2>
      <p>{source.excerpt}</p>
      <dl>
        <div><dt>Dataset</dt><dd>{source.dataset}</dd></div>
        <div><dt>Record</dt><dd>{source.recordId}</dd></div>
        <div><dt>Date</dt><dd>{source.date}</dd></div>
        <div><dt>Access</dt><dd>Authorized scope</dd></div>
      </dl>
    </aside>
  )
}

function SignalMap({ replayKey }: { replayKey: number }) {
  const [source, setSource] = useState<Evidence | null>(null)
  const [checked, setChecked] = useState([true, false, false])

  return (
    <div className="signal-world" key={replayKey}>
      <a className="skip-link" href="#signal-main">Skip to brief</a>
      <header className="signal-header">
        <div className="signal-brand"><span aria-hidden="true">M</span><strong>Meridian</strong></div>
        <div className="signal-brief-state"><span className="live-dot" aria-hidden="true" /> Brief ready · data through {brief.dataThrough}</div>
        <PrintButton />
      </header>
      <main id="signal-main" className="signal-layout">
        <aside className="signal-profile">
          <p className="profile-time">{brief.meeting}</p>
          <h1>{brief.hcp}</h1>
          <p>{brief.specialty}<br />{brief.institution}</p>
          <div className="signal-profile-rule" />
          <dl className="profile-meta">
            <div><dt>Where</dt><dd>{brief.location}</dd></div>
            <div><dt>Scope</dt><dd>{brief.territory}</dd></div>
          </dl>
          <div className="readiness-block">
            <div className="readiness-head"><span>Ready check</span><strong>{checked.filter(Boolean).length}/3</strong></div>
            {[
              "Objective reviewed",
              "Sources inspected",
              "Follow-up selected",
            ].map((label, index) => (
              <label key={label}>
                <input
                  type="checkbox"
                  checked={checked[index]}
                  onChange={() => setChecked((current) => current.map((item, itemIndex) => itemIndex === index ? !item : item))}
                />
                <span>{label}</span>
              </label>
            ))}
          </div>
        </aside>

        <section className="signal-route" aria-labelledby="signal-objective">
          <div className="objective-lockup">
            <p>Walk-in objective</p>
            <h2 id="signal-objective">{brief.objective}</h2>
          </div>

          <div className="route-map" aria-label="Evidence route from prior engagement to next action">
            <div className="route-line route-line-a" aria-hidden="true" />
            <div className="route-line route-line-b" aria-hidden="true" />
            <article className="route-stop stop-history">
              <span className="stop-marker" aria-hidden="true" />
              <p>Prior exchange</p>
              <h3>Long-term outcomes moved to the center of the conversation.</h3>
              <SourceButton source={evidence[0]} onOpen={setSource} />
            </article>
            <article className="route-stop stop-signal">
              <span className="stop-marker" aria-hidden="true" />
              <p>Strongest signal</p>
              <h3>Efficacy evidence is the clearest unresolved need.</h3>
              <SourceButton source={evidence[1]} onOpen={setSource} />
            </article>
            <article className="route-stop stop-friction">
              <span className="stop-marker" aria-hidden="true" />
              <p>Known friction</p>
              <h3>Access criteria may still reshape the treatment pathway.</h3>
              <SourceButton source={evidence[2]} onOpen={setSource} />
            </article>
            <article className="route-stop stop-destination">
              <span className="stop-marker" aria-hidden="true" />
              <p>Best next move</p>
              <h3>{brief.nextBestAction}</h3>
              <SourceButton source={evidence[3]} onOpen={setSource} />
            </article>
          </div>
        </section>

        <aside className="signal-cues">
          <div className="cue-heading"><span>In-room cues</span><strong>03</strong></div>
          <ol>
            {brief.prompts.map((prompt, index) => (
              <li key={prompt}><span>{String(index + 1).padStart(2, "0")}</span><p>{prompt}</p></li>
            ))}
          </ol>
          <details className="signal-watchouts">
            <summary>What to confirm</summary>
            <ul>{brief.watchouts.map((item) => <li key={item}>{item}</li>)}</ul>
          </details>
        </aside>
      </main>
      <EvidencePanel source={source} onClose={() => setSource(null)} />
      <footer className="signal-footer"><span>Illustrative prototype · not real HCP data</span><span>AI synthesis · every claim links to evidence</span></footer>
    </div>
  )
}

function FieldDossier({ replayKey }: { replayKey: number }) {
  const [source, setSource] = useState<Evidence | null>(null)
  const [copied, setCopied] = useState(false)

  async function copyAgenda() {
    await navigator.clipboard.writeText(brief.agenda.map(([time, title, detail]) => `${time} — ${title}: ${detail}`).join("\n"))
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1800)
  }

  return (
    <div className="dossier-world" key={replayKey}>
      <a className="skip-link" href="#dossier-main">Skip to brief</a>
      <header className="dossier-header">
        <a href="#dossier-main" className="dossier-wordmark">FIELD / 01</a>
        <nav aria-label="Brief sections">
          <a href="#dossier-readout">Readout</a>
          <a href="#dossier-agenda">Agenda</a>
          <a href="#dossier-risks">Gaps</a>
        </nav>
        <PrintButton />
      </header>
      <main id="dossier-main" className="dossier-page">
        <header className="dossier-masthead">
          <div className="dossier-date">
            <span>Meeting</span>
            <strong>18</strong>
            <span>Nov · 10:30</span>
          </div>
          <div className="dossier-person">
            <p>{brief.specialty} · {brief.territory}</p>
            <h1>{brief.hcp}</h1>
            <p className="dossier-institution">{brief.institution}</p>
          </div>
          <div className="dossier-stamp">
            <span>Prepared</span>
            <strong>FOR SCIENTIFIC EXCHANGE</strong>
            <span>Illustrative data</span>
          </div>
        </header>

        <section className="dossier-objective">
          <h2>Enter the room knowing what remains unresolved.</h2>
          <p>{brief.objective}</p>
        </section>

        <section id="dossier-readout" className="dossier-readout">
          <div className="readout-number">90<small>sec</small></div>
          <div className="readout-copy">
            <h2>The executive readout</h2>
            <p>{brief.nextBestAction}</p>
            <div className="dossier-sources">
              <SourceButton source={evidence[0]} onOpen={setSource} />
              <SourceButton source={evidence[1]} onOpen={setSource} />
              <SourceButton source={evidence[2]} onOpen={setSource} />
            </div>
          </div>
          <dl className="readout-facts">
            {brief.facts.map(([value, label]) => <div key={label}><dt>{value}</dt><dd>{label}</dd></div>)}
          </dl>
        </section>

        <div className="dossier-columns">
          <section className="dossier-column">
            <h2>What the record says</h2>
            {brief.perspectives.map((item, index) => (
              <article className="dossier-note" key={item}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <p>{item}</p>
                <SourceButton source={evidence[Math.min(index + 1, 3)]} onOpen={setSource} />
              </article>
            ))}
          </section>
          <section className="dossier-column dossier-questions">
            <h2>Questions that move the exchange</h2>
            <ol>{brief.prompts.map((prompt) => <li key={prompt}>{prompt}</li>)}</ol>
          </section>
        </div>

        <section id="dossier-agenda" className="dossier-agenda">
          <div className="dossier-section-title">
            <h2>A 30-minute conversation, composed</h2>
            <button type="button" onClick={copyAgenda}>{copied ? "Agenda copied" : "Copy agenda"}</button>
          </div>
          <ol>
            {brief.agenda.map(([time, title, detail]) => (
              <li key={title}><time>{time}</time><strong>{title}</strong><p>{detail}</p></li>
            ))}
          </ol>
        </section>

        <section id="dossier-risks" className="dossier-gaps">
          <h2>What the brief cannot tell you</h2>
          <ul>{brief.watchouts.map((item) => <li key={item}>{item}</li>)}</ul>
        </section>
      </main>
      <EvidencePanel source={source} onClose={() => setSource(null)} />
      <footer className="dossier-footer"><span>Generated {brief.generated}</span><span>Authorized sources only · not real HCP data</span></footer>
    </div>
  )
}

function EvidenceMosaic({ replayKey }: { replayKey: number }) {
  const [source, setSource] = useState<Evidence | null>(evidence[0])
  const [mode, setMode] = useState<"scan" | "deep">("scan")

  return (
    <div className="mosaic-world" key={replayKey}>
      <a className="skip-link" href="#mosaic-main">Skip to brief</a>
      <header className="mosaic-header">
        <div className="mosaic-brand"><span>MSL</span><strong>PRECALL</strong></div>
        <div className="mosaic-status"><i aria-hidden="true" /> Authorized · {brief.territory}</div>
        <div className="mosaic-actions">
          <div className="mode-switch" aria-label="Brief density">
            <button type="button" aria-pressed={mode === "scan"} onClick={() => setMode("scan")}>Scan</button>
            <button type="button" aria-pressed={mode === "deep"} onClick={() => setMode("deep")}>Deep</button>
          </div>
          <PrintButton />
        </div>
      </header>
      <main id="mosaic-main" className={`mosaic-grid ${mode === "deep" ? "is-deep" : ""}`}>
        <section className="mosaic-identity">
          <div>
            <p>{brief.meeting} · {brief.location}</p>
            <h1>{brief.hcp}</h1>
            <p>{brief.specialty} / {brief.institution}</p>
          </div>
          <div className="identity-index">HCP<br /><strong>042</strong></div>
        </section>

        <section className="mosaic-objective">
          <h2>Objective</h2>
          <p>{brief.objective}</p>
        </section>

        <section className="mosaic-primary">
          <div className="module-label"><span>Primary signal</span><strong>HIGH</strong></div>
          <h2>Long-term efficacy is the unresolved center of gravity.</h2>
          <p>{brief.nextBestAction}</p>
          <SourceButton source={evidence[1]} onOpen={setSource} />
        </section>

        <section className="mosaic-stats" aria-label="Engagement summary">
          {brief.facts.map(([value, label]) => <div key={label}><strong>{value}</strong><span>{label}</span></div>)}
        </section>

        <section className="mosaic-history">
          <div className="module-label"><span>Previous exchange</span><strong>2 RECORDS</strong></div>
          {brief.engagement.map((item, index) => (
            <article key={item}><time>{index === 0 ? "30 OCT" : "15 AUG"}</time><p>{item}</p><SourceButton source={evidence[index === 0 ? 0 : 2]} onOpen={setSource} /></article>
          ))}
        </section>

        <section className="mosaic-prompts">
          <div className="module-label"><span>Conversation prompts</span><strong>EDITABLE</strong></div>
          <ol>{brief.prompts.map((prompt, index) => <li key={prompt}><span>Q{index + 1}</span><p>{prompt}</p></li>)}</ol>
        </section>

        <section className="mosaic-agenda">
          <div className="module-label"><span>Run of conversation</span><strong>30 MIN</strong></div>
          <ol>{brief.agenda.map(([time, title]) => <li key={title}><time>{time}</time><strong>{title}</strong></li>)}</ol>
        </section>

        <section className="mosaic-gaps">
          <div className="module-label"><span>Verification queue</span><strong>{brief.watchouts.length}</strong></div>
          <ul>{brief.watchouts.map((item) => <li key={item}>{item}</li>)}</ul>
        </section>

        <section className="mosaic-evidence">
          <div className="module-label"><span>Evidence inspector</span><strong>{source ? "OPEN" : "IDLE"}</strong></div>
          {source && (
            <>
              <h2>{source.label}</h2>
              <p>{source.excerpt}</p>
              <dl><div><dt>Dataset</dt><dd>{source.dataset}</dd></div><div><dt>Record</dt><dd>{source.recordId}</dd></div></dl>
            </>
          )}
          <div className="evidence-index">
            {evidence.map((item) => <button type="button" key={item.id} aria-pressed={source?.id === item.id} onClick={() => setSource(item)}>{item.short}</button>)}
          </div>
        </section>
      </main>
      <footer className="mosaic-footer"><span>Synthetic demonstration data</span><span>Generated {brief.generated}</span><span>AI synthesis linked to authorized evidence</span></footer>
    </div>
  )
}

function PrototypePicker({ active, onSelect, onReplay }: { active: VariantIndex; onSelect: (index: VariantIndex) => void; onReplay: () => void }) {
  const pickerRef = useRef<HTMLElement>(null)
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([])
  const [ready, setReady] = useState(false)

  useLayoutEffect(() => {
    const picker = pickerRef.current
    const item = itemRefs.current[active]
    if (!picker || !item) return
    picker.style.setProperty("--picker-x", `${item.offsetLeft}px`)
    picker.style.setProperty("--picker-width", `${item.offsetWidth}px`)
    const frame = requestAnimationFrame(() => requestAnimationFrame(() => setReady(true)))
    return () => cancelAnimationFrame(frame)
  }, [active])

  return (
    <nav ref={pickerRef} className="proto-picker" data-position="top" data-ready={ready ? "" : undefined} aria-label="Prototype variants">
      <span className="proto-picker-highlight" aria-hidden="true" />
      {variants.map((name, index) => (
        <button
          className="proto-picker-item"
          type="button"
          key={name}
          ref={(node) => { itemRefs.current[index] = node }}
          data-active={active === index ? "" : undefined}
          aria-current={active === index ? "true" : undefined}
          onClick={() => onSelect(index as VariantIndex)}
        >{name}</button>
      ))}
      <span className="proto-picker-divider" aria-hidden="true" />
      <button className="proto-picker-item proto-picker-replay" type="button" aria-label="Replay animation (R)" onClick={onReplay}>
        <svg aria-hidden="true" viewBox="0 0 20 20" width="14" height="14">
          <path d="M15.5 6.1A6.25 6.25 0 1 0 16 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          <path d="M12.5 5.9h3.2V2.7" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    </nav>
  )
}

export function PrecallPrototype({ initialVariant }: { initialVariant: VariantIndex }) {
  const [active, setActive] = useState<VariantIndex>(initialVariant)
  const [replayKey, setReplayKey] = useState(0)

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.isContentEditable || event.metaKey || event.ctrlKey || event.altKey) return
      const number = Number.parseInt(event.key, 10)
      if (number >= 1 && number <= variants.length) selectVariant((number - 1) as VariantIndex)
      else if (event.key === "ArrowRight") selectVariant(((active + 1) % variants.length) as VariantIndex)
      else if (event.key === "ArrowLeft") selectVariant(((active - 1 + variants.length) % variants.length) as VariantIndex)
      else if (event.key.toLowerCase() === "r") setReplayKey((key) => key + 1)
    }
    document.addEventListener("keydown", onKeyDown)
    return () => document.removeEventListener("keydown", onKeyDown)
  }, [active])

  function selectVariant(index: VariantIndex) {
    setActive(index)
    setReplayKey((key) => key + 1)
    const url = new URL(window.location.href)
    url.searchParams.set("v", String(index + 1))
    window.history.replaceState(null, "", url)
  }

  return (
    <div className="reimagined-prototype">
      {active === 0 && <SignalMap replayKey={replayKey} />}
      {active === 1 && <FieldDossier replayKey={replayKey} />}
      {active === 2 && <EvidenceMosaic replayKey={replayKey} />}
      <PrototypePicker active={active} onSelect={selectVariant} onReplay={() => setReplayKey((key) => key + 1)} />
    </div>
  )
}
