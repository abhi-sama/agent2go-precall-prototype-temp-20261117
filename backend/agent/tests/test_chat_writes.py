from msl_agent.chat_writes import approved_write, parse_pending_write


def test_write_requests_are_closed_shapes_and_edits_are_revalidated() -> None:
    proposed = parse_pending_write("Save pre-call brief for HCP-123: Discuss trial eligibility")
    assert proposed is not None and proposed.kind == "pre_call_brief"
    approved = approved_write(proposed.interrupt("abcdefgh")["metadata"], {"approved": True, "values": {"objective": "Discuss sequencing"}})
    assert approved is not None and approved.values["objective"] == "Discuss sequencing"
    assert approved_write(proposed.interrupt("abcdefgh")["metadata"], {"approved": False}) is None
    assert parse_pending_write("save a pre-call brief for HCP-1") is None


def test_flag_kind_and_target_are_normalized_before_allowlist_check() -> None:
    proposed = parse_pending_write("set feedback flag identifier hcp HCP-123: check identifier")
    assert proposed is not None
    assert proposed.values["kind"] == "IDENTIFIER" and proposed.values["targetType"] == "HCP"
