"""Small-group disclosure, in one place (docs/adr/0009 executive overview, docs/adr/0013 executive themes).

A count between 1 and ``MIN_CELL - 1`` identifies too few people and is withheld; zero identifies nobody and is
shown. Where a total is shown beside its parts, exactly one withheld part could be recovered as the total minus
the others, so the smallest other positive part is withheld as well (complementary suppression).
"""

from __future__ import annotations

from collections.abc import Sequence

MIN_CELL = 5


def is_small(value: int | None, min_cell: int = MIN_CELL) -> bool:
    return value is not None and 0 < value < min_cell


def suppress_flags(
    values: Sequence[int | None], total: int | None, *, additive: bool, min_cell: int = MIN_CELL
) -> tuple[list[bool], bool]:
    """Which values to withhold, and whether the total must be withheld too.

    A value is a small group when ``0 < value < min_cell``. For components that sum to a shown total
    (``additive``), exactly one withheld component could be recovered as total minus the others, so the
    smallest other positive component is withheld as well; with none to withhold, the total goes.
    """
    flags = [is_small(v, min_cell) for v in values]
    total_hidden = is_small(total, min_cell)
    if additive and not total_hidden and sum(flags) == 1:
        candidates = [(v, i) for i, (v, f) in enumerate(zip(values, flags)) if not f and v is not None and v > 0]
        if candidates:
            flags[min(candidates)[1]] = True
        else:
            total_hidden = True
    return flags, total_hidden


def count(value: int | None, hidden: bool) -> dict[str, int | bool | None]:
    """The API shape of a count that may be withheld: a withheld count carries no value at all."""
    return {"value": None if hidden or value is None else int(value), "suppressed": bool(hidden)}


def disclosure_text(min_cell: int = MIN_CELL) -> str:
    return (
        f"Counts below {min_cell} are withheld so no small group can be identified. When one value in a total is "
        "withheld, the next smallest is withheld as well, so it cannot be worked out by subtraction."
    )
