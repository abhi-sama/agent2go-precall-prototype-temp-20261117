"""D1 (#49): a person's style, mode and density are saved per user through Cognito -> AppSync -> BE Lambda -> FE DynamoDB.

No helper writes DynamoDB directly: the assertions use the same persona-authenticated route as the browser.
"""

from __future__ import annotations

MINE = "query Mine { myAppearance { style mode density updatedAt } }"
SET = """
mutation Set($input: AppearanceInput!) {
  setAppearance(input: $input) { style mode density updatedAt }
}
"""
SAVED_VIEWS = "query Saved { savedViews { savedViewId name } }"


def test_a_choice_is_saved_per_user_and_survives_a_new_session(msl, other_msl):
    first = msl.query(SET, {"input": {"style": "clinical", "mode": "black", "density": "compact"}})
    assert not first.errors, first.errors
    assert {k: first.data["setAppearance"][k] for k in ("style", "mode", "density")} == {"style": "clinical", "mode": "black", "density": "compact"}

    again = msl.query(MINE)
    assert not again.errors, again.errors
    assert again.data["myAppearance"] == first.data["setAppearance"]

    # Another person never sees it: they have no choice of their own until they make one.
    theirs = other_msl.query(MINE)
    assert not theirs.errors, theirs.errors
    assert theirs.data["myAppearance"] != first.data["setAppearance"]


def test_the_latest_choice_wins_and_auto_means_use_my_defaults(msl):
    msl.query(SET, {"input": {"style": "clinical", "mode": "black", "density": "compact"}})
    last = msl.query(SET, {"input": {"style": "auto", "mode": "device", "density": "auto"}})
    assert not last.errors, last.errors
    mine = msl.query(MINE)
    assert (mine.data["myAppearance"]["style"], mine.data["myAppearance"]["mode"], mine.data["myAppearance"]["density"]) == ("auto", "device", "auto")


def test_unknown_values_are_refused_and_keep_the_old_choice(msl):
    msl.query(SET, {"input": {"style": "warm", "mode": "charcoal", "density": "comfortable"}})
    for bad in ({"style": "neon", "mode": "light", "density": "auto"}, {"style": "warm", "mode": "dark", "density": "auto"}, {"style": "warm", "mode": "light", "density": "tiny"}):
        refused = msl.query(SET, {"input": bad})
        assert refused.errors, bad
    kept = msl.query(MINE)
    assert kept.data["myAppearance"]["mode"] == "charcoal"


def test_the_choice_is_not_a_saved_view(msl):
    msl.query(SET, {"input": {"style": "warm", "mode": "light", "density": "auto"}})
    views = msl.query(SAVED_VIEWS)
    assert not views.errors, views.errors
    assert all(not v["savedViewId"].startswith("PREF#") for v in views.data["savedViews"])
