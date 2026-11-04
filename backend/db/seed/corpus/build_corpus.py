#!/usr/bin/env python3
"""One-off builder for the qualitative answer fixture (``qualitative_corpus.json``).

The committed fixture is the only input the seed generator reads, so ordinary seed
runs need no AI and no network. Run this script only to regenerate or extend the
fixture::

    python3 backend/db/seed/corpus/build_corpus.py            # fills missing cells
    python3 backend/db/seed/corpus/build_corpus.py --check    # prints counts only

The Anthropic key is read at run time from ``ANTHROPIC_API_KEY`` or from
``~/.config/agent2go/keys.env``. It is never written anywhere: the fixture holds
generated answer text and the model name, nothing else.

All text is synthetic. The prompt forbids names of people, institutions, emails and
precise statistics, so the fixture is safe to commit.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

HERE = Path(__file__).resolve().parent
FIXTURE = HERE / "qualitative_corpus.json"
MODEL = "claude-sonnet-5-5"
KEYS_FILE = Path.home() / ".config" / "agent2go" / "keys.env"

MOLECULES = ["trastuzumab deruxtecan", "osimertinib", "pembrolizumab", "sacituzumab govitecan"]
CONTEXT = {
    "trastuzumab deruxtecan": "trastuzumab deruxtecan (T-DXd, an HER2-directed ADC) in HER2-positive and HER2-low breast cancer (DESTINY-Breast06 context)",
    "osimertinib": "osimertinib (EGFR TKI) in EGFR-mutant non-small cell lung cancer (FLAURA2 context, with or without chemotherapy)",
    "pembrolizumab": "pembrolizumab (PD-1 inhibitor) in gastric cancer and perioperative lung cancer settings (KEYNOTE-671 context)",
    "sacituzumab govitecan": "sacituzumab govitecan (TROP2-directed ADC) in urothelial and HR+/HER2- breast cancer (TROPiCS-02 context)",
}

#: topic key -> (kind, description). ``theme`` topics are the planted qualitative themes,
#: ``emerging`` topics grow over the last 90 days, ``followup`` topics answer conditional prompts.
TOPICS: dict[str, tuple[str, str]] = {
    "efficacy": ("theme", "efficacy and durability of benefit: response depth and duration, PFS and OS signals, how the data play out in the clinic"),
    "safety": ("theme", "safety and tolerability: class-specific adverse events, dose reductions and delays, discontinuations, monitoring burden, nursing and supportive-care load"),
    "sequencing": ("theme", "treatment sequencing and line-of-therapy placement: what goes before and after, switch points, combination versus sequential use"),
    "biomarker": ("theme", "biomarker testing: which tests are ordered, tissue versus liquid biopsy, turnaround time, scoring variability, reflex testing gaps"),
    "access": ("theme", "access and reimbursement: prior authorization, payer step edits, denials and appeals, copay and financial assistance, buy-and-bill and site-of-care economics"),
    "guidelines": ("theme", "guidelines and pathways: NCCN, ESMO and ASCO updates, institutional pathway committees, compendia listings, label language"),
    "trial_design": ("theme", "trial design and evidence gaps: comparator choice, crossover, endpoints, subgroup power, how well the trial population matches clinic patients"),
    "competitor": ("theme", "competitor comparisons: alternative agents and classes, cross-trial comparisons, what colleagues and tumor boards prefer, rep activity"),
    "patient_selection": ("theme", "patient selection: performance status, age and frailty, comorbidities, brain metastases, prior therapy, who is and is not a good candidate"),
    "unmet_need": ("theme", "unmet need: what to do after progression, resistance mechanisms, CNS disease, quality of life, gaps the current options leave"),
    "ctdna": ("emerging", "ctDNA and liquid biopsy used for monitoring: MRD, molecular response, clearance, using ctDNA to guide escalation, de-escalation or early switch"),
    "pulm_surveillance": ("emerging", "pulmonary toxicity surveillance: ILD or pneumonitis early detection, CT schedules, symptom triage lines, pulmonology co-management and steroid protocols"),
    "early_stage": ("emerging", "earlier-stage use: neoadjuvant, adjuvant and perioperative interest, curative-intent settings, how HCPs would want early-stage data to read out"),
    "barrier": ("followup", "the MAIN BARRIER the HCP names to using this therapy more (answers a follow-up question 'What is the main barrier?'): usually one or two sentences, mostly about coverage, testing, monitoring, logistics or evidence"),
    "why_low": ("followup", "why the HCP is NOT confident or NOT likely to use it more (answers 'What is the main reason for your low score?'): one or two sentences of reasons, hesitations and what is missing"),
    "why_high": ("followup", "why the HCP IS confident or likely to use it (answers 'What drives your high score?'): one or two sentences of reasons and the patients they have in mind"),
}

PERSONAS = [
    "terse field-note shorthand with abbreviations (HCP, pt, tx, PFS, AEs, PA, tumor board)",
    "hedging and uncertain: 'seems', 'may', 'not sure yet', 'would need to see'",
    "a considered paragraph written after a long conversation",
    "reported speech: what the HCP said, paraphrased by the MSL ('Dr. said...' style but never naming anyone)",
    "plain, matter-of-fact summary with one concrete clinic detail",
    "slightly rushed notes typed on an iPad between meetings, a few small typos",
    "skeptical or frustrated HCP, direct about problems",
    "enthusiastic HCP, but with one caveat",
]


def api_key() -> str:
    key = os.environ.get("ANTHROPIC_API_KEY", "")
    if not key and KEYS_FILE.exists():
        for line in KEYS_FILE.read_text().splitlines():
            if line.startswith("ANTHROPIC_API_KEY="):
                key = line.split("=", 1)[1].strip().strip('"').strip("'")
    if not key:
        raise SystemExit("ANTHROPIC_API_KEY is not set and ~/.config/agent2go/keys.env has none")
    return key


def prompt_for(topic: str, molecule: str, persona: str, n: int) -> str:
    kind, desc = TOPICS[topic]
    short = "1 to 14 words" if kind != "followup" else "3 to 14 words"
    return f"""You are writing SYNTHETIC test data: free-text answers that oncology HCPs gave to a Medical Science Liaison (MSL) and that the MSL recorded in an insight system. The setting is {CONTEXT[molecule]}.

Topic of every answer: {desc}.

Write exactly {n} DIFFERENT answers in the MSL's field-note voice. Rules:
- Length mix: about 30% one-liners ({short}), 40% two or three sentences, 30% a short paragraph (4 to 6 sentences). Never longer than 110 words.
- Sentiment mix: about 25% positive, 40% neutral or mixed, 35% negative or concerned. Label each answer.
- Vary vocabulary, sentence openers and the concrete detail (clinic type, patient scenario, workflow, payer, timing). Never start two answers the same way. Do not reuse the phrase pattern of an earlier answer.
- Voice for this batch: {persona}. Still let the mix above show.
- Make it feel real: some hedging ('probably', 'not sure', 'I think'), common abbreviations, roughly 1 in 6 answers containing a natural typo or missing punctuation (never inside the key clinical terms of the topic).
- Mention the drug by name or by a normal short form in only about half of the answers.
- Absolutely no names of people, institutions, cities, companies, emails or phone numbers. Do not invent specific percentages, hazard ratios, p-values or trial results; qualitative impressions only ('a good chunk', 'most', 'a handful').
- Stay on the topic above in every answer. Write only what the HCP's perspective was; no advice to the reader.

Return ONLY a JSON array of {n} objects, no markdown fence, each exactly: {{"t": "<answer text>", "s": "pos" | "neu" | "neg"}}"""


def call(prompt: str, key: str) -> list[dict[str, str]]:
    body = json.dumps({"model": MODEL, "max_tokens": 6000, "temperature": 1.0, "messages": [{"role": "user", "content": prompt}]}).encode()
    request = urllib.request.Request(
        "https://api.anthropic.com/v1/messages", data=body, method="POST",
        headers={"x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json"},
    )
    for attempt in range(5):
        try:
            with urllib.request.urlopen(request, timeout=180) as response:
                payload = json.load(response)
            text = "".join(block.get("text", "") for block in payload["content"])
            text = re.sub(r"^```(?:json)?|```$", "", text.strip(), flags=re.M).strip()
            items = json.loads(text[text.index("["): text.rindex("]") + 1])
            return [{"t": " ".join(i["t"].split()), "s": i["s"]} for i in items if isinstance(i, dict) and i.get("s") in {"pos", "neu", "neg"} and isinstance(i.get("t"), str)]
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, ValueError, KeyError) as exc:
            print(f"  retry {attempt + 1}: {type(exc).__name__}", file=sys.stderr)
            time.sleep(4 * (attempt + 1))
    return []


def load() -> dict:
    if FIXTURE.exists():
        return json.loads(FIXTURE.read_text())
    return {"model": MODEL, "cells": {}}


def norm(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", text.lower()).strip()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--per-cell", type=int, default=80, help="target distinct answers per topic x molecule")
    parser.add_argument("--targets", default="", help="per-topic overrides of --per-cell, e.g. why_low=160,access=130")
    parser.add_argument("--batch", type=int, default=20)
    parser.add_argument("--workers", type=int, default=6)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    corpus = load()
    cells: dict[str, list[dict[str, str]]] = corpus["cells"]
    if args.check:
        print(json.dumps({k: len(v) for k, v in sorted(cells.items())}, indent=1), sum(len(v) for v in cells.values()))
        return
    key = api_key()
    seen = {norm(e["t"]) for v in cells.values() for e in v}
    jobs = []
    targets = {k: int(v) for k, v in (item.split("=") for item in args.targets.split(",") if item)}
    for topic in TOPICS:
        for molecule in MOLECULES:
            cell = f"{topic}|{molecule}"
            have = len(cells.get(cell, []))
            batches = max(0, -(-(targets.get(topic, args.per_cell) - have) // args.batch))
            for b in range(batches):
                jobs.append((cell, topic, molecule, PERSONAS[(len(cells.get(cell, [])) // args.batch + b + len(jobs)) % len(PERSONAS)]))
    print(f"{len(jobs)} requests", file=sys.stderr)
    with ThreadPoolExecutor(args.workers) as pool:
        futures = {pool.submit(call, prompt_for(t, m, p, args.batch), key): cell for cell, t, m, p in jobs}
        for done, future in enumerate(as_completed(futures), 1):
            cell = futures[future]
            for entry in future.result():
                if not 3 <= len(entry["t"]) <= 900 or norm(entry["t"]) in seen:
                    continue
                seen.add(norm(entry["t"]))
                cells.setdefault(cell, []).append(entry)
            if done % 10 == 0 or done == len(futures):
                FIXTURE.write_text(json.dumps(corpus, indent=0, ensure_ascii=False, sort_keys=True) + "\n")
                print(f"  {done}/{len(futures)} done, {sum(len(v) for v in cells.values())} answers", file=sys.stderr)
    FIXTURE.write_text(json.dumps(corpus, indent=0, ensure_ascii=False, sort_keys=True) + "\n")


if __name__ == "__main__":
    main()
