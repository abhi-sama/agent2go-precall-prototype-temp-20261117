"""MSL Insight response listing stays on the RLS-scoped resolver path."""

from __future__ import annotations

import datetime as dt

import pytest

from a2g_api import resolvers
from a2g_api.errors import Forbidden
from a2g_api.identity import Identity


def identity(persona: str = "msl") -> Identity:
    return Identity("subject", persona, persona.upper(), "", "", "test")


def test_msl_workspace_refuses_other_personas() -> None:
    with pytest.raises(Forbidden):
        resolvers._require_msl(identity("director"))
    resolvers._require_msl(identity())


def test_response_filters_are_fixed_and_parameterized() -> None:
    clauses, params = resolvers._insight_where(
        {"hcpId": "HCP-1'; drop table hcp_raw_insights; --", "molecule": "osimertinib"}
    )
    assert "h.cust_mdm_id = %(hcpId)s" in clauses
    assert "drop table" not in " ".join(clauses)
    assert params["hcpId"].startswith("HCP-1")


class Cursor:
    def __init__(self) -> None:
        self.calls: list[tuple[str, dict[str, object]]] = []
        self._rows = [
            [
                ("17", "RESP-17", "INT-17", dt.date(2026, 10, 20), "HCP-0001", "osimertinib", "Access and reimbursement", "What remains difficult?", "Coverage criteria are unclear."),
            ],
            [("themes", "Access and reimbursement"), ("hcps", "HCP-0001"), ("molecules", "osimertinib")],
        ]

    def execute(self, query: str, params: dict[str, object]) -> None:
        self.calls.append((query, params))

    def fetchall(self):
        return self._rows.pop(0)


def test_response_listing_uses_source_rows_and_never_interpolates_filters(monkeypatch: pytest.MonkeyPatch) -> None:
    cursor = Cursor()
    monkeypatch.setattr(resolvers, "_scope", lambda *_: ([], 1, "T01-01"))
    monkeypatch.setattr(resolvers, "_require_record_access", lambda *_: None)
    monkeypatch.setattr(resolvers, "_data_through", lambda *_: dt.datetime(2026, 11, 3, tzinfo=dt.UTC))
    monkeypatch.setattr(resolvers, "_range", lambda *_: (dt.date(2026, 10, 1), dt.date(2026, 11, 3)))

    result = resolvers.msl_insight_responses(
        cursor, identity(), "msl-t01-01", {"filters": {"hcpId": "HCP-0001", "theme": "Access and reimbursement"}}, default_range_days=90
    )

    assert result["responses"][0]["sourceRecordId"] == "RESP-17"
    assert result["responses"][0]["interactionId"] == "INT-17"
    assert result["options"]["hcps"] == [{"value": "HCP-0001", "label": "HCP-0001"}]
    assert len(cursor.calls) == 2
    assert "source_row_id" in cursor.calls[0][0]
    assert "app.theme_of" in cursor.calls[0][0]
    assert all(params["hcpId"] == "HCP-0001" for _query, params in cursor.calls)
    assert all("HCP-0001" not in query for query, _params in cursor.calls)
