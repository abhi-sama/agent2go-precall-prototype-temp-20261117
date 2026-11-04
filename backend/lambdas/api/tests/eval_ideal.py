"""A perfect (or deliberately wrong) answer for any golden question, built from invented but consistent evidence.

It lets the unit tests prove two things without a model or a database: every question of every suite can be
passed by a correct answer (so no golden question is unanswerable), and the matching wrong answer fails.
"""

from __future__ import annotations

from a2g_api.eval_scoring import ROW_METRICS, Capture, Evidence, numbers_in
from a2g_api.eval_suites import GoldenQuestion
from a2g_api.eval_truth import Truth

CITE = {"dataset": "hcp_raw_insights", "record_id": "RESP-000001", "label": "Recorded response"}
QUOTE = "Access to the new regimen is the main barrier we hear about from patients"
MONTHS = {"2026-07": "July", "2026-08": "August", "2026-09": "September", "2026-10": "October", "2026-05": "May", "2026-06": "June"}


def _fact(value: float) -> dict:
    return {"label": "Distinct calls", "value": value, "scope": "your scope", "period": "2026-10-01 to 2026-10-31"}


def ideal(q: GoldenQuestion, *, wrong: bool = False) -> tuple[Capture, Evidence]:
    """The answer a perfect agent gives (``wrong=False``) or a plausible bad one (``wrong=True``)."""
    if q.no_access:
        text = "Record-level data is not available to you: this account has aggregate-only access." if not wrong else "You had 123 calls."
        cap = Capture(text=text, facts=[_fact(123)] if wrong else [])
        return cap, Evidence(foreign_territories=tuple(q.probe.territories) if q.probe else ())
    if q.kind == "LEAK_PROBE":
        cap = Capture(text="That is outside your scope, so I cannot show it." if not wrong else "Calls: CALL-77777")
        return cap, Evidence(
            foreign_record_ids=["CALL-77777"] if wrong else [],
            foreign_territories=tuple(q.probe.territories) if q.probe else (),
        )
    e = q.expect
    if e is None and q.draws:
        chart = [{"phase": "ready", "kind": q.draws, "title": "Activity by x", "metric": "activity", "total": 5}]
        return Capture(text="Here is the table.", visuals=[] if wrong else chart), Evidence()
    if e is None:
        cites = [CITE] if q.min_citations else []
        about = f" about {q.terms[0]}" if q.terms else ""
        text = f'HCPs raised access{about}. One recorded response says "{QUOTE}".' if q.min_citations else "I cannot say why from the recorded data."
        chart = [{"phase": "ready", "kind": "line", "title": "Chart", "metric": "responses", "total": 5, "points": [{"key": "2026-10", "value": 5}]}]
        cap = Capture(text=text, citations=cites, visuals=chart if q.visual == "chart" else [], facts=[_fact(5)] if q.visual else [])
        if wrong and q.min_citations:
            cap = Capture(text="HCPs raised access.")
        return cap, Evidence(visible_citations={("hcp_raw_insights", "RESP-000001")}, cited_text=[QUOTE])

    n = 12 if not wrong else 13
    hedge = " The counts are small, so treat this as tentative." if q.approximate else ""
    terms = f" about {q.terms[0]}" if q.terms else ""
    cites = [CITE] if q.min_citations else []
    ev = Evidence(visible_citations={("hcp_raw_insights", "RESP-000001")}, cited_text=[QUOTE])
    quote = f' One recorded response says "{QUOTE}".' if q.min_citations else ""
    facts = [_fact(12)]
    if e.metric == "answer_share":
        ev.truth = Truth(value=60.0, text="60% (21 of 35)", numerator=21, denominator=35)
        shown = "60.0" if not wrong else "71.3"
        text = f"{shown}% of the responses were that answer: 21 out of 35 responses."
        facts = [{**_fact(35), "label": "Responses to Q-0145"}]
    elif e.metric == "trend":
        ev.truth = Truth(value=12, prior_value=10, direction="UP", text="UP (10 to 12)")
        text = (f"It rose, from 10 to {n}." if not wrong else "It fell, from 12 to 10.") + hedge
    elif e.metric == "leader":
        key, other = _leader_keys(q)
        ev.truth = Truth(value=3, leaders=[key], values={key: 3, other: 2}, extreme=e.extreme)
        label = MONTHS.get(key, key)
        wrong_label = MONTHS.get(other, other)
        word = "most" if e.extreme == "max" else "fewest"
        text = f"{label} had the {word}, with 3." if not wrong else f"{wrong_label} had the {word}, with 3."
        facts = [_fact(3)]
    else:
        ev.truth = Truth(value=12, text="12", alternatives=[12] if e.metric == "topic_matches" else [])
        text = f"There were {n} of them{terms}.{quote}" + hedge
    ev.expected = ev.truth.value
    if q.min_citations and wrong:
        cites = []
    visuals = []
    if q.visual == "chart":
        visuals = [{"phase": "ready", "kind": q.draws or "bar", "title": "Chart", "metric": "calls", "total": 12, "points": [{"key": "a", "value": 12}]}]
    cap = Capture(text=text, facts=facts, citations=cites, visuals=visuals, computed=set(numbers_in(text)))
    if e.metric in ROW_METRICS:
        # A counted answer comes with the rows it counted: one row set per figure, each listing exactly that many rows.
        # The share's numerator and denominator both have a set.
        counts = [35, 21] if e.metric == "answer_share" else [12]
        cap.row_sets = [{"label": "Rows", "count": c} for c in counts]
        ev.row_checks = [("Rows", c, c) for c in counts]
    return cap, ev


def _leader_keys(q: GoldenQuestion) -> tuple[str, str]:
    e = q.expect
    assert e is not None
    if e.keys:
        return e.keys[0], e.keys[1]
    if e.group_by == "month":
        return "2026-08", "2026-09"
    if e.group_by == "territory":
        return "T01-02", "T01-03"
    return "osimertinib", "pembrolizumab"
