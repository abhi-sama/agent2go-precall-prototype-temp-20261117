"""The golden suites are well formed, cover every question type, and every question can be answered correctly."""

from __future__ import annotations

import pytest
from eval_ideal import ideal

from a2g_api.eval_scoring import score_question, summarise
from a2g_api.eval_suites import CATEGORIES, COUNTED, METRICS, MIN_CHAIN_DEPTH, SUITES

RECORD_PERSONAS = ("msl", "director", "admin")


@pytest.mark.parametrize("persona", list(SUITES))
def test_every_persona_has_at_least_forty_golden_questions(persona):
    assert len(SUITES[persona].questions) >= 40


@pytest.mark.parametrize("persona", list(SUITES))
def test_ids_are_unique_and_expectations_are_valid(persona):
    suite = SUITES[persona]
    ids = [q.question_id for q in suite.questions]
    assert len(ids) == len(set(ids)) and suite.probes
    for q in suite.questions:
        assert q.prompt.strip() and q.title.strip() and q.category in CATEGORIES
        if q.expect is not None:
            assert q.expect.metric in METRICS
            if q.expect.metric in ("trend", "leader"):
                assert q.expect.of in COUNTED
            if q.expect.metric == "trend":
                assert q.expect.prior
            if q.expect.metric == "answer_share":
                assert q.expect.question_id and q.expect.answer is not None
        if q.kind == "QUANTITATIVE" and not q.no_access:
            assert q.expect is not None or q.chain or q.draws, q.question_id
        if q.kind == "LEAK_PROBE":
            assert q.probe is not None
        if q.approximate:
            assert q.expect is not None and q.expect.metric == "trend" or q.chain


@pytest.mark.parametrize("persona", RECORD_PERSONAS)
def test_every_question_type_is_covered_per_persona(persona):
    by_category: dict[str, int] = {}
    for q in SUITES[persona].questions:
        by_category[q.category] = by_category.get(q.category, 0) + 1
    assert set(by_category) == set(CATEGORIES)
    singles = [q for q in SUITES[persona].questions if not q.chain]
    assert len(singles) >= 40, "40 questions before counting any follow-up turn"
    assert by_category["PERCENTAGE"] >= 4 and by_category["TREND"] >= 4 and by_category["COMPARISON"] >= 4
    assert by_category["QUALITATIVE_THEME"] >= 6 and by_category["LEAK_PROBE"] >= 4


@pytest.mark.parametrize("persona", list(SUITES))
def test_follow_up_chains_are_eight_to_twelve_turns_deep(persona):
    chains = SUITES[persona].chains
    assert chains
    for chain_id, turns in chains.items():
        assert [t.turn for t in turns] == list(range(1, len(turns) + 1)), chain_id
        assert len(turns) >= MIN_CHAIN_DEPTH
        assert all(t.category == "FOLLOW_UP_CHAIN" and t.chain == chain_id for t in turns)
    if persona != "executive":
        assert max(len(t) for t in chains.values()) == 12
        assert sum(1 for t in chains.values() if len(t) >= 9) >= 3


@pytest.mark.parametrize("persona", RECORD_PERSONAS)
def test_chains_lean_on_earlier_turns_and_one_goes_back_to_the_first(persona):
    prompts = [q.prompt for t in SUITES[persona].chains.values() for q in t]
    assert any("first question" in p or "first" in p for p in prompts)
    assert any(p.startswith("And ") for p in prompts), "an elliptical follow-up that only makes sense with history"


def test_the_executive_gets_only_governed_aggregates_in_chat():
    suite = SUITES["executive"]
    assert suite.aggregate_only
    aggregate = [q for q in suite.questions if q.expect and q.expect.aggregate]
    assert aggregate
    assert all(q.expect.metric in {"distinct_calls", "engaged_hcps", "responses", "trend", "leader"} for q in aggregate)
    assert all(not q.no_access for q in aggregate)
    assert all(q.no_access or q.kind == "LEAK_PROBE" or q.expect is not None for q in suite.questions)


def test_no_prompt_is_both_answerable_and_no_access_within_a_persona_suite():
    for suite in SUITES.values():
        access_by_prompt: dict[str, set[bool]] = {}
        for question in suite.questions:
            access_by_prompt.setdefault(question.prompt, set()).add(not question.no_access)
        assert all(len(access) == 1 for access in access_by_prompt.values()), suite.persona


@pytest.mark.parametrize("persona", list(SUITES))
def test_a_correct_answer_passes_every_question(persona):
    suite = SUITES[persona]
    scores = []
    for q in suite.questions:
        cap, ev = ideal(q)
        score = score_question(q, cap, ev)
        assert score.verdict == "PASS", (q.question_id, score.reasons, cap.text)
        scores.append(score)
    summary = summarise(scores, suite.questions)
    assert summary["verdict"] == "PASS", summary["failureReasons"]
    assert summary["leakCount"] == 0 and summary["chainDepth"] >= MIN_CHAIN_DEPTH
    assert {c["category"] for c in summary["categories"]} == {q.category for q in suite.questions}


@pytest.mark.parametrize("persona", list(SUITES))
def test_a_wrong_answer_fails_every_question_that_has_a_right_one(persona):
    suite = SUITES[persona]
    checked = 0
    for q in suite.questions:
        if q.expect is None and not q.probe and not q.no_access and not q.min_citations:
            continue
        cap, ev = ideal(q, wrong=True)
        score = score_question(q, cap, ev)
        assert score.verdict == "FAIL", (q.question_id, cap.text)
        checked += 1
    assert checked >= 30
