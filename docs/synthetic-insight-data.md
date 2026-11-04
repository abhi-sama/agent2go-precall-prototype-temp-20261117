# Synthetic HCP insight data

The seed (`backend/db/seed/`) writes 400 questions and 60,000 responses that look like an oncology MSL insight
survey: every answer type, conditional follow-ups, and deliberately planted signal for dashboards, themes,
semantic search, emerging topics and the AI evals to find. It is deterministic (a SplitMix64 generator in
`rng.py`, no `random`, no network) and `python3 -m unittest discover -s backend/db/tests` proves everything below.

## Shape

| Piece | Where | What |
| --- | --- | --- |
| Question catalog | `questions.py` | 100 question *concepts* x 4 programs (molecule / tumor / study) = 400 questions, `Q-0001`..`Q-0400` |
| Generator | `insights.py` | Interactions (one HCP, one day, one program) own several response rows that share `insight_intrctn_dtl_sfdc_id` |
| Qualitative text | `corpus/qualitative_corpus.json` | 6,000+ distinct MSL field-note answers pre-generated once with `claude-sonnet-5-5`. Text and model name only. |
| Corpus builder | `corpus/build_corpus.py` | Only needed to regenerate; reads the key from `ANTHROPIC_API_KEY` or `~/.config/agent2go/keys.env`, never stores it |
| Theme detector | `themes.py` | Naive-Bayes text classifier trained on 70% of the fixture; tests classify only the held-out 30% |

Every answer is text in `rspns_txt`; the type follows `qstn_type`. `derived_rspns_text` holds the label of a scale answer
(`Agree`, `High (9-10)`).

| `qstn_type` | Answer stored in `rspns_txt` | Example |
| --- | --- | --- |
| `open_text` | free text, one line to a paragraph, field-note voice, hedging, abbreviations, typos | `Payer cites compendia only, ignores ESMO...` |
| `single_choice` | the chosen option | `Second line` |
| `multi_select` | options joined with `;` | `Cost / coverage;Prior authorization burden` |
| `yes_no` | `Yes` / `No` / `Unsure` | `No` |
| `likert_5` | `1`..`5` | `4` |
| `rating_0_10` | `0`..`10` | `8` |
| `numeric` | integer (unit in the question: %, patients per month, months, days) | `35` |
| `date` | ISO `YYYY-MM-DD` | `2026-03-14` |
| `ranking` | options best first, joined with ` > ` | `Efficacy > Safety / tolerability > Access / coverage` |

## Conditional follow-ups

39 concepts (156 questions) are follow-ups: `question_tag.qstn_pid` names the parent. A follow-up row exists only in the
interaction whose parent answer triggered it, for the same HCP and date, for example:

- `Started a patient on {drug} recently?` = `No` / `Unsure` -> "What is the main barrier to starting patients?" (a choice and a free-text one).
- Likert <= 2 or 0-10 score <= 6 -> "What is the main reason for your low score?"; score >= 9 -> "What drives your high score?".
- `Yes` to "Does coverage limit your use?" -> "What is the main coverage challenge?"; a multi-select that includes prior authorization -> "How many denials?".

The parent row records its (first) follow-up in `follow_up_qstn_tag`, `followup_qid`, `followup_qstn`, `followup_rspns`,
which equal the child row's tag, `qstn_ext_id`, `qstn_txt` and `rspns_txt`. On a question, `follow_up_qstn_tag` is the tag of
its follow-up. Q-0100 keeps its planted orphan parent (`Q-NOT-IN-CATALOG`); its answers appear with no parent row.

## Planted signal (all detectable from `rspns_txt` alone)

1. **Ten themes of different sizes by region and territory.** Efficacy, safety, sequencing, biomarker testing, access and
   reimbursement, guidelines, trial design, competitors, patient selection, unmet need. Regional tilt: REGION-01 trial
   design and biomarker, REGION-02 access, REGION-03 guidelines and sequencing, REGION-04 competitors, safety and unmet need.
   Territory spikes: T02-03 access, T01-01 trial design, T04-05 safety, T03-05 guidelines, T04-03 competitors, T03-02
   sequencing, T01-04 biomarker.
2. **Three emerging topics that grow over the last 90 days.** ctDNA / liquid-biopsy monitoring (from 90 days ago),
   pulmonary toxicity surveillance (from 72), earlier-stage / neoadjuvant use (from 56). Near 0.4% of free text before, up to about 15-25% by the last week.
   Also `uses_ctdna` (yes/no) rises over the year.
3. **A perspective shift for a fixed HCP set.** 168 panel HCPs (every 20th HCP of each territory) answer the same five
   tracker questions (`line_placement`, `tracker_confidence`, `tracker_likelihood`, `tracker_earlier`, `tracker_view`;
   Q-0001..Q-0020 region) in three waves (about 340-300, 190-150 and 45-5 days ago). Mean confidence goes 2.2 -> 3.1 -> 4.0,
   likelihood 3.8 -> 5.6 -> 7.6, "First line" placement grows, and free-text sentiment moves from mostly negative to mostly
   positive. Everyone else answers the same questions without any trend (control).
4. **Barrier answers correlate with access themes.** Each HCP/interaction has an access-friction level (high in
   REGION-02, T02-03, T02-06). It raises "Cost / coverage" and "Prior authorization" barrier answers, lowers 0-10 and Likert
   scores, and, when a barrier answer is access-related, makes the access theme about 2.5x as likely in the same interaction's free text.

Existing planted defects are unchanged: duplicate `uniq_rspns_id` `RESP-000001`, orphan parent `Q-0100`, 6,000 responses with
status `Retired` against an `Active` catalog, stale and failed ingestion runs, unresolved identities, and the time-only roster dates.

## Regenerating

```sh
python3 backend/db/seed/generate.py                       # deterministic, no AI, no network
python3 backend/db/seed/corpus/build_corpus.py --check    # fixture counts
python3 backend/db/seed/corpus/build_corpus.py --per-cell 100   # regenerate / top up (needs the key)
```

Changing the fixture, `questions.py` or the weights changes the data; rerun `python3 -m unittest discover -s backend/db/tests`.
