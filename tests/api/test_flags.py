"""Flag an incorrect summary, identifier or territory assignment, and see its review status.

Flags are stored in FE DynamoDB. The tests act through the AppSync API as seeded personas;
the FE and BE accounts are inspected directly only to prove where the data landed and to
play the reviewer who changes a flag's status (the review workflow itself is a later ticket).
"""

from __future__ import annotations

import datetime as dt
import json
import re

import pytest

from harness import Persona, _client, be_lambda_logs, graphql

FLAG = """
mutation Flag($input: FlagInput!) {
  flagIssue(input: $input) { flagId kind targetType targetId note status createdAt updatedAt scopeLabel dataThrough }
}
"""
MY_FLAGS = "query { myFlags { flagId kind targetType targetId note status createdAt updatedAt } }"
TABLE = "a2g-feedback-flags"
FE, BE = "111111111111", "222222222222"


def fe_table():
    return _client("dynamodb", FE)


def items_for(user_id: str) -> list[dict]:
    out = fe_table().query(
        TableName=TABLE,
        KeyConditionExpression="pk = :pk",
        ExpressionAttributeValues={":pk": {"S": f"USER#{user_id}"}},
    )
    return out["Items"]


def clear(user_id: str) -> None:
    for item in items_for(user_id):
        fe_table().delete_item(TableName=TABLE, Key={"pk": item["pk"], "sk": item["sk"]})


@pytest.fixture(autouse=True)
def clean_flags():
    users = ("msl-t01-01", "msl-t02-01", "director-region-01")
    for u in users:
        clear(u)
    yield
    for u in users:
        clear(u)


def own_hcp(db, territory="T01-01") -> str:
    return db.execute("SELECT cust_mdm_id FROM call_activity WHERE territory_id = %s LIMIT 1", (territory,)).fetchone()[0]


def own_call(db, territory="T01-01") -> str:
    return db.execute("SELECT crm_call_id FROM call_activity WHERE territory_id = %s LIMIT 1", (territory,)).fetchone()[0]


def raise_flag(persona: Persona, **fields):
    return persona.query(FLAG, {"input": fields})


def test_flag_is_stored_in_fe_dynamodb_with_open_status(msl, db):
    hcp = own_hcp(db)
    res = raise_flag(msl, kind="IDENTIFIER", targetType="HCP", targetId=hcp, note="NPI looks wrong")
    assert not res.errors, res.errors
    flag = res.data["flagIssue"]
    assert flag["status"] == "OPEN"
    assert (flag["kind"], flag["targetType"], flag["targetId"], flag["note"]) == ("IDENTIFIER", "HCP", hcp, "NPI looks wrong")
    assert flag["scopeLabel"] == "T01-01" and flag["dataThrough"], "flags carry scope and data-through like saved outputs"
    assert flag["createdAt"] == flag["updatedAt"]

    (item,) = items_for("msl-t01-01")
    assert item["flagId"]["S"] == flag["flagId"] and item["status"]["S"] == "OPEN"
    assert item["userId"]["S"] == "msl-t01-01" and item["targetId"]["S"] == hcp
    # Operational state belongs to the FE account: the BE account has no such table.
    assert TABLE not in _client("dynamodb", BE).list_tables()["TableNames"]


def test_flags_list_shows_review_status_as_it_changes(msl, db):
    flag_id = raise_flag(msl, kind="TERRITORY_ASSIGNMENT", targetType="CALL", targetId=own_call(db)).data["flagIssue"]["flagId"]
    (mine,) = msl.query(MY_FLAGS).data["myFlags"]
    assert (mine["flagId"], mine["status"]) == (flag_id, "OPEN")

    (item,) = items_for("msl-t01-01")
    for status in ("IN_REVIEW", "RESOLVED", "DISMISSED"):
        fe_table().update_item(
            TableName=TABLE,
            Key={"pk": item["pk"], "sk": item["sk"]},
            UpdateExpression="SET #s = :s, updatedAt = :u",
            ExpressionAttributeNames={"#s": "status"},
            ExpressionAttributeValues={":s": {"S": status}, ":u": {"S": dt.datetime.now(dt.UTC).isoformat().replace("+00:00", "Z")}},
        )
        (seen,) = msl.query(MY_FLAGS).data["myFlags"]
        assert seen["status"] == status
        assert seen["updatedAt"] >= seen["createdAt"]


@pytest.mark.parametrize(
    "kind,target_type,target",
    [
        ("SUMMARY", "SUMMARY", "brief:2026-11-03:HCP-0001"),
        ("IDENTIFIER", "HCP", "HCP"),
        ("IDENTIFIER", "CALL", "CALL"),
        ("TERRITORY_ASSIGNMENT", "CALL", "CALL"),
        ("TERRITORY_ASSIGNMENT", "HCP", "HCP"),
        ("TERRITORY_ASSIGNMENT", "TERRITORY", "T01-01"),
    ],
)
def test_every_kind_can_be_flagged(msl, db, kind, target_type, target):
    target = {"HCP": own_hcp(db), "CALL": own_call(db)}.get(target, target)
    res = raise_flag(msl, kind=kind, targetType=target_type, targetId=target)
    assert not res.errors, res.errors
    assert res.data["flagIssue"]["status"] == "OPEN" and res.data["flagIssue"]["note"] is None


def test_flagging_the_same_open_item_again_returns_the_same_flag(msl, db):
    hcp = own_hcp(db)
    first = raise_flag(msl, kind="IDENTIFIER", targetType="HCP", targetId=hcp, note="one").data["flagIssue"]
    again = raise_flag(msl, kind="IDENTIFIER", targetType="HCP", targetId=hcp, note="two").data["flagIssue"]
    assert again["flagId"] == first["flagId"]
    assert len(items_for("msl-t01-01")) == 1
    # Once it is resolved, the same item may be flagged again as a new report.
    (item,) = items_for("msl-t01-01")
    fe_table().update_item(
        TableName=TABLE, Key={"pk": item["pk"], "sk": item["sk"]}, UpdateExpression="SET #s = :s",
        ExpressionAttributeNames={"#s": "status"}, ExpressionAttributeValues={":s": {"S": "RESOLVED"}},
    )
    new = raise_flag(msl, kind="IDENTIFIER", targetType="HCP", targetId=hcp).data["flagIssue"]
    assert new["flagId"] != first["flagId"] and new["status"] == "OPEN"
    assert [f["status"] for f in msl.query(MY_FLAGS).data["myFlags"]] == ["OPEN", "RESOLVED"], "newest first"


def test_flags_are_private_to_their_owner(msl, other_msl, db):
    raise_flag(msl, kind="IDENTIFIER", targetType="HCP", targetId=own_hcp(db), note="mine")
    assert other_msl.query(MY_FLAGS).data["myFlags"] == []
    assert Persona.sign_in("director-region-01").query(MY_FLAGS).data["myFlags"] == []
    assert len(msl.query(MY_FLAGS).data["myFlags"]) == 1


def test_a_flag_cannot_target_a_record_outside_the_callers_scope(msl, other_msl, db):
    foreign_hcp = db.execute(
        """SELECT cust_mdm_id FROM call_activity WHERE territory_id = 'T02-01'
           EXCEPT SELECT cust_mdm_id FROM call_activity WHERE territory_id = 'T01-01'
           EXCEPT SELECT cust_mdm_id FROM hcp_raw_insights WHERE territory_id = 'T01-01' LIMIT 1"""
    ).fetchone()[0]
    foreign_call = own_call(db, "T02-01")
    for fields in (
        dict(kind="IDENTIFIER", targetType="HCP", targetId=foreign_hcp),
        dict(kind="IDENTIFIER", targetType="CALL", targetId=foreign_call),
        dict(kind="TERRITORY_ASSIGNMENT", targetType="TERRITORY", targetId="T02-01"),
        dict(kind="TERRITORY_ASSIGNMENT", targetType="CALL", targetId="CALL-DOES-NOT-EXIST"),
    ):
        res = raise_flag(msl, **fields)
        assert "BadRequest" in res.error_types, fields
        assert res.data is None or res.data.get("flagIssue") is None
    assert items_for("msl-t01-01") == [], "a refused flag writes nothing"
    # The same call is fine for the MSL who owns it.
    assert not raise_flag(other_msl, kind="IDENTIFIER", targetType="CALL", targetId=foreign_call).errors


def test_a_director_can_flag_within_their_region_only(db):
    director = Persona.sign_in("director-region-01")
    assert not raise_flag(director, kind="TERRITORY_ASSIGNMENT", targetType="TERRITORY", targetId="T01-03").errors
    outside = db.execute("SELECT DISTINCT territory_id FROM call_activity WHERE territory_id LIKE 'T02-%' LIMIT 1").fetchone()[0]
    assert "BadRequest" in raise_flag(director, kind="TERRITORY_ASSIGNMENT", targetType="TERRITORY", targetId=outside).error_types


@pytest.mark.parametrize(
    "fields",
    [
        dict(kind="SUMMARY", targetType="HCP", targetId="HCP-0001"),
        dict(kind="IDENTIFIER", targetType="TERRITORY", targetId="T01-01"),
        dict(kind="IDENTIFIER", targetType="SUMMARY", targetId="brief:1"),
        dict(kind="SUMMARY", targetType="SUMMARY", targetId=""),
        dict(kind="SUMMARY", targetType="SUMMARY", targetId="has space"),
        dict(kind="SUMMARY", targetType="SUMMARY", targetId="x" * 129),
        dict(kind="SUMMARY", targetType="SUMMARY", targetId="brief:1", note="n" * 501),
    ],
)
def test_malformed_flags_are_rejected(msl, fields):
    res = raise_flag(msl, **fields)
    assert "BadRequest" in res.error_types, res.errors
    assert items_for("msl-t01-01") == []


def test_unknown_enum_values_never_reach_the_store(msl):
    res = raise_flag(msl, kind="DELETE_EVERYTHING", targetType="SUMMARY", targetId="brief:1")
    assert res.errors
    assert items_for("msl-t01-01") == []


def test_flag_owner_comes_from_the_token_not_the_request(msl, db):
    """There is no userId input; forged identity headers change nothing about who owns the flag."""
    res = msl.query(
        FLAG,
        {"input": {"kind": "SUMMARY", "targetType": "SUMMARY", "targetId": "brief:1"}},
        headers={"x-user-full-name": "Mallory Forged", "x-user-email": "mallory@evil.test"},
    )
    assert not res.errors
    assert len(items_for("msl-t01-01")) == 1
    assert clear("msl-t02-01") is None and items_for("msl-t02-01") == []
    bad = msl.query(FLAG, {"input": {"kind": "SUMMARY", "targetType": "SUMMARY", "targetId": "brief:1", "userId": "msl-t02-01"}})
    assert bad.errors, "unknown input fields are rejected by the schema"


def test_flags_need_a_valid_token():
    for token in (None, "garbage"):
        res = graphql(FLAG, {"input": {"kind": "SUMMARY", "targetType": "SUMMARY", "targetId": "brief:1"}}, token=token)
        assert res.status == 401 or any("Unauthorized" in t for t in res.error_types)
    assert graphql(MY_FLAGS).status == 401


def test_the_note_is_never_logged(msl, db):
    note = "zq-private-note-about-dr-someone"
    raise_flag(msl, kind="IDENTIFIER", targetType="HCP", targetId=own_hcp(db), note=note)
    msl.query(MY_FLAGS)
    logs = be_lambda_logs(since="5m")
    lines = [m for m in re.findall(r"\[lambda:a2g-be-api[^\]]*\] (\{\"ts\".*)$", logs, re.MULTILINE) if "flag" in m]
    assert lines, "expected structured flag log lines"
    recs = [json.loads(m) for m in lines]
    assert any(r["msg"] == "flag raised" and r.get("flag_kind") == "IDENTIFIER" for r in recs)
    assert note not in logs and "someone" not in logs
