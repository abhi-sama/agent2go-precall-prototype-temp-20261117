from __future__ import annotations

import pytest

from a2g_api import post_call
from a2g_api.errors import BadRequest


def test_draft_lines_are_lossless_observations_from_entered_notes():
    notes = "HCP asked about evidence.\n\nFollow up next week."
    preserved, lines = post_call._notes(notes)
    assert preserved == notes
    assert lines == ["HCP asked about evidence.", "Follow up next week."]
    assert all(line in notes for line in lines)


@pytest.mark.parametrize("notes", ["", " \n \n ", None, "x" * 8_001])
def test_draft_rejects_missing_or_oversized_notes(notes):
    with pytest.raises(BadRequest):
        post_call._notes(notes)


def test_confirmation_requires_at_least_one_explicit_task_input():
    class Cursor:
        def execute(self, *_args, **_kwargs):
            raise AssertionError("no SQL may run before explicit task input")

    identity = type("Identity", (), {"persona": "MSL"})()
    with pytest.raises(BadRequest):
        post_call.confirm_follow_up_tasks(Cursor(), identity, "msl-t01-01", {"input": []})
