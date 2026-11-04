"""Pure hierarchy-graph validation: cycles, orphans, missing links, overlaps, inheritance."""

from __future__ import annotations

from a2g_api import hierarchy_graph as g


def _analyze(pairs, universe=(), holders=(), source=None, parentless=(), duplicates=()):
    scope = set(pairs)
    source_pairs = scope if source is None else set(source)
    edges = g.merge_edges(scope, source_pairs, {})
    return g.analyze(edges, set(universe), {}, list(holders), source_pairs, scope, set(parentless), set(duplicates))


def codes(analysis, severity=None):
    return sorted((f.code, tuple(f.territory_ids)) for f in analysis.findings if severity in (None, f.severity))


def test_clean_tree_has_no_findings_and_depths():
    a = _analyze([("T1", "R1"), ("T2", "R1")], holders=[g.Holder("m1", "M1", "primary", "T1"), g.Holder("m2", "M2", "primary", "T2")])
    assert a.findings == []
    assert a.nodes["R1"]["kind"] == "REGION" and a.nodes["R1"]["depth"] == 0
    assert a.nodes["T1"]["depth"] == 1 and a.nodes["T1"]["parentIds"] == ["R1"]


def test_cycle_is_reported_as_a_closed_path():
    a = _analyze([("A", "B"), ("B", "C"), ("C", "A"), ("D", "R")], holders=[g.Holder("m", "M", "primary", "D")])
    cycle = [f for f in a.findings if f.code == "CYCLE"]
    assert len(cycle) == 1
    assert cycle[0].territory_ids == ["A", "B", "C"]
    assert cycle[0].severity == g.ERROR
    assert cycle[0].message in ("Cycle: A → B → C → A",)
    assert a.nodes["A"]["depth"] is None  # no root reaches a cycle


def test_two_node_cycle_and_self_loop():
    assert [f.territory_ids for f in _analyze([("A", "B"), ("B", "A")]).findings if f.code == "CYCLE"] == [["A", "B"]]
    assert [f.territory_ids for f in _analyze([("A", "A")]).findings if f.code == "CYCLE"] == [["A"]]


def test_diamond_is_an_overlap_not_a_cycle():
    a = _analyze([("L", "X"), ("L", "Y"), ("X", "R"), ("Y", "R")], holders=[g.Holder("m", "M", "primary", "L")])
    assert [f.code for f in a.findings] == ["OVERLAP"]
    assert a.findings[0].severity == g.WARNING and a.findings[0].territory_ids == ["L", "X", "Y"]


def test_orphan_territory_is_one_in_use_with_no_links_even_when_assigned():
    a = _analyze([("T1", "R1")], universe={"T1", "R1", "LOST"}, holders=[g.Holder("m", "M", "primary", "T1"), g.Holder("x", "X", "temporary", "LOST")])
    orphan = [f for f in a.findings if f.code == "ORPHAN_TERRITORY"]
    assert [f.territory_ids for f in orphan] == [["LOST"]]
    assert "assigned to 1 user" in orphan[0].message
    assert orphan[0].severity == g.ERROR


def test_missing_links_between_source_feed_and_versioned_relationships():
    a = _analyze([("T1", "R1"), ("T2", "R1")], source=[("T1", "R1"), ("T3", "R1")], parentless=["T4"])
    errors = codes(a, g.ERROR)
    assert ("MISSING_LINK", ("T3", "R1")) in errors  # source link without a versioned relationship
    assert ("MISSING_LINK", ("T4",)) in errors  # source row with no parent
    assert ("MISSING_LINK", ("T2", "R1")) in codes(a, g.WARNING)  # versioned link absent from the feed


def test_inheritance_flows_down_and_survives_cycles():
    a = _analyze([("T1", "R1"), ("R1", "N")], holders=[g.Holder("dir", "Dir", "primary", "R1"), g.Holder("exec", "Exec", "executive", "N")])
    inherited = {(h["userId"], h["viaTerritoryId"]) for h in a.nodes["T1"]["inheritedHolders"]}
    assert inherited == {("dir", "R1"), ("exec", "N")}
    assert a.nodes["T1"]["directHolders"] == []
    cyclic = _analyze([("A", "B"), ("B", "A")], holders=[g.Holder("m", "M", "primary", "A")])
    assert {h["viaTerritoryId"] for h in cyclic.nodes["B"]["inheritedHolders"]} == {"A"}


def test_uncovered_leaf_territory_is_flagged():
    a = _analyze([("T1", "R1"), ("T2", "R1")], holders=[g.Holder("m", "M", "primary", "T1")])
    assert [(f.code, f.territory_ids) for f in a.findings] == [("UNCOVERED_TERRITORY", ["T2"])]


def test_deep_hierarchy_does_not_hit_the_recursion_limit():
    chain = [(f"N{i}", f"N{i + 1}") for i in range(5000)]
    assert g.find_cycles([g.Edge(c, p, "both") for c, p in chain]) == []
    assert len(g.find_cycles([g.Edge(c, p, "both") for c, p in [*chain, ("N5000", "N0")]])) == 1


def test_windows_overlap_is_half_open():
    from datetime import datetime, timedelta

    t = datetime(2026, 1, 1)
    day = timedelta(days=1)
    assert g.windows_overlap(t, t + day, t + day, None) is False  # back to back, e.g. a transfer
    assert g.windows_overlap(t, None, t + day, t + 2 * day) is True
