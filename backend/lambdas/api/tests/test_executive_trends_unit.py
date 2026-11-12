"""Pure rules of the Executive trends view: complementary withholding across both cuts of the region-by-month table."""

from __future__ import annotations

import datetime as dt

from a2g_api import executive_trends as et

M = [dt.date(2026, 8, 1), dt.date(2026, 9, 1), dt.date(2026, 10, 1)]


def table(rows: dict[str, list[int]]):
    """cells and totals for {region: [calls per month]} with responses equal to calls and HCPs half of calls."""
    cells = {(r, m): (v, v, v // 2) for r, vs in rows.items() for m, v in zip(M, vs)}
    region_totals = {r: (sum(vs),) * 2 + (sum(vs) // 2,) for r, vs in rows.items()}
    month_totals = {m: (sum(vs[i] for vs in rows.values()),) * 2 + (sum(vs[i] for vs in rows.values()) // 2,) for i, m in enumerate(M)}
    return list(rows), cells, region_totals, month_totals


def test_nothing_is_withheld_when_every_cell_is_a_large_group():
    regions, cells, rt, mt = table({"R1": [40, 50, 60], "R2": [30, 35, 45]})
    flags = et.withheld_cells(regions, M, cells, rt, mt)
    assert not any(any(f) for f in flags.values())


def test_a_small_cell_is_withheld_and_so_is_the_next_smallest_in_its_row_and_its_column():
    regions, cells, rt, mt = table({"R1": [40, 3, 60], "R2": [30, 35, 45]})
    flags = et.withheld_cells(regions, M, cells, rt, mt)
    calls = {k: v[0] for k, v in flags.items()}
    assert calls[("R1", M[1])] is True
    # Row cut: the smallest other cell of R1 (40) goes too; column cut: the smallest other cell of September (35) goes too.
    assert calls[("R1", M[0])] is True and calls[("R2", M[1])] is True
    # No row or column is left with exactly one withheld cell that a total would give away.
    for r in regions:
        assert sum(calls[(r, m)] for m in M) != 1
    for m in M:
        assert sum(calls[(r, m)] for r in regions) != 1


def test_zero_identifies_nobody_and_is_shown():
    regions, cells, rt, mt = table({"R1": [0, 0, 60], "R2": [30, 35, 45]})
    flags = et.withheld_cells(regions, M, cells, rt, mt)
    assert not any(flags[("R1", m)][0] for m in M[:2])


def test_engaged_hcps_are_withheld_with_their_calls_and_when_themselves_small():
    cells = {("R1", M[0]): (12, 12, 3), ("R1", M[1]): (3, 3, 2), ("R1", M[2]): (60, 60, 30)}
    flags = et.withheld_cells(["R1"], M, cells, {"R1": (75, 75, 35)}, {M[0]: (12, 12, 3), M[1]: (3, 3, 2), M[2]: (60, 60, 30)})
    assert flags[("R1", M[0])][2] is True  # three HCPs: a small group on its own
    assert flags[("R1", M[1])] == (True, True, True)  # its calls are withheld, so are its HCPs


def test_the_rule_is_stated_in_the_thresholds_the_database_holds():
    assert et.TREND_DAYS == 90
