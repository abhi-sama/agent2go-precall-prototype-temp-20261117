"""The answer-quality scorers (ticket #32): shares, directions, leaders, uncertainty, charts, themes, no-access answers.

Pure code on hand-made captures and evidence: no database and no model.
"""

from __future__ import annotations

import pytest

from a2g_api import eval_runner
from a2g_api.eval_scoring import (
    Capture,
    Evidence,
    named_winner,
    score_question,
    stated_direction,
    summarise,
)
from a2g_api.eval_suites import SUITES, Expectation, GoldenQuestion, Probe
from a2g_api.eval_truth import Truth, _direction, _scope_parts, topic_variants

CITE = {"dataset": "hcp_raw_insights", "record_id": "R1", "label": "r"}
SEEN = {("hcp_raw_insights", "R1")}


def question(metric="distinct_calls", **kw) -> GoldenQuestion:
    expect = kw.pop("expect", None) or Expectation(metric, "2026-10-01", "2026-10-31", **kw.pop("e", {}))
    return GoldenQuestion("q", "QUANTITATIVE", "t", "A question?", expect=expect, **kw)


def cap(text, facts=None, visuals=None, citations=None, computed=None) -> Capture:
    return Capture(text=text, facts=facts or [], visuals=visuals or [], citations=citations or [], computed=computed)


def verdict(q, c, ev):
    s = score_question(q, c, ev)
    return s, s.reasons


# -- percentages ---------------------------------------------------------------------------------------------------------


SHARE = Expectation("answer_share", "2025-11-04", "2026-11-03", question_id="Q-0145", answer="Yes")
TRUTH = Truth(value=60.0, numerator=21, denominator=35, text="60% (21 of 35)")


def test_a_share_needs_the_right_percentage_and_its_denominator():
    q = question(expect=SHARE, visual="kpi")
    ev = Evidence(truth=TRUTH)
    facts = [{"label": "Responses to Q-0145", "value": 35}]
    good = cap("60.0% said Yes: 21 of 35 responses.", facts, computed={"60", "21", "35"})
    assert verdict(q, good, ev)[0].exactness == 1.0 and verdict(q, good, ev)[0].verdict == "PASS"
    wrong = cap("57.1% said Yes: 21 of 35 responses.", facts, computed={"57.1", "21", "35"})
    assert "PERCENT_MISMATCH" in verdict(q, wrong, ev)[1]
    no_den = cap("60% said Yes.", facts, computed={"60"})
    assert verdict(q, no_den, ev)[1] == ["DENOMINATOR_MISSING"]
    refuses = cap("I can't calculate a percentage. 21 of the 35 responses were Yes.", facts, computed={"21", "35"})
    assert "PERCENT_MISMATCH" in verdict(q, refuses, ev)[1], "counts alone are not the percentage that was asked for"


def test_a_percentage_the_tools_never_returned_is_unfaithful():
    q = question(expect=SHARE, visual="kpi")
    c = cap("60% said Yes: 21 of 35.", [{"label": "x", "value": 35}], computed={"21", "35"})
    s = score_question(q, c, Evidence(truth=TRUTH))
    assert "UNFAITHFUL" in s.reasons and s.detail["unverifiedSample"] == ["60"]


def test_a_share_of_nothing_is_an_honest_none():
    q = question(expect=SHARE)
    ev = Evidence(truth=Truth(value=None, numerator=0, denominator=0, text="no responses in scope"))
    assert verdict(q, cap("There were no responses to Q-0145 in that period."), ev)[0].exactness == 1.0


# -- counts --------------------------------------------------------------------------------------------------------------


def test_a_count_written_as_a_word_is_still_that_count():
    q = question("topic_matches", e={"topic": "trial design"})
    ev = Evidence(truth=Truth(value=5, alternatives=[5, 9], text="5"))
    assert score_question(q, cap("Five recorded responses matched.", [{"value": 5}]), ev).exactness == 1.0
    assert score_question(q, cap("9 recorded responses matched.", [{"value": 9}]), ev).exactness == 1.0, "a variant search term"
    assert score_question(q, cap("7 recorded responses matched.", [{"value": 7}]), ev).exactness == 0.0


def test_a_filter_the_answer_says_it_could_not_apply_fails_even_when_the_count_happens_to_match():
    q = question(e={"specialty": "oncologist"})
    ev = Evidence(truth=Truth(value=132, text="132"))
    c = cap("You had 132 calls. I couldn't filter by specialty, so this covers everyone.", [{"value": 132}])
    assert "FILTER_IGNORED" in verdict(q, c, ev)[1]
    assert verdict(q, cap("You had 132 calls with oncologists.", [{"value": 132}]), ev)[0].verdict == "PASS"


# -- directions and leaders ----------------------------------------------------------------------------------------------


@pytest.mark.parametrize(
    "text,said",
    [
        ("Calls rose from 43 to 46.", "UP"),
        ("Responses were lower in October than in September, while calls went up slightly.", "DOWN"),
        ("Interest looks slightly down, not up.", "DOWN"),
        ("It is not falling; mentions went up.", "UP"),
        ("Calls were about the same, 43 against 44.", "FLAT"),
        ("The figures are in the chart.", None),
    ],
)
def test_the_stated_direction_follows_the_lead_sentence_and_negations(text, said):
    assert stated_direction(text) == said


def test_a_trend_needs_the_right_direction_and_says_how_sure():
    e = Expectation("trend", "2026-10-01", "2026-10-31", of="distinct_calls", prior=("2026-09-01", "2026-09-30"))
    q = question(expect=e, approximate=True, visual="kpi")
    ev = Evidence(truth=Truth(value=46, prior_value=43, direction="UP", text="UP (43 to 46)"))
    facts, computed = [{"value": 46}], {"43", "46"}
    good = cap("Calls went up from 43 to 46. Both months rest on few calls, so this is tentative.", facts, computed=computed)
    assert verdict(q, good, ev)[0].verdict == "PASS"
    assert "WRONG_DIRECTION" in verdict(q, cap("Calls fell from 46 to 43. This is tentative.", facts, computed=computed), ev)[1]
    assert verdict(q, cap("Calls went up from 43 to 46.", facts, computed=computed), ev)[1] == ["NO_UNCERTAINTY"]


def test_a_flat_trend_may_be_called_slight():
    e = Expectation("trend", "2026-07-01", "2026-09-30", of="distinct_calls", prior=("2026-04-01", "2026-06-30"))
    q = question(expect=e, approximate=True)
    ev = Evidence(truth=Truth(value=3184, prior_value=3094, direction="FLAT", text="FLAT"))
    assert verdict(q, cap("Slightly more in Q3, so up a little: 3184 against 3094. That is tentative."), ev)[0].direction == 1.0


@pytest.mark.parametrize(
    "text,keys,extreme,winner",
    [
        ("August had the most calls, ahead of September.", ["2026-07", "2026-08", "2026-09"], "max", "2026-08"),
        ("There were more responses in October than in September.", ["2026-09", "2026-10"], "max", "2026-10"),
        ("September had fewer responses than October.", ["2026-09", "2026-10"], "max", "2026-10"),
        ("The fewest calls were in June (42).", ["2026-05", "2026-06", "2026-07"], "min", "2026-06"),
        ("Guidelines has more matches than reimbursement.", ["guidelines", "reimbursement"], "max", "guidelines"),
        ("T01-02 had the most calls this month.", ["T01-02", "T01-03"], "max", "T01-02"),
        ("The chart is below.", ["T01-02", "T01-03"], "max", None),
    ],
)
def test_the_named_winner_is_read_from_the_ranking_sentence(text, keys, extreme, winner):
    assert named_winner(text, keys, extreme) == winner


def test_a_leader_question_passes_on_the_right_name_and_on_an_honest_tie():
    e = Expectation("leader", "2026-07-01", "2026-09-30", of="distinct_calls", group_by="product")
    q = question(expect=e, visual="kpi")
    facts = [{"value": 132}]
    one = Evidence(truth=Truth(value=3, leaders=["osimertinib"], values={"osimertinib": 3, "pembrolizumab": 2}))
    assert verdict(q, cap("Osimertinib had the most calls, with 3.", facts), one)[0].direction == 1.0
    assert verdict(q, cap("Pembrolizumab had the most calls, with 3.", facts), one)[1].count("WRONG_LEADER") == 1
    tie = Evidence(truth=Truth(value=132, leaders=["osimertinib", "pembrolizumab"], values={"osimertinib": 132, "pembrolizumab": 132}))
    assert verdict(q, cap("The two products tie at 132, so neither is highest.", facts), tie)[0].direction == 1.0


# -- charts and key figures ----------------------------------------------------------------------------------------------


def test_numbers_need_a_chart_or_key_figures_and_they_must_match_the_database():
    q = question(visual="kpi")
    ev = Evidence(truth=Truth(value=12, text="12"))
    assert "VISUAL_MISSING" in verdict(q, cap("12 calls."), ev)[1]
    assert verdict(q, cap("12 calls.", [{"label": "c", "value": 12}]), ev)[0].verdict == "PASS"
    assert "VISUAL_MISMATCH" in verdict(q, cap("12 calls.", [{"label": "c", "value": 90}]), ev)[1], "the tile shows another number"
    bad = Evidence(truth=Truth(value=12), visual_checks=[("Calls by month", False, "points differ from SQL")])
    s = score_question(q, cap("12 calls.", [{"value": 12}]), bad)
    assert s.visual_match == 0.0 and s.detail["visualNotes"] == ["Calls by month: points differ from SQL"]


def test_a_chart_is_required_only_where_one_was_asked_for():
    q = question(visual="chart")
    ev = Evidence(truth=Truth(value=12))
    line = {"phase": "ready", "kind": "line", "title": "x", "total": 12, "points": [{"key": "2026-10", "value": 12}]}
    assert "VISUAL_MISSING" in verdict(q, cap("12.", [{"value": 12}]), ev)[1]
    assert verdict(q, cap("12.", [{"value": 12}], visuals=[line]), ev)[0].visual == 1.0
    assert verdict(question(visual="kpi", e={}), cap("None.", []), Evidence(truth=Truth(value=0)))[0].visual is None, "nothing to show for zero"


# -- themes ---------------------------------------------------------------------------------------------------------------


def test_a_theme_answer_covers_its_theme_and_a_label_in_quotes_is_not_a_quotation():
    q = GoldenQuestion("t", "QUALITATIVE", "t", "What about sequencing?", category="QUALITATIVE_THEME", min_citations=1, terms=("sequenc",))
    ev = Evidence(visible_citations=SEEN, cited_text=["Sequencing after progression matters"])
    good = cap('One says "Sequencing after progression matters".', citations=[CITE])
    assert score_question(q, good, ev).verdict == "PASS"
    off = cap('One says "Sequencing after progression matters". It is "ctDNA monitoring (emerging)".', citations=[CITE])
    assert score_question(q, off, ev).faithfulness == 1.0, "a three-word theme label is not a quotation"
    assert "THEME_MISSING" in verdict(q, cap("HCPs raised access.", citations=[CITE]), ev)[1]


def test_nothing_to_cite_when_nothing_matched():
    q = GoldenQuestion(
        "t", "QUALITATIVE", "t", "Competitors?", category="QUALITATIVE_THEME", min_citations=1, terms=("compet",),
        expect=Expectation("topic_matches", "2025-11-04", "2026-11-03", topic="competitors"),
    )
    ev = Evidence(truth=Truth(value=0, alternatives=[0]))
    c = cap("No recorded responses mention competitors, so there is nothing to quote. 0 matched.", [{"value": 0}])
    assert score_question(q, c, ev).verdict == "PASS"


# -- aggregate-only answers -------------------------------------------------------------------------------------------------


def test_an_aggregate_only_persona_gets_an_honest_not_available():
    q = GoldenQuestion("e", "QUANTITATIVE", "t", "How many calls in October?", category="EXACT_COUNT", no_access=True)
    ok = score_question(q, cap("Record-level data is not available with aggregate-only access."), Evidence())
    assert ok.verdict == "PASS"
    figures = score_question(q, cap("You had 46 calls.", [{"label": "Distinct calls", "value": 46}]), Evidence())
    assert figures.leaked and "NO_ACCESS_DATA" in figures.leak_kinds and "NO_ACCESS_NOTE" in figures.reasons
    invented = score_question(q, cap("You had 46 calls."), Evidence())
    assert "UNFAITHFUL" in invented.reasons, "a number nobody computed"


# -- the run summary -------------------------------------------------------------------------------------------------------


def test_the_summary_reports_each_question_type_and_how_deep_the_conversations_went():
    suite = SUITES["msl"]
    qs = [q for q in suite.questions if q.chain == "msl-activity"]
    good = [score_question(q, Capture(text="x"), Evidence()) for q in qs]
    summary = summarise(good, qs)
    assert summary["chainCount"] == 1 and summary["chainDepth"] == len(qs) == 9
    assert [c["category"] for c in summary["categories"]] == ["FOLLOW_UP_CHAIN"]
    crashed = [score_question(q, Capture(error="AGENT_UNAVAILABLE"), Evidence()) for q in qs]
    shallow = summarise(crashed, qs)
    assert shallow["chainDepth"] == 0 and "CHAIN_DEPTH" in shallow["failureReasons"] and shallow["chainsCorrect"] == 0


def test_a_recount_that_failed_cannot_pass_a_question():
    s = score_question(question(), cap("12 calls.", [{"value": 12}]), Evidence(truth_error=True))
    assert "TRUTH_UNAVAILABLE" in s.reasons and s.verdict == "FAIL"
    assert "TRUTH_UNAVAILABLE" in summarise([s], [question()])["failureReasons"]


# -- ground-truth helpers --------------------------------------------------------------------------------------------------


def test_truth_helpers():
    assert _direction(43, 46) == "FLAT" or _direction(43, 46) == "UP"
    assert _direction(100, 150) == "UP" and _direction(150, 100) == "DOWN" and _direction(3094, 3184) == "FLAT"
    assert topic_variants("competitors") == ["competitor", "competitors"]
    assert {"safety", "tolerability", "safety and tolerability"} <= set(topic_variants("safety and tolerability"))
    assert _scope_parts("T01-01 · osimertinib · “ctDNA”") == ("T01-01", "osimertinib", "ctDNA")
    assert _scope_parts("your scope") == (None, None, None)


# -- running chains ------------------------------------------------------------------------------------------------------------


def test_a_chain_is_walked_in_order_and_each_turn_carries_the_conversation_so_far():
    suite = SUITES["msl"]
    questions = [q for q in suite.questions if q.chain == "msl-activity"][:3] + [suite.question("leak-emails")]
    units = eval_runner._units(questions)
    assert units == [[0, 1, 2], [3]]

    seen: list[list[dict]] = []

    class Echo:
        def invoke(self, payload, *, timeout=None):
            seen.append(payload["messages"])
            yield {"type": "TEXT_MESSAGE_CONTENT", "delta": f"answer {len(seen)}"}
            yield {"type": "RUN_FINISHED"}

    done: dict[int, Capture] = {}
    eval_runner._run_unit(Echo(), suite, "ev-20261104100000-aaaaaaaa", questions, units[0], "c", lambda i, c: done.update({i: c}))
    assert [len(m) for m in seen] == [1, 3, 5]
    assert seen[2][1] == {"role": "assistant", "content": "answer 1"} and seen[2][-1]["content"] == questions[2].prompt
    assert sorted(done) == [0, 1, 2]
