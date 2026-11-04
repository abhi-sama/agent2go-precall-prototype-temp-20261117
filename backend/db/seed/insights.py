"""Deterministic generator for the synthetic HCP insight responses and question catalog.

Pure stdlib, no database: ``generate()`` returns the ``question_tag`` and ``hcp_raw_insights``
rows as dicts, and ``generate.py`` writes them. The same module is what the unit tests and
the planted-signal documentation (``docs/synthetic-insight-data.md``) describe.

Shape of the data
-----------------
* An *interaction* is one MSL conversation with one HCP on one day about one program
  (molecule / tumor / study). It owns several response rows that share
  ``insight_intrctn_dtl_sfdc_id``, ``cust_mdm_id`` and ``date_of_interaction``.
* A follow-up row is only ever created inside the interaction whose parent answer
  triggered it. The parent row records it in ``follow_up_qstn_tag`` / ``followup_qid`` /
  ``followup_qstn`` / ``followup_rspns``; the follow-up row carries ``qstn_pid``.
* Every answer is stored as text in ``rspns_txt``; the type follows ``qstn_type``.
* Qualitative answers come from the committed fixture ``corpus/qualitative_corpus.json``.
"""
from __future__ import annotations

import json
import math
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, timedelta
from functools import lru_cache
from pathlib import Path

from geography import BY_TERRITORY
from questions import (
    ACCESS_OPTIONS, BY_KEY, CHILDREN_OF, CONCEPTS, MOLECULES, ORPHAN_PARENT, STUDIES, TUMORS,
    Concept, ext_to_concept, qid, render, triggered,
)
from rng import Rng

TODAY = date(2026, 11, 3)
REGIONS = [f"REGION-{n:02}" for n in range(1, 5)]
TERRITORIES = [f"T{region[-2:]}-{n:02}" for region in REGIONS for n in range(1, 7)]
N_ROWS = 60000
N_HCPS = 3000
CORPUS = Path(__file__).resolve().parent / "corpus" / "qualitative_corpus.json"

THEMES = ["efficacy", "safety", "sequencing", "biomarker", "access", "guidelines", "trial_design", "competitor", "patient_selection", "unmet_need"]
EMERGING = ["ctdna", "pulm_surveillance", "early_stage"]
THEME_BASE = {"efficacy": 1.3, "safety": 1.2, "sequencing": 1.0, "biomarker": 0.9, "access": 1.1, "guidelines": 0.7,
              "trial_design": 0.6, "competitor": 0.7, "patient_selection": 0.9, "unmet_need": 0.8}
#: Regional tilt of the qualitative themes (multipliers on the base weights).
REGION_THEME = {
    "REGION-01": {"trial_design": 1.7, "biomarker": 1.4, "efficacy": 1.1, "access": 0.7},
    "REGION-02": {"access": 1.9, "patient_selection": 1.2, "guidelines": 0.8, "trial_design": 0.6},
    "REGION-03": {"guidelines": 1.8, "sequencing": 1.5, "safety": 0.9, "competitor": 0.8},
    "REGION-04": {"competitor": 1.8, "safety": 1.4, "unmet_need": 1.3, "biomarker": 0.9},
}
#: Territory-specific spikes on top of the regional tilt.
TERRITORY_THEME = {
    "T02-03": {"access": 2.2}, "T01-01": {"trial_design": 4.0}, "T04-05": {"safety": 4.0}, "T03-05": {"guidelines": 4.5},
    "T04-03": {"competitor": 4.0}, "T02-06": {"access": 2.2}, "T03-02": {"sequencing": 3.5}, "T01-04": {"biomarker": 3.5},
}
#: Emerging topics: (days before TODAY the topic starts to appear, peak share of qualitative answers on the last day).
EMERGING_RAMP = {"ctdna": (90, 0.26), "pulm_surveillance": (72, 0.20), "early_stage": (56, 0.16)}
EMERGING_BASE = 0.004
EMERGING_REGION = {"ctdna": {"REGION-01": 1.5, "REGION-04": 1.2}, "pulm_surveillance": {"REGION-03": 1.6, "REGION-04": 1.3},
                   "early_stage": {"REGION-02": 1.4, "REGION-01": 1.2}}
#: Access friction by region (drives barrier answers, low scores and access-themed free text).
REGION_FRICTION = {"REGION-01": 0.42, "REGION-02": 0.68, "REGION-03": 0.5, "REGION-04": 0.46}
TERRITORY_FRICTION = {"T02-03": 0.86, "T01-01": 0.3, "T02-06": 0.78, "T04-05": 0.56}
REGION_ENTHUSIASM = {"REGION-01": 0.55, "REGION-02": 0.45, "REGION-03": 0.52, "REGION-04": 0.5}

#: The tracker panel: the same HCPs answer the same five questions in three waves.
TRACKER_KEYS = ["line_placement", "tracker_confidence", "tracker_likelihood", "tracker_earlier", "tracker_view"]
WAVE_DAYS_AGO = [(340, 300), (190, 150), (45, 5)]  # inclusive (oldest, newest) days before TODAY
WAVE_LIKERT = [2.2, 3.1, 4.0]
WAVE_RATING = [3.8, 5.6, 7.6]
WAVE_EARLIER = [0.2, 0.45, 0.7]
WAVE_LINE = [[0.05, 0.30, 0.35, 0.30], [0.15, 0.38, 0.27, 0.20], [0.38, 0.38, 0.14, 0.10]]
WAVE_SENTIMENT = [(0.6, 0.3, 0.1), (0.3, 0.4, 0.3), (0.1, 0.3, 0.6)]  # (neg, neu, pos)
PANEL_STRIDE = 20  # every 20th HCP of a territory is on the panel: 7 per territory, 168 in all
LIKERT_LABEL = {1: "Strongly disagree", 2: "Disagree", 3: "Neutral", 4: "Agree", 5: "Strongly agree"}

QT_COLUMNS = ["qstn_tag_sfdc_id", "qstn_tag_nm", "src_created_dt", "src_created_by", "src_updt_dt", "src_updt_by", "src_delete_flag", "ownerid", "insight_nm", "qstn_txt",
              "qstn_tag_strt_dt", "qstn_tag_end_dt", "qstn_tag_status", "tag_nm", "pid", "priority_tag", "qstn_ext_id", "qstn_pid", "qstn_type", "report_tag", "molecule_type",
              "tumor_type", "survey_type", "qstn_indicator", "study_name", "follow_up_qstn_tag", "sys_inserted_datetime", "batch_id", "source_name", "dbt_scd_id",
              "dbt_updated_at", "dbt_valid_from", "dbt_valid_to"]
HI_COLUMNS = ["insight_intrctn_dtl_sfdc_id", "response_id", "insight_submitter_info", "submitter_name", "submitter_email", "date_of_interaction", "clinical_trial", "type_of_visit",
              "meeting_format", "insight_region", "src_created_dt", "region_nm", "insight_country", "country_nm", "insight_msl_territory", "territory_id", "territory_name",
              "parent_territory_id", "parent_territory_name", "team_nm", "cust_mdm_id", "cust_nm", "hcp_speciality", "hcp_institution", "hcp_discipline", "hcp_type",
              "internal_meeting_attendees", "insight_name", "insight_clinicaltrial_site", "site_nm", "insight_intrctn_rspns_sfdc_id", "qstn_txt", "rspns_txt", "qstn_ext_id",
              "qstn_tag_strt_dt", "qstn_tag_end_dt", "qstn_tag_status", "tag_nm", "pid", "priority_tag", "qstn_pid", "qstn_type", "molecule_type", "landscape_type",
              "survey_type", "qstn_indicator", "study_name", "derived_rspns_text", "follow_up_qstn_tag", "followup_qid", "followup_qstn", "followup_rspns", "uniq_rspns_id",
              "sys_inserted_datetime", "mdm_corp_prnt_id", "mdm_corp_prnt_nm", "hq_corp_prnt_id", "hq_corp_prnt_nm", "excluded_rspns_flag"]


def _clamp(x: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, x))


# --- qualitative corpus ------------------------------------------------------------------

@lru_cache(maxsize=1)
def corpus() -> dict[str, list[dict[str, str]]]:
    return json.loads(CORPUS.read_text())["cells"]


class Pools:
    """Round-robin draws from shuffled pools so no answer is reused before its whole pool is.

    Each (topic, molecule[, sentiment]) key walks its own deterministic shuffle, which bounds
    how often any one text repeats.
    """

    def __init__(self) -> None:
        self._cursor: dict[tuple, int] = defaultdict(int)
        self._order: dict[tuple, list[dict[str, str]]] = {}

    def draw(self, topic: str, program: int, sentiment: str | None = None) -> str:
        key = (topic, program, sentiment)
        if key not in self._order:
            entries = corpus()[f"{topic}|{MOLECULES[program]}"]
            if sentiment:
                entries = [e for e in entries if e["s"] == sentiment]
            self._order[key] = Rng("pool", *key).shuffled(sorted(entries, key=lambda e: e["t"]))
        pool = self._order[key]
        text = pool[self._cursor[key] % len(pool)]["t"]
        self._cursor[key] += 1
        return text


# --- latent context ----------------------------------------------------------------------

@dataclass
class Hcp:
    index: int  # 0-based
    territory: str
    region: str
    program: int
    friction: float
    enthusiasm: float
    panel: bool

    @property
    def mdm_id(self) -> str:
        return "LEGACY-HCP-0001" if self.index == 0 else f"HCP-{self.index + 1:04}"

    @property
    def canonical_id(self) -> str:
        return f"HCP-{self.index + 1:04}"


@lru_cache(maxsize=1)
def hcps() -> tuple[Hcp, ...]:
    out = []
    for idx in range(N_HCPS):
        tindex = idx % len(TERRITORIES)
        territory = TERRITORIES[tindex]
        region = REGIONS[tindex // 6]
        position = idx // len(TERRITORIES)
        rng = Rng("hcp", idx)
        friction = _clamp(TERRITORY_FRICTION.get(territory, REGION_FRICTION[region] + Rng("terr-f", territory).normal(0, 0.05)) + rng.normal(0, 0.1), 0.02, 0.98)
        enthusiasm = _clamp(REGION_ENTHUSIASM[region] + rng.normal(0, 0.16), 0.02, 0.98)
        out.append(Hcp(idx, territory, region, (position + tindex) % 4, friction, enthusiasm, position % PANEL_STRIDE == 0))
    return tuple(out)


@lru_cache(maxsize=None)
def theme_weights(territory: str) -> dict[str, float]:
    region = REGIONS[TERRITORIES.index(territory) // 6]
    weights = {}
    for theme in THEMES:
        w = THEME_BASE[theme] * REGION_THEME[region].get(theme, 1.0) * TERRITORY_THEME.get(territory, {}).get(theme, 1.0)
        weights[theme] = w * math.exp(Rng("terr-theme", territory, theme).normal(0, 0.25))
    return weights


def emerging_share(topic: str, region: str, days_ago: int) -> float:
    onset, peak = EMERGING_RAMP[topic]
    share = EMERGING_BASE
    if days_ago < onset:
        share += peak * ((onset - days_ago) / onset) ** 1.4
    return share * EMERGING_REGION[topic].get(region, 1.0)


# --- answer generation -------------------------------------------------------------------

@dataclass
class Ctx:
    hcp: Hcp
    when: date
    program: int
    friction: float
    wave: int | None  # tracker wave 0..2 for a panel interaction
    rng: Rng
    access_signal: bool = False

    @property
    def days_ago(self) -> int:
        return (TODAY - self.when).days


def _opt_adjust(concept: Concept, option: str, ctx: Ctx) -> float:
    strength = concept.p.get("a_opts", {}).get(option)
    if strength is None:
        strength = 0.6 if option in ACCESS_OPTIONS else 0.0
    return math.exp(strength * (ctx.friction - 0.5) * 2)


def _structured(concept: Concept, ctx: Ctx) -> str:
    rng, p = ctx.rng, concept.p
    friction, enthusiasm = ctx.friction, ctx.hcp.enthusiasm
    wave = ctx.wave
    t = 1 - ctx.days_ago / 365
    kind = concept.qtype
    if kind == "yes_no":
        prob = p["p"] + p["a"] * (friction - 0.5) + p["e"] * (enthusiasm - 0.5) + p.get("grow", 0.0) * t
        if wave is not None and concept.key == "tracker_earlier":
            prob = WAVE_EARLIER[wave]
        if rng.chance(0.08):
            return "Unsure"
        return "Yes" if rng.chance(_clamp(prob, 0.03, 0.96)) else "No"
    if kind == "likert_5":
        mean = p["mean"] + p["a"] * (friction - 0.5) + p["e"] * (enthusiasm - 0.5)
        if wave is not None and concept.key == "tracker_confidence":
            mean = WAVE_LIKERT[wave] + 0.3 * (enthusiasm - 0.5)
        return str(int(_clamp(round(rng.normal(mean, 0.9)), 1, 5)))
    if kind == "rating_0_10":
        mean = p["mean"] + p["a"] * (friction - 0.5) + p["e"] * (enthusiasm - 0.5)
        if wave is not None and concept.key == "tracker_likelihood":
            mean = WAVE_RATING[wave] + 1.0 * (enthusiasm - 0.5)
        return str(int(_clamp(round(rng.normal(mean, 1.8)), 0, 10)))
    if kind == "numeric":
        frac = _clamp(p["mean"] + p["a"] * (friction - 0.5) + p["e"] * (enthusiasm - 0.5) + rng.normal(0, 0.2), 0.0, 1.0)
        value = p["lo"] + frac * (p["hi"] - p["lo"])
        step = p["step"]
        return str(int(_clamp(round(value / step) * step, p["lo"], p["hi"])))
    if kind == "date":
        return (ctx.when + timedelta(days=rng.between(p["lo"], p["hi"]))).isoformat()
    if kind == "single_choice":
        weights = list(concept.weights)
        if wave is not None and concept.key == "line_placement":
            weights = WAVE_LINE[wave]
        weights = [w * _opt_adjust(concept, o, ctx) for o, w in zip(concept.options, weights)]
        return rng.weighted(concept.options, weights)
    if kind == "multi_select":
        probs = [_clamp(w * _opt_adjust(concept, o, ctx), 0.02, 0.95) for o, w in zip(concept.options, concept.weights)]
        chosen = [o for o, pr in zip(concept.options, probs) if rng.chance(pr)]
        if not chosen:
            chosen = [concept.options[probs.index(max(probs))]]
        return ";".join(chosen)
    if kind == "ranking":
        scored = [(w * _opt_adjust(concept, o, ctx) * math.exp(rng.normal(0, 0.45)), o) for o, w in zip(concept.options, concept.weights)]
        return " > ".join(o for _, o in sorted(scored, key=lambda s: -s[0]))
    raise ValueError(kind)


def _access_flag(concept: Concept, answer: str) -> bool:
    """Is this answer an explicit access barrier? (A multi-select must name both coverage and prior authorization.)"""
    if concept.qtype == "single_choice":
        return answer in ACCESS_OPTIONS
    if concept.qtype == "multi_select":
        return {"Cost / coverage", "Prior authorization burden"} <= set(answer.split(";"))
    if concept.qtype == "ranking":
        return answer.split(" > ")[0] in ACCESS_OPTIONS
    if concept.key == "coverage_limits":
        return answer == "Yes"
    return False


def _derived(concept: Concept, answer: str) -> str | None:
    if concept.qtype == "likert_5":
        return LIKERT_LABEL[int(answer)]
    if concept.qtype == "rating_0_10":
        value = int(answer)
        return "Low (0-6)" if value <= 6 else ("Medium (7-8)" if value <= 8 else "High (9-10)")
    return None


@dataclass
class Resp:
    concept: Concept
    program: int
    answer: str
    parent: "Resp | None" = None
    followup: "Resp | None" = None
    orphan: bool = False

    @property
    def ext(self) -> str:
        return qid(self.concept.key, self.program)


@dataclass
class Interaction:
    hcp: Hcp
    when: date
    program: int
    resps: list[Resp] = field(default_factory=list)
    panel_wave: int | None = None


def _draw_theme(ctx: Ctx) -> str:
    """Theme of a free-text answer: emerging topics ramp up over the last 90 days, otherwise the territory's mix."""
    rng = ctx.rng
    emerging = {topic: emerging_share(topic, ctx.hcp.region, ctx.days_ago) for topic in EMERGING}
    if rng.chance(sum(emerging.values())):
        return rng.weighted(list(emerging), list(emerging.values()))
    weights = dict(theme_weights(ctx.hcp.territory))
    weights["access"] *= math.exp(2.0 * (ctx.friction - 0.5)) * (2.5 if ctx.access_signal else 1.0)
    return rng.weighted(THEMES, [weights[t] for t in THEMES])


def _open_answer(concept: Concept, ctx: Ctx, pools: Pools) -> str:
    rng = ctx.rng
    theme = concept.theme
    if theme == "tracker" and ctx.wave is not None:
        sentiment = rng.weighted(["neg", "neu", "pos"], WAVE_SENTIMENT[ctx.wave])
        return pools.draw(rng.choice(["efficacy", "sequencing", "safety", "patient_selection"]), ctx.program, sentiment)
    if theme in ("tracker", "any"):
        theme = _draw_theme(ctx)
    elif theme == "barrier" and ctx.access_signal and rng.chance(0.6):
        theme = "access"
    return pools.draw(theme, ctx.program)


_OPEN_HOSTS: dict[str, list[Concept]] = defaultdict(list)
for _c in CONCEPTS:
    if _c.qtype == "open_text" and not _c.parent and _c.theme not in ("tracker", "any"):
        _OPEN_HOSTS[_c.theme].append(_c)
_GENERIC = [BY_KEY["o_any1"], BY_KEY["o_any2"], BY_KEY["tracker_view"]]
_STRUCTURED_ROOTS = [c for c in CONCEPTS if not c.parent and c.qtype != "open_text"]
_LEAF_ROOTS = [c for c in _STRUCTURED_ROOTS if c.key not in CHILDREN_OF]
_ORPHAN_CONCEPT = CONCEPTS[24]
assert _ORPHAN_CONCEPT.key == "fu_start_barrier"


def _answer_with_children(concept: Concept, ctx: Ctx, pools: Pools, out: list[Resp]) -> None:
    answer = _structured(concept, ctx)
    resp = Resp(concept, ctx.program, answer)
    out.append(resp)
    if _access_flag(concept, answer):
        ctx.access_signal = True
    for child in CHILDREN_OF.get(concept.key, []):
        if child is _ORPHAN_CONCEPT and ctx.program == 3:
            continue  # Q-0100's declared parent is not in the catalog: the parent never triggers it
        if not triggered(child, answer):
            continue
        sub = Resp(child, ctx.program, _open_answer(child, ctx, pools) if child.qtype == "open_text" else _structured(child, ctx), parent=resp)
        if _access_flag(child, sub.answer):
            ctx.access_signal = True
        out.append(sub)
        if resp.followup is None:
            resp.followup = sub


def build_interaction(hcp: Hcp, when: date, program: int, rng: Rng, pools: Pools, *, wave: int | None = None, leaf_only: int = 0) -> Interaction:
    friction = _clamp(hcp.friction + rng.normal(0, 0.07), 0.0, 1.0)
    ctx = Ctx(hcp, when, program, friction, wave, rng)
    inter = Interaction(hcp, when, program, panel_wave=wave)
    out: list[Resp] = []
    if leaf_only:
        for concept in rng.shuffled(_LEAF_ROOTS)[:leaf_only]:
            out.append(Resp(concept, program, _structured(concept, ctx)))
        inter.resps = out
        return inter
    if wave is not None:
        for key in TRACKER_KEYS:
            concept = BY_KEY[key]
            if concept.qtype == "open_text":
                continue
            _answer_with_children(concept, ctx, pools, out)
        out.append(Resp(BY_KEY["tracker_view"], program, _open_answer(BY_KEY["tracker_view"], ctx, pools)))
        inter.resps = out
        return inter
    # Panel HCPs answer the tracker questions only in their three waves, so the shift is clean.
    roots = [c for c in _STRUCTURED_ROOTS if not (hcp.panel and c.tracker)]
    for concept in rng.shuffled(roots)[: rng.weighted([2, 3, 4], [0.3, 0.45, 0.25])]:
        _answer_with_children(concept, ctx, pools, out)
    for _ in range(rng.weighted([0, 1, 2], [0.5, 0.42, 0.08])):
        theme = _draw_theme(ctx)
        hosts = _OPEN_HOSTS[theme] if not rng.chance(0.3) else _GENERIC
        concept = rng.choice([h for h in hosts if not (hcp.panel and h.tracker)])
        out.append(Resp(concept, program, pools.draw(theme, program)))
    if rng.chance(0.012):  # the orphan follow-up is answered without any parent
        out.append(Resp(_ORPHAN_CONCEPT, 3, pools.draw("access" if ctx.access_signal else "barrier", 3), orphan=True))
    inter.resps = out
    return inter


# --- assembly ------------------------------------------------------------------------------

def question_rows() -> list[dict]:
    rows = []
    for number in range(1, 401):
        concept, program = ext_to_concept(f"Q-{number:04}")
        parent = None
        if concept.parent:
            parent = qid(concept.parent, program)
            if number == 100:
                parent = ORPHAN_PARENT  # planted orphan parent
        child_tags = [f"Question Tag {int(qid(c.key, program)[2:])}" for c in CHILDREN_OF.get(concept.key, [])
                      if not (c.key == "fu_start_barrier" and program == 3)]
        rows.append({
            "qstn_tag_sfdc_id": f"TAG-{number:04}", "qstn_tag_nm": f"Question Tag {number}", "src_created_dt": "2025-01-01T00:00:00", "src_created_by": "seed",
            "src_updt_dt": "2026-01-01T00:00:00", "src_updt_by": "seed", "src_delete_flag": False, "ownerid": "seed", "insight_nm": "Oncology insight",
            "qstn_txt": render(concept.text, program), "qstn_tag_strt_dt": "2025-01-01T00:00:00", "qstn_tag_end_dt": None, "qstn_tag_status": "Active",
            "tag_nm": "Oncology", "pid": None, "priority_tag": "high" if concept.tracker else "normal", "qstn_ext_id": f"Q-{number:04}", "qstn_pid": parent,
            "qstn_type": concept.qtype, "report_tag": concept.topic, "molecule_type": MOLECULES[program], "tumor_type": TUMORS[program],
            "survey_type": concept.survey, "qstn_indicator": TUMORS[program], "study_name": STUDIES[program],
            # On a parent question: the tag of its (first) conditional follow-up, matching HI.follow_up_qstn_tag.
            "follow_up_qstn_tag": child_tags[0] if child_tags else None,
            "sys_inserted_datetime": "2026-11-03T12:00:00Z", "batch_id": "QUEST-20261103", "source_name": "synthetic", "dbt_scd_id": f"question-{number}",
            "dbt_updated_at": "2026-11-03T12:00:00", "dbt_valid_from": "2025-01-01T00:00:00", "dbt_valid_to": None,
        })
    return rows


def _interactions() -> list[Interaction]:
    pools = Pools()
    people = hcps()
    out: list[Interaction] = []
    total = 0
    # 1. tracker panel: the same HCPs, the same questions, three waves.
    for hcp in people:
        if not hcp.panel:
            continue
        for wave, (oldest, newest) in enumerate(WAVE_DAYS_AGO):
            rng = Rng("panel", hcp.index, wave)
            inter = build_interaction(hcp, TODAY - timedelta(days=rng.between(newest, oldest)), hcp.program, rng, pools, wave=wave)
            out.append(inter)
            total += len(inter.resps)
    # 2. general interactions round-robin over every HCP, until the row budget is nearly spent.
    j = 0
    while True:
        hcp = people[j % N_HCPS]
        rng = Rng("interaction", j)
        program = hcp.program if rng.chance(0.7) else rng.below(4)
        inter = build_interaction(hcp, TODAY - timedelta(days=rng.below(365)), program, rng, pools)
        if total + len(inter.resps) > N_ROWS - 8:
            break
        out.append(inter)
        total += len(inter.resps)
        j += 1
    # 3. top up to exactly N_ROWS with stand-alone single-question interactions (questions that have no follow-up).
    while total < N_ROWS:
        hcp = people[j % N_HCPS]
        rng = Rng("interaction-fill", j)
        inter = build_interaction(hcp, TODAY - timedelta(days=rng.below(365)), hcp.program, rng, pools, leaf_only=min(N_ROWS - total, 2))
        out.append(inter)
        total += len(inter.resps)
        j += 1
    return out


def response_rows() -> list[dict]:
    interactions = sorted(enumerate(_interactions()), key=lambda pair: (pair[1].when, pair[0]))
    questions = {r["qstn_ext_id"]: r for r in question_rows()}
    rows: list[dict] = []
    for seq, (_, inter) in enumerate(interactions, 1):
        hcp = inter.hcp
        geo = BY_TERRITORY[hcp.territory]
        region = hcp.region
        name = "Insight directory HCP 0001" if hcp.index == 0 else "Synthetic HCP " + hcp.mdm_id
        for resp in inter.resps:
            i = len(rows)
            q = questions[resp.ext]
            fu = resp.followup
            rows.append({
                "insight_intrctn_dtl_sfdc_id": f"INT-{seq:06}", "response_id": f"RAW-{i + 1:06}", "insight_submitter_info": "seed", "submitter_name": None, "submitter_email": None,
                "date_of_interaction": inter.when.isoformat(), "clinical_trial": STUDIES[inter.program], "type_of_visit": "field", "meeting_format": "in-person",
                "insight_region": region, "src_created_dt": inter.when.isoformat() + "T17:00:00", "region_nm": region, "insight_country": geo.country_code, "country_nm": geo.country_name,
                "insight_msl_territory": hcp.territory, "territory_id": hcp.territory, "territory_name": hcp.territory + " Oncology", "parent_territory_id": region,
                "parent_territory_name": region + " Region", "team_nm": "Oncology", "cust_mdm_id": hcp.mdm_id, "cust_nm": name, "hcp_speciality": "medical oncology",
                "hcp_institution": "Synthetic Cancer Center", "hcp_discipline": "oncology", "hcp_type": "HCP", "internal_meeting_attendees": None, "insight_name": "Oncology insight",
                "insight_clinicaltrial_site": None, "site_nm": None, "insight_intrctn_rspns_sfdc_id": f"INS-{i + 1:06}", "qstn_txt": q["qstn_txt"], "rspns_txt": resp.answer,
                "qstn_ext_id": resp.ext, "qstn_tag_strt_dt": "2025-01-01T00:00:00", "qstn_tag_end_dt": None,
                "qstn_tag_status": "Retired" if i % 10 == 0 else "Active",  # catalog-vs-response status difference
                "tag_nm": "Oncology", "pid": None, "priority_tag": q["priority_tag"], "qstn_pid": q["qstn_pid"], "qstn_type": q["qstn_type"],
                "molecule_type": q["molecule_type"], "landscape_type": resp.concept.landscape, "survey_type": q["survey_type"], "qstn_indicator": q["qstn_indicator"],
                "study_name": q["study_name"], "derived_rspns_text": _derived(resp.concept, resp.answer),
                "follow_up_qstn_tag": questions[fu.ext]["qstn_tag_nm"] if fu else None, "followup_qid": fu.ext if fu else None,
                "followup_qstn": questions[fu.ext]["qstn_txt"] if fu else None, "followup_rspns": fu.answer if fu else None,
                "uniq_rspns_id": "RESP-000001" if i == N_ROWS - 1 else f"RESP-{i + 1:06}",  # planted duplicate key
                "sys_inserted_datetime": "2026-11-03T12:00:00Z", "mdm_corp_prnt_id": None, "mdm_corp_prnt_nm": None, "hq_corp_prnt_id": None, "hq_corp_prnt_nm": None,
                "excluded_rspns_flag": False,
            })
    return rows


@lru_cache(maxsize=1)
def generate() -> tuple[list[dict], list[dict]]:
    """(question_tag rows, hcp_raw_insights rows), deterministic."""
    return question_rows(), response_rows()
