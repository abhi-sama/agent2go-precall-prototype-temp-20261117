from __future__ import annotations

from datetime import datetime, timezone

from a2g_api import resolvers


class Cursor:
    def __init__(self) -> None:
        self.sql = ""

    def execute(self, sql: str, *_args: object) -> None:
        self.sql = sql

    def fetchall(self) -> list[tuple[object, ...]]:
        return [
            (
                "call-activity", "Call Activity", datetime(2026, 11, 3, 12, 0, tzinfo=timezone.utc),
                datetime(2026, 11, 3, 12, 0, tzinfo=timezone.utc), "run-current", "completed",
                datetime(2026, 11, 3, 8, 0, tzinfo=timezone.utc), datetime(2026, 11, 3, 8, 30, tzinfo=timezone.utc),
                25_000, None,
            ),
            (
                "call-activity", "Call Activity", datetime(2026, 11, 3, 12, 0, tzinfo=timezone.utc),
                datetime(2026, 11, 3, 12, 0, tzinfo=timezone.utc), "run-previous", "completed",
                datetime(2026, 11, 2, 8, 0, tzinfo=timezone.utc), datetime(2026, 11, 2, 8, 28, tzinfo=timezone.utc),
                24_871, None,
            ),
            ("roster", "Medical roster", None, datetime(2026, 11, 3, 12, 0, tzinfo=timezone.utc), None, None, None, None, None, None),
        ]


def test_admin_ingestion_runs_returns_only_source_level_operational_metadata(monkeypatch):
    monkeypatch.setattr(resolvers, "_require_admin", lambda _cur: None)
    cursor = Cursor()

    result = resolvers.admin_ingestion_runs(cursor, None, "admin-01", {})

    assert "row_number() OVER (PARTITION BY r.source_id" in cursor.sql
    assert "run_rank <= 5" in cursor.sql
    assert result == {
        "sources": [
            {
                "sourceId": "call-activity",
                "sourceName": "Call Activity",
                "loadDate": "2026-11-03T12:00:00+00:00",
                "dataThrough": "2026-11-03T12:00:00+00:00",
                "ingestionRuns": [
                    {"runId": "run-current", "sourceId": "call-activity", "sourceName": "Call Activity", "status": "completed", "startedAt": "2026-11-03T08:00:00+00:00", "completedAt": "2026-11-03T08:30:00+00:00", "recordsLoaded": 25_000, "errorSummary": None},
                    {"runId": "run-previous", "sourceId": "call-activity", "sourceName": "Call Activity", "status": "completed", "startedAt": "2026-11-02T08:00:00+00:00", "completedAt": "2026-11-02T08:28:00+00:00", "recordsLoaded": 24_871, "errorSummary": None},
                ],
            },
            {"sourceId": "roster", "sourceName": "Medical roster", "loadDate": None, "dataThrough": "2026-11-03T12:00:00+00:00", "ingestionRuns": []},
        ]
    }
