"""BE logs never contain tokens, emails, names or HCP free text, end to end.

Drives real requests that carry all four (token in the Authorization header, forged
name/email headers, seeded names and emails in the token claims, HCP response text in
the rows the queries scan), then reads everything the BE Lambda printed.
"""

from __future__ import annotations

import json
import re

from harness import be_lambda_logs, invoke_be_lambda, seeded_user

# floci prefixes each captured line with its own logger tag and "[lambda:<name>] ".
RECORD = re.compile(r"\[lambda:a2g-be-api[^\]]*\] (\{\"ts\".*)$", re.MULTILINE)


def test_be_logs_hold_no_sensitive_values(msl, db):
    forged = {"x-user-full-name": "Mallory Forged", "x-user-email": "mallory@evil.test"}
    msl.me(headers=forged)
    msl.landing_kpis("2026-01-01", "2026-11-03")
    invoke_be_lambda(
        {"fieldName": "me", "request": {"headers": {"authorization": f"Bearer {msl.id_token}", **forged}}}
    )
    invoke_be_lambda({"fieldName": "me", "request": {"headers": {"authorization": "Bearer not.a.jwt"}}})

    logs = be_lambda_logs(since="5m")
    # Our records are JSON lines; the Lambda runtime adds its own START/END/REPORT lines.
    records = [json.loads(m.group(1)) for m in RECORD.finditer(logs)]
    assert records, "no BE Lambda log lines captured"
    for rec in records:
        assert {"ts", "level", "msg", "correlation_id", "service"} <= rec.keys()

    user = seeded_user("msl-t01-01")
    hcp_text = [r[0] for r in db.execute("SELECT DISTINCT rspns_txt FROM hcp_raw_insights WHERE territory_id = 'T01-01' LIMIT 20")]
    hcp_names = [r[0] for r in db.execute("SELECT DISTINCT cust_full_nm FROM call_activity WHERE territory_id = 'T01-01' LIMIT 20")]
    secrets = [
        msl.id_token,
        msl.id_token.split(".")[1],
        msl.tokens["AccessToken"],
        user["email"],
        user["full_name"],
        "mallory@evil.test",
        "Mallory Forged",
        *hcp_text,
        *hcp_names,
    ]
    for secret in secrets:
        assert secret and secret not in logs, f"sensitive value leaked into BE logs: {secret[:12]}..."
    assert "@" not in logs
