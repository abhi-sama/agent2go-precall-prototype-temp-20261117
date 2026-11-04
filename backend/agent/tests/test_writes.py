"""The narrow write tool: item shape (ADR 0005) and graceful failure."""

from __future__ import annotations

import datetime as dt
from typing import Any

from conftest import make_invocation

from msl_agent import writes
from msl_agent.schemas import Citation, Fact
from msl_agent.writes import ConversationTurn, DynamoConversationWriter, item_for


def turn() -> ConversationTurn:
    inv = make_invocation()
    return ConversationTurn(
        identity=inv.identity,
        thread_id=inv.thread_id,
        run_id="run-1",
        user_message="How many calls?",
        assistant_text="Two.",
        facts=[Fact(fact_id="f1", label="Distinct calls", value=2, unit="calls", period="p", scope="s")],
        citations=[Citation(record_id="CALL-1", dataset="call_activity", label="Call")],
        scope_territory_ids=["T01-01"],
        data_through=dt.datetime(2026, 11, 3, 12, tzinfo=dt.UTC),
    )


def test_item_is_keyed_to_the_user_and_carries_provenance() -> None:
    item = item_for(turn(), now=dt.datetime(2026, 11, 3, 13, 0, 5, tzinfo=dt.UTC))
    assert item["pk"] == "USER#msl-t01-01"
    assert item["sk"] == "THREAD#thread-123#2026-11-03T13:00:05+00:00#run-1"
    assert item["owner_user_id"] == "msl-t01-01"
    assert item["scope_territory_ids"] == ["T01-01"]
    assert item["data_through"].startswith("2026-11-03")
    assert item["evidence"][0]["record_id"] == "CALL-1"
    assert item["facts"][0]["value"] == 2
    assert item["generated_at"] and item["expires_at"] > 0


class FakeSts:
    def assume_role(self, **kwargs: Any) -> dict[str, Any]:
        assert kwargs["RoleArn"].endswith(":role/writer")
        return {
            "Credentials": {
                "AccessKeyId": "A",
                "SecretAccessKey": "S",
                "SessionToken": "T",
                "Expiration": dt.datetime.now(dt.UTC) + dt.timedelta(minutes=15),
            }
        }


class FakeDynamo:
    def __init__(self, fail: bool = False) -> None:
        self.puts: list[dict[str, Any]] = []
        self.fail = fail

    def put_item(self, **kwargs: Any) -> None:
        if self.fail:
            raise RuntimeError("row value leaked: Avery Clinician")
        self.puts.append(kwargs)


def test_writer_assumes_the_role_and_puts_with_a_no_overwrite_condition(monkeypatch) -> None:
    dynamo = FakeDynamo()
    monkeypatch.setattr(writes.boto3, "client", lambda svc, **kw: FakeSts() if svc == "sts" else dynamo)
    writer = DynamoConversationWriter(
        role_arn="arn:aws:iam::111111111111:role/writer", table="turns", region="us-east-1"
    )
    assert writer.save_turn(turn()) is True
    [put] = dynamo.puts
    assert put["TableName"] == "turns"
    assert put["Item"]["pk"] == {"S": "USER#msl-t01-01"}
    assert put["ConditionExpression"] == "attribute_not_exists(pk)"


def test_a_failed_write_never_raises_or_logs_row_values(monkeypatch, capsys) -> None:
    monkeypatch.setattr(
        writes.boto3, "client", lambda svc, **kw: FakeSts() if svc == "sts" else FakeDynamo(fail=True)
    )
    writer = DynamoConversationWriter(
        role_arn="arn:aws:iam::111111111111:role/writer", table="turns", region="us-east-1"
    )
    assert writer.save_turn(turn()) is False
    out = capsys.readouterr()
    assert "Avery" not in out.out + out.err
