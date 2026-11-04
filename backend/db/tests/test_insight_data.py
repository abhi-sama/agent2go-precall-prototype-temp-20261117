"""Unit checks on the synthetic HCP insight generator. Stdlib only; no database needed.

    python3 -m unittest discover -s backend/db/tests

They prove the issue #39 acceptance criteria at the generator level: every answer type,
realistic and varied qualitative text, conditional follow-ups that agree with their
parents, determinism, the existing planted defects, and that the planted themes,
emerging topics, perspective shift and barrier/access correlation are detectable in the
stored answers alone (see docs/synthetic-insight-data.md).
"""
from __future__ import annotations

import json
import sys
import unittest
from collections import Counter, defaultdict
from datetime import date, datetime
from functools import lru_cache
from pathlib import Path

SEED = Path(__file__).resolve().parents[1] / "seed"
sys.path.insert(0, str(SEED))
import insights  # noqa: E402
import themes  # noqa: E402
from questions import ACCESS_OPTIONS, BY_KEY, CONCEPTS, ORPHAN_PARENT, QTYPES, ext_to_concept, triggered  # noqa: E402

TODAY = insights.TODAY


@lru_cache(maxsize=1)
def data():
    return insights.generate()


def questions():
    return data()[0]


def rows():
    return data()[1]


def open_rows():
    return [r for r in rows() if r["qstn_type"] == "open_text"]


@lru_cache(maxsize=1)
def sentiment_of():
    cells = json.loads((SEED / "corpus" / "qualitative_corpus.json").read_text())["cells"]
    return {e["t"]: e["s"] for entries in cells.values() for e in entries}


@lru_cache(maxsize=1)
def themed_rows():
    """Held-out free-text answers to theme-bearing questions, with the detected topic and age in days."""
    out = []
    for r in open_rows():
        concept, _ = ext_to_concept(r["qstn_ext_id"])
        if concept.theme in ("barrier", "why_low", "why_high") or r["qstn_pid"]:
            continue
        if not themes.is_held_out(r["rspns_txt"]):
            continue
        out.append({"topic": themes.classify(r["rspns_txt"]), "territory": r["territory_id"], "region": r["region_nm"],
                    "age": (TODAY - date.fromisoformat(r["date_of_interaction"])).days, "row": r})
    return out


class CatalogTest(unittest.TestCase):
    def test_four_hundred_questions_span_every_answer_type(self):
        qs = questions()
        self.assertEqual(len(qs), 400)
        self.assertEqual(len({q["qstn_ext_id"] for q in qs}), 400)
        types = Counter(q["qstn_type"] for q in qs)
        self.assertEqual(set(types), set(QTYPES))
        self.assertEqual(len(QTYPES), 9)
        for qtype, n in types.items():
            self.assertGreaterEqual(n, 8, qtype)

    def test_catalog_metadata_is_filled_and_varied(self):
        qs = questions()
        self.assertGreaterEqual(len({q["survey_type"] for q in qs}), 3)
        self.assertGreaterEqual(len({q["report_tag"] for q in qs}), 12)
        self.assertTrue(all(q["qstn_txt"] and q["molecule_type"] and q["study_name"] for q in qs))
        for q in qs:
            self.assertNotIn("{", q["qstn_txt"])

    def test_follow_up_catalog_structure(self):
        qs = {q["qstn_ext_id"]: q for q in questions()}
        children = [q for q in qs.values() if q["qstn_pid"]]
        self.assertEqual(len(children), 39 * 4)
        orphans = [q for q in children if q["qstn_pid"] not in qs]
        self.assertEqual([q["qstn_ext_id"] for q in orphans], ["Q-0100"])
        self.assertEqual(orphans[0]["qstn_pid"], ORPHAN_PARENT)
        for q in children:
            if q["qstn_pid"] in qs:
                self.assertEqual(ext_to_concept(q["qstn_pid"])[1], ext_to_concept(q["qstn_ext_id"])[1], "child and parent are for the same program")
                self.assertIsNotNone(qs[q["qstn_pid"]]["follow_up_qstn_tag"])
        types = {q["qstn_type"] for q in children}
        self.assertTrue({"open_text", "single_choice", "yes_no", "numeric"} <= types)


class AnswerTest(unittest.TestCase):
    def test_every_answer_matches_its_question_type(self):
        for r in rows():
            concept, program = ext_to_concept(r["qstn_ext_id"])
            a, kind = r["rspns_txt"], r["qstn_type"]
            self.assertEqual(kind, concept.qtype)
            self.assertIsInstance(a, str)
            self.assertTrue(a.strip(), r["qstn_ext_id"])
            if kind == "yes_no":
                self.assertIn(a, {"Yes", "No", "Unsure"})
            elif kind == "likert_5":
                self.assertIn(a, {"1", "2", "3", "4", "5"})
            elif kind == "rating_0_10":
                self.assertIn(int(a), range(11))
            elif kind == "numeric":
                p = concept.p
                self.assertTrue(p["lo"] <= int(a) <= p["hi"], (r["qstn_ext_id"], a))
            elif kind == "date":
                date.fromisoformat(a)
            elif kind == "single_choice":
                self.assertIn(a, concept.options)
            elif kind == "multi_select":
                picked = a.split(";")
                self.assertTrue(set(picked) <= set(concept.options) and len(picked) == len(set(picked)))
            elif kind == "ranking":
                self.assertEqual(sorted(a.split(" > ")), sorted(concept.options))

    def test_derived_text_for_scaled_answers(self):
        for r in rows():
            if r["qstn_type"] in ("likert_5", "rating_0_10"):
                self.assertTrue(r["derived_rspns_text"])
            else:
                self.assertIsNone(r["derived_rspns_text"])

    def test_structured_answers_show_real_variety(self):
        by_q = defaultdict(Counter)
        for r in rows():
            if r["qstn_type"] in ("single_choice", "yes_no", "likert_5", "rating_0_10"):
                by_q[r["qstn_ext_id"]][r["rspns_txt"]] += 1
        for qid_, counter in by_q.items():
            n = sum(counter.values())
            if n >= 100:
                self.assertGreaterEqual(len(counter), 3, qid_)
                self.assertLess(counter.most_common(1)[0][1] / n, 0.8, qid_)


class QualitativeTest(unittest.TestCase):
    def test_at_least_2000_distinct_answers_none_repeated_often(self):
        texts = Counter(r["rspns_txt"] for r in open_rows())
        self.assertGreaterEqual(len(texts), 2000)
        self.assertLessEqual(max(texts.values()), 4)
        self.assertGreaterEqual(len(open_rows()), 8000)

    def test_field_note_voice_lengths_from_one_line_to_a_paragraph(self):
        lengths = sorted(len(r["rspns_txt"].split()) for r in open_rows())
        self.assertLessEqual(lengths[len(lengths) // 20], 12, "5th percentile is a one-liner")
        self.assertGreaterEqual(lengths[-len(lengths) // 20], 55, "95th percentile is a paragraph")
        texts = [r["rspns_txt"] for r in open_rows()]
        self.assertGreater(sum(1 for t in texts if any(w in t for w in ("pt", "PA", "PFS", "f/u", "tx"))), 500, "abbreviations")
        self.assertGreater(sum(1 for t in texts if any(w in t.lower() for w in ("not sure", "i think", "probably", "seems", "maybe"))), 500, "hedging")
        senti = Counter(sentiment_of()[t] for t in set(texts))
        self.assertTrue(all(senti[s] > 300 for s in ("pos", "neu", "neg")), senti)

    def test_fixture_holds_only_text_and_a_model_name(self):
        raw = (SEED / "corpus" / "qualitative_corpus.json").read_text()
        fixture = json.loads(raw)
        self.assertEqual(set(fixture), {"model", "cells"})
        self.assertNotIn("sk-ant", raw)
        self.assertNotIn("@", raw)
        self.assertGreaterEqual(len({e["t"] for v in fixture["cells"].values() for e in v}), 3000)


class FollowUpTest(unittest.TestCase):
    def test_hcp_question_and_answer_sets_are_unique(self):
        by_hcp = defaultdict(list)
        for r in rows():
            by_hcp[r["cust_mdm_id"]].append((r["qstn_ext_id"], r["rspns_txt"]))
        signatures = Counter(tuple(sorted(items)) for items in by_hcp.values())
        self.assertEqual(len(by_hcp), insights.N_HCPS)
        self.assertEqual(len(signatures), insights.N_HCPS, "no two HCPs share a complete Q&A signature")

    def test_follow_up_depth_distribution_is_mostly_nine_or_more(self):
        by_inter = defaultdict(list)
        for r in rows():
            by_inter[r["insight_intrctn_dtl_sfdc_id"]].append(r)

        depths = Counter()
        for inter in by_inter.values():
            by_question = {r["qstn_ext_id"]: r for r in inter}
            children = defaultdict(list)
            for r in inter:
                if r["qstn_pid"] in by_question:
                    children[r["qstn_pid"]].append(r["qstn_ext_id"])

            def depth(question_id):
                return 1 + max((depth(child) for child in children[question_id]), default=0)

            # A root is any response whose catalog parent is not present here.
            roots = [qid for qid, r in by_question.items() if r["qstn_pid"] not in by_question]
            depths[max((depth(qid) for qid in roots), default=1)] += 1

        total = sum(depths.values())
        deep = sum(count for level, count in depths.items() if level >= 9)
        report = f"depth distribution: {dict(sorted(depths.items()))}"
        self.assertGreater(total, 5000, report)
        self.assertGreater(deep / total, 0.50, report)
        self.assertGreater(sum(count for level, count in depths.items() if level >= 12), 100, report)

    def test_follow_ups_exist_only_inside_the_parents_interaction(self):
        by_inter = defaultdict(list)
        for r in rows():
            by_inter[r["insight_intrctn_dtl_sfdc_id"]].append(r)
        checked = 0
        for inter in by_inter.values():
            self.assertEqual(len({(r["cust_mdm_id"], r["date_of_interaction"], r["territory_id"]) for r in inter}), 1, "an interaction is one HCP on one day")
            by_ext = defaultdict(list)
            for r in inter:
                by_ext[r["qstn_ext_id"]].append(r)
            for r in inter:
                if r["qstn_pid"] and r["qstn_pid"] != ORPHAN_PARENT:
                    parents = by_ext.get(r["qstn_pid"], [])
                    self.assertEqual(len(parents), 1, "a follow-up never floats free of its parent answer")
                    concept, _ = ext_to_concept(r["qstn_ext_id"])
                    self.assertTrue(triggered(concept, parents[0]["rspns_txt"]), (r["qstn_ext_id"], parents[0]["rspns_txt"]))
                    checked += 1
                if r["followup_qid"]:
                    kids = [k for k in by_ext.get(r["followup_qid"], []) if k["qstn_pid"] == r["qstn_ext_id"]]
                    self.assertEqual(len(kids), 1)
                    self.assertEqual(kids[0]["rspns_txt"], r["followup_rspns"])
                    self.assertEqual(kids[0]["qstn_txt"], r["followup_qstn"])
                    self.assertTrue(r["follow_up_qstn_tag"])
                else:
                    self.assertIsNone(r["followup_rspns"])
                    self.assertIsNone(r["followup_qstn"])
                    self.assertIsNone(r["follow_up_qstn_tag"])
            # Conversely: every answer that triggers a follow-up concept has that follow-up row.
            for r in inter:
                concept, program = ext_to_concept(r["qstn_ext_id"])
                for child in (c for c in CONCEPTS if c.parent == concept.key):
                    if child.key == "fu_start_barrier":
                        continue
                    if triggered(child, r["rspns_txt"]):
                        qid_ = f"Q-{CONCEPTS.index(child) * 4 + program + 1:04}"
                        self.assertTrue(any(k["qstn_pid"] == r["qstn_ext_id"] for k in by_ext.get(qid_, [])), (r["qstn_ext_id"], qid_))
        self.assertGreater(checked, 8000)

    def test_conditional_examples_from_the_ticket(self):
        by_inter = defaultdict(dict)
        for r in rows():
            by_inter[r["insight_intrctn_dtl_sfdc_id"]][r["qstn_ext_id"]] = r
        no_barrier = yes_barrier = 0
        for inter in by_inter.values():
            for ext, r in inter.items():
                concept, program = ext_to_concept(ext)
                if concept.key == "started_recently":
                    barrier = f"Q-{CONCEPTS.index(BY_KEY['fu_main_barrier']) * 4 + program + 1:04}"
                    if r["rspns_txt"] in ("No", "Unsure"):
                        no_barrier += barrier in inter
                    else:
                        yes_barrier += barrier in inter
        self.assertGreater(no_barrier, 300)
        self.assertEqual(yes_barrier, 0, "a Yes never triggers 'What is the main barrier?'")

    def test_orphan_followup_is_answered_without_a_parent(self):
        orphans = [r for r in rows() if r["qstn_pid"] == ORPHAN_PARENT]
        self.assertGreater(len(orphans), 50)
        self.assertEqual({r["qstn_ext_id"] for r in orphans}, {"Q-0100"})


class DeterminismAndDefectsTest(unittest.TestCase):
    def test_generator_is_deterministic(self):
        again = insights.response_rows()
        self.assertEqual(again, rows())
        self.assertEqual(insights.question_rows(), questions())

    def test_existing_planted_defects_and_volume_survive(self):
        rs = rows()
        self.assertEqual(len(rs), 60000)
        self.assertEqual(len({r["cust_mdm_id"] for r in rs}), 3000)
        dup = Counter(r["uniq_rspns_id"] for r in rs)
        self.assertEqual({k: v for k, v in dup.items() if v > 1}, {"RESP-000001": 2})
        self.assertEqual(sum(1 for r in rs if r["qstn_tag_status"] == "Retired"), 6000)
        self.assertTrue(all(q["qstn_tag_status"] == "Active" for q in questions()))
        self.assertEqual({r["cust_nm"] for r in rs if r["cust_mdm_id"] == "LEGACY-HCP-0001"}, {"Insight directory HCP 0001"})
        self.assertEqual(len({r["territory_id"] for r in rs}), 24)
        self.assertTrue(all(date.fromisoformat(r["date_of_interaction"]) <= TODAY for r in rs))
        self.assertEqual(len({r["insight_intrctn_dtl_sfdc_id"] for r in rs}) > 5000, True)

    def test_hcps_stay_in_one_territory(self):
        seen = defaultdict(set)
        for r in rows():
            seen[r["cust_mdm_id"]].add(r["territory_id"])
        self.assertTrue(all(len(v) == 1 for v in seen.values()))

    def test_response_metadata_agrees_with_the_catalog(self):
        qs = {q["qstn_ext_id"]: q for q in questions()}
        for r in rows():
            q = qs[r["qstn_ext_id"]]
            for col in ("qstn_txt", "qstn_type", "molecule_type", "survey_type", "study_name", "qstn_pid"):
                self.assertEqual(r[col], q[col], col)


class PlantedSignalTest(unittest.TestCase):
    def test_detector_is_accurate_on_text_it_has_not_seen(self):
        self.assertGreater(themes.held_out_accuracy(), 0.7)

    def test_eight_to_twelve_themes_with_different_sizes_by_region_and_territory(self):
        topical = [t for t in themed_rows() if t["topic"] in themes.THEMES]
        overall = Counter(t["topic"] for t in topical)
        total = sum(overall.values())
        self.assertEqual(len(themes.THEMES), 10)
        self.assertGreaterEqual(sum(1 for v in overall.values() if v / total >= 0.04), 8)
        by_region = defaultdict(Counter)
        by_territory = defaultdict(Counter)
        for t in topical:
            by_region[t["region"]][t["topic"]] += 1
            by_territory[t["territory"]][t["topic"]] += 1

        def share(counter, theme):
            return counter[theme] / sum(counter.values())

        self.assertEqual(by_region["REGION-02"].most_common(1)[0][0], "access")
        self.assertGreater(share(by_region["REGION-02"], "access"), 1.5 * share(by_region["REGION-01"], "access"))
        self.assertGreater(share(by_region["REGION-01"], "trial_design"), 1.4 * share(by_region["REGION-02"], "trial_design"))
        self.assertGreater(share(by_region["REGION-03"], "guidelines"), 1.4 * share(by_region["REGION-02"], "guidelines"))
        self.assertGreater(share(by_region["REGION-04"], "competitor"), 1.4 * share(by_region["REGION-03"], "competitor"))
        # Territory spikes sit above their region's average for that theme.
        self.assertGreater(share(by_territory["T02-03"], "access"), 1.25 * share(by_region["REGION-02"], "access"))
        self.assertGreater(share(by_territory["T03-05"], "guidelines"), 1.3 * share(by_region["REGION-03"], "guidelines"))
        sizes = [share(c, "access") for c in by_territory.values()]
        self.assertGreater(max(sizes), 2.0 * min(sizes), "theme size varies a lot across the 24 territories")

    def test_emerging_topics_grow_over_the_last_90_days(self):
        rows_ = themed_rows()

        def rate(topic, lo, hi):
            window = [t for t in rows_ if lo <= t["age"] < hi]
            return sum(1 for t in window if t["topic"] == topic) / len(window)

        for topic in themes.EMERGING:
            early, m3, m2, m1 = rate(topic, 91, 271), rate(topic, 60, 90), rate(topic, 30, 60), rate(topic, 0, 30)
            self.assertLess(m3, m2 + 0.02, topic)
            self.assertLess(m2, m1, topic)
            self.assertGreater(m1, 3 * max(early, 0.01), topic)
            self.assertGreater(m1, 0.08, topic)

    def test_perspective_shift_for_the_tracker_panel(self):
        panel, control = defaultdict(list), defaultdict(list)
        waves = defaultdict(dict)
        for r in rows():
            concept, _ = ext_to_concept(r["qstn_ext_id"])
            if concept.key != "tracker_confidence":
                continue
            hcp = next(h for h in insights.hcps() if h.mdm_id == r["cust_mdm_id"])
            age = (TODAY - date.fromisoformat(r["date_of_interaction"])).days
            wave = next((i for i, (old, new) in enumerate(insights.WAVE_DAYS_AGO) if new <= age <= old), None)
            if hcp.panel and wave is not None:
                panel[wave].append(int(r["rspns_txt"]))
                waves[(hcp.index, r["qstn_ext_id"])][wave] = int(r["rspns_txt"])
            elif not hcp.panel:
                control[wave].append(int(r["rspns_txt"]))
        mean = lambda xs: sum(xs) / len(xs)  # noqa: E731
        self.assertGreaterEqual(len({k[0] for k in waves}), 150, "the same HCPs answer in every wave")
        self.assertTrue(all(set(v) == {0, 1, 2} for v in waves.values()), "same question, three waves, same HCP")
        self.assertLess(mean(panel[0]) + 0.7, mean(panel[1]))
        self.assertLess(mean(panel[1]) + 0.5, mean(panel[2]))
        self.assertGreater(mean(panel[2]) - mean(panel[0]), 1.4)
        control_all = [x for v in control.values() for x in v]
        self.assertLess(abs(mean([x for k, v in control.items() if k is not None for x in v]) - mean(control_all)), 0.2)
        # Same panel HCPs, free text: negative notes give way to positive ones.
        sentiment = defaultdict(Counter)
        for r in rows():
            concept, _ = ext_to_concept(r["qstn_ext_id"])
            if concept.key == "tracker_view":
                hcp = next(h for h in insights.hcps() if h.mdm_id == r["cust_mdm_id"])
                age = (TODAY - date.fromisoformat(r["date_of_interaction"])).days
                wave = next((i for i, (old, new) in enumerate(insights.WAVE_DAYS_AGO) if new <= age <= old), None)
                if hcp.panel and wave is not None:
                    sentiment[wave][sentiment_of()[r["rspns_txt"]]] += 1
        neg = [sentiment[w]["neg"] / sum(sentiment[w].values()) for w in range(3)]
        pos = [sentiment[w]["pos"] / sum(sentiment[w].values()) for w in range(3)]
        self.assertGreater(neg[0], neg[1] + 0.15)
        self.assertGreater(neg[1], neg[2] + 0.1)
        self.assertGreater(pos[2], pos[0] + 0.3)

    def test_barrier_answers_correlate_with_access_themed_text(self):
        by_inter = defaultdict(list)
        for r in rows():
            by_inter[r["insight_intrctn_dtl_sfdc_id"]].append(r)
        topic_of = {id(t["row"]): t["topic"] for t in themed_rows()}
        hit = {True: [0, 0], False: [0, 0]}
        barrier_keys = {"fu_main_barrier", "fu_access_barrier", "rank_barriers", "payer_experience", "fu_denial_reason"}
        for inter in by_inter.values():
            barrier = None
            for r in inter:
                concept, _ = ext_to_concept(r["qstn_ext_id"])
                if concept.key in barrier_keys:
                    first = r["rspns_txt"].split(" > ")[0]
                    barrier = first in ACCESS_OPTIONS or barrier is True
            if barrier is None:
                continue
            for r in inter:
                if id(r) in topic_of:
                    hit[barrier][0] += topic_of[id(r)] == "access"
                    hit[barrier][1] += 1
        rate = {k: v[0] / v[1] for k, v in hit.items()}
        self.assertGreater(hit[True][1], 150)
        self.assertGreater(rate[True], 1.6 * rate[False], rate)


if __name__ == "__main__":
    unittest.main()
