"""The synthetic question catalog: 100 question concepts x 4 programs = 400 questions.

A *concept* is one question asked about each of the four molecule programs, so every
concept yields four catalog questions (``Q-0001`` .. ``Q-0400``). Concepts cover every
answer type an MSL insight survey uses, and 39 of them are conditional follow-ups whose
parent question and trigger are explicit, so the generator can attach a follow-up answer
only inside the interaction that produced the triggering parent answer.

Pure data and stdlib only, so unit tests run without a database.
"""
from __future__ import annotations

from dataclasses import dataclass, field

MOLECULES = ["trastuzumab deruxtecan", "osimertinib", "pembrolizumab", "sacituzumab govitecan"]
TUMORS = ["breast cancer", "non-small cell lung cancer", "gastric cancer", "urothelial cancer"]
STUDIES = ["DESTINY-Breast06", "FLAURA2", "KEYNOTE-671", "TROPiCS-02"]
BIOMARKERS = ["HER2-low status", "EGFR mutation status", "PD-L1 CPS", "TROP2 expression"]
ADVERSE_EVENTS = ["ILD and nausea", "rash and diarrhea", "immune-related adverse events", "neutropenia and diarrhea"]
#: The orphan parent id planted in the catalog (a follow-up whose parent was never loaded).
ORPHAN_PARENT = "Q-NOT-IN-CATALOG"

QTYPES = ("open_text", "single_choice", "multi_select", "yes_no", "likert_5", "rating_0_10", "numeric", "date", "ranking")

BARRIERS = ["Cost / coverage", "Prior authorization burden", "Biomarker testing availability", "Safety / monitoring burden",
            "Lack of guideline support", "Limited local clinical experience", "Infusion / site-of-care logistics", "Patient preference"]
#: Options whose likelihood rises with access friction (coverage, prior authorization, denials).
ACCESS_OPTIONS = {"Cost / coverage", "Prior authorization burden", "Prior authorization", "Step edits", "Copay / cost to patient",
                  "Frequently denied", "Approved after peer-to-peer or appeal", "Appeals workload", "Access to therapy",
                  "Step therapy not met", "Not medically necessary", "Cost", "Cost / reimbursement for testing", "Payer policy"}


@dataclass(frozen=True)
class Concept:
    key: str
    qtype: str
    text: str
    topic: str  # report_tag
    survey: str = "MSL pulse"
    landscape: str = "treatment landscape"
    theme: str | None = None  # open_text: corpus topic ("any" = whatever the territory is talking about)
    options: tuple[str, ...] = ()
    weights: tuple[float, ...] = ()
    parent: str | None = None
    trigger: tuple | None = None  # ("in", {...}) | ("le", n) | ("ge", n) | ("has", {...})
    tracker: bool = False
    p: dict = field(default_factory=dict)


def _c(key, qtype, text, topic, **kw) -> Concept:
    return Concept(key, qtype, text, topic, **kw)


def _single(key, text, topic, options, weights, **kw):
    return _c(key, "single_choice", text, topic, options=tuple(options), weights=tuple(weights), **kw)


def _multi(key, text, topic, options, probs, **kw):
    return _c(key, "multi_select", text + " Select all that apply.", topic, options=tuple(options), weights=tuple(probs), **kw)


def _yn(key, text, topic, prob, a=0.0, e=0.0, **kw):
    extra = kw.pop("p", {})
    return _c(key, "yes_no", text, topic, p={"p": prob, "a": a, "e": e, **extra}, **kw)


def _likert(key, text, topic, mean, a=0.0, e=0.0, **kw):
    return _c(key, "likert_5", text + " (1 = strongly disagree, 5 = strongly agree)", topic, p={"mean": mean, "a": a, "e": e}, **kw)


def _rating(key, text, topic, mean, a=0.0, e=0.0, **kw):
    return _c(key, "rating_0_10", text + " (0 = not at all, 10 = extremely)", topic, p={"mean": mean, "a": a, "e": e}, **kw)


def _num(key, text, topic, lo, hi, step, mean, a=0.0, e=0.0, **kw):
    return _c(key, "numeric", text, topic, p={"lo": lo, "hi": hi, "step": step, "mean": mean, "a": a, "e": e}, **kw)


def _date(key, text, topic, lo, hi, **kw):
    return _c(key, "date", text + " (YYYY-MM-DD)", topic, p={"lo": lo, "hi": hi}, **kw)


def _rank(key, text, topic, options, weights, **kw):
    return _c(key, "ranking", text, topic, options=tuple(options), weights=tuple(weights), **kw)


def _open(key, text, topic, theme, **kw):
    return _c(key, "open_text", text, topic, theme=theme, **kw)


TRACKER = "Post-launch tracker"
ADVISORY = "Advisory board"
CONGRESS = "Congress debrief"
ACCESS_L, BIOMARKER_L, EVIDENCE_L, SAFETY_L = "access landscape", "biomarker landscape", "evidence landscape", "safety landscape"

_ROOTS_A: list[Concept] = [
    # Tracker questions: the same five prompts are put to a panel of HCPs in three waves.
    _single("line_placement", "Where do you currently place {drug} in the {tumor} treatment sequence?", "Sequencing",
            ["First line", "Second line", "Third line or later", "Not currently using"], [0.22, 0.34, 0.24, 0.20], survey=TRACKER, tracker=True),
    _likert("tracker_confidence", "I am confident in positioning {drug} earlier in the treatment sequence.", "Sequencing", 3.2, a=-0.6, e=1.0, survey=TRACKER, tracker=True),
    _rating("tracker_likelihood", "How likely are you to initiate {drug} for your next eligible patient?", "Prescribing intent", 5.8, a=-2.0, e=3.0, survey=TRACKER, tracker=True),
    _yn("tracker_earlier", "Would you consider {drug} earlier in the treatment sequence if supported by new data?", "Sequencing", 0.5, a=-0.2, e=0.5, survey=TRACKER, tracker=True),
    _open("tracker_view", "How has your view of {drug} changed since we last spoke?", "Perspective", "tracker", survey=TRACKER, tracker=True),
    # Qualitative, one topical prompt per planted theme.
    _open("o_efficacy", "What are you seeing in response and durability with {drug} in your {tumor} patients?", "Efficacy", "efficacy"),
    _open("o_safety", "What are your main tolerability and safety observations with {drug}?", "Safety", "safety", landscape=SAFETY_L),
    _open("o_sequencing", "How do you think about sequencing {drug} relative to other options?", "Sequencing", "sequencing"),
    _open("o_biomarker", "What has your experience been with {biomarker} testing for {drug}?", "Biomarker testing", "biomarker", landscape=BIOMARKER_L),
    _open("o_access", "What is your experience with access and reimbursement for {drug}?", "Access", "access", landscape=ACCESS_L),
    _open("o_guidelines", "How are guidelines and pathways shaping your use of {drug}?", "Guidelines", "guidelines", survey=ADVISORY),
    _open("o_trial", "What are your thoughts on the design of {study} and what it means for your patients?", "Trial design", "trial_design", survey=ADVISORY, landscape=EVIDENCE_L),
    _open("o_competitor", "How do you compare {drug} with the alternatives your colleagues use?", "Competitive landscape", "competitor", survey=CONGRESS),
    _open("o_selection", "Which patients do you consider good or poor candidates for {drug}, and why?", "Patient selection", "patient_selection"),
    _open("o_unmet", "What unmet needs remain for your {tumor} patients?", "Unmet need", "unmet_need", survey=CONGRESS),
    # Emerging topics (their share of qualitative answers grows over the last 90 days).
    _open("o_ctdna", "What are you hearing or doing around ctDNA-guided monitoring with {drug}?", "Emerging: ctDNA", "ctdna", landscape=BIOMARKER_L),
    _open("o_pulm", "How do you approach surveillance for pulmonary toxicity on {drug}?", "Emerging: pulmonary surveillance", "pulm_surveillance", landscape=SAFETY_L),
    _open("o_early", "What is your interest in using {drug} in earlier-stage disease?", "Emerging: earlier stage", "early_stage"),
    _open("o_any1", "What other perspectives came up in this discussion?", "General", "any"),
    _open("o_any2", "Is there anything that would change how you use {drug} in the next six months?", "General", "any"),
    # Categorical, binary, ordinal, quantitative, ranking.
    _single("test_method", "Which biomarker testing method do you most often rely on for {biomarker}?", "Biomarker testing",
            ["Tissue IHC / single-gene", "Tissue NGS panel", "Liquid biopsy (ctDNA)", "Send-out reference lab", "Not routinely tested"], [0.26, 0.30, 0.14, 0.22, 0.08],
            landscape=BIOMARKER_L, p={"a_opts": {"Not routinely tested": 1.0, "Send-out reference lab": 0.6}}),
    _single("info_source", "Which source most influences your use of {drug}?", "Evidence",
            ["Peer-reviewed publications", "Congress presentations", "Tumor board / peer discussion", "Guidelines / pathways", "MSL scientific exchange", "Payer policy"],
            [0.24, 0.18, 0.2, 0.16, 0.14, 0.08], landscape=EVIDENCE_L),
    _single("care_setting", "Where do you mainly administer or oversee {drug} treatment?", "Site of care",
            ["Academic infusion center", "Community oncology practice", "Hospital outpatient department", "Oral / at-home"], [0.3, 0.38, 0.22, 0.10]),
]
_ROOTS_B: list[Concept] = [
    _single("post_progression", "What do you most often do after progression on {drug}?", "Unmet need",
            ["Switch to chemotherapy", "Switch to another targeted agent / ADC", "Enroll in a clinical trial", "Continue beyond progression", "Best supportive care"], [0.3, 0.32, 0.16, 0.12, 0.1]),
    _single("ae_owner", "Who primarily manages monitoring for {ae} in your {drug} patients?", "Safety",
            ["Treating oncologist", "Oncology nurse / APP", "Pulmonology or specialty co-management", "PCP", "Not systematically monitored"], [0.36, 0.3, 0.14, 0.06, 0.14], landscape=SAFETY_L),
    _single("payer_experience", "How would you describe your typical payer experience for {drug}?", "Access",
            ["Approved at first submission", "Approved after peer-to-peer or appeal", "Frequently denied", "Varies widely by payer"], [0.28, 0.3, 0.14, 0.28],
            landscape=ACCESS_L, p={"a_opts": {"Frequently denied": 1.8, "Approved after peer-to-peer or appeal": 0.8, "Approved at first submission": -1.4}}),
    _single("top_unmet", "Which area is the biggest unmet need in {tumor}?", "Unmet need",
            ["Overcoming resistance", "CNS disease control", "Earlier-stage options", "Better tolerability", "Predictive biomarkers", "Access to therapy"], [0.24, 0.17, 0.16, 0.14, 0.14, 0.15],
            survey=CONGRESS, p={"a_opts": {"Access to therapy": 1.2}}),
    _single("evidence_priority", "What additional evidence would most change your practice with {drug}?", "Evidence",
            ["Head-to-head comparison", "Real-world outcomes data", "Longer-term follow-up", "Subgroup data in my patients", "Biomarker-selected cohort data"], [0.24, 0.24, 0.2, 0.18, 0.14],
            survey=ADVISORY, landscape=EVIDENCE_L),
    _multi("barriers_multi", "Which barriers have you encountered in prescribing {drug}?", "Access", BARRIERS, [0.42, 0.38, 0.28, 0.3, 0.2, 0.22, 0.26, 0.14],
           landscape=ACCESS_L, p={"a_opts": {"Cost / coverage": 1.6, "Prior authorization burden": 1.6, "Infusion / site-of-care logistics": 0.4}}),
    _multi("biomarkers_tested", "Which biomarkers do you routinely test for in {tumor}?", "Biomarker testing",
           ["HER2", "EGFR", "PD-L1", "TROP2", "MSI / dMMR", "NTRK / RET / ALK panel", "TMB"], [0.5, 0.45, 0.6, 0.18, 0.35, 0.3, 0.28], landscape=BIOMARKER_L),
    _multi("ae_support", "Which supportive measures do you use for {ae}?", "Safety",
           ["Prophylactic antiemetics", "Dose reduction protocol", "Scheduled imaging", "Symptom triage line", "Steroid protocol", "Patient education handout"], [0.5, 0.4, 0.35, 0.22, 0.3, 0.55], landscape=SAFETY_L),
    _multi("update_channels", "How do you prefer to receive scientific updates from the MSL?", "Engagement",
           ["In-person meeting", "Virtual meeting", "Email summary", "Congress debrief", "Peer-to-peer discussion"], [0.6, 0.35, 0.4, 0.3, 0.25]),
    _multi("patient_factors", "Which patient factors make you hesitate to use {drug}?", "Patient selection",
           ["Poor performance status", "Cardiac comorbidity", "Lung disease history", "Age over 75", "Active brain metastases", "Prior line failure", "Patient preference"], [0.5, 0.3, 0.32, 0.28, 0.26, 0.2, 0.18]),
    _multi("site_limits", "Which resources limit your site for {drug}?", "Site of care",
           ["Infusion chair capacity", "Nursing staffing", "Pharmacy compounding", "Imaging access", "Biomarker lab access", "Financial counseling"], [0.3, 0.34, 0.2, 0.22, 0.18, 0.26]),
    _yn("aware_guideline", "Are you aware of the most recent guideline update that touches {drug} in {tumor}?", "Guidelines", 0.6, e=0.5, survey=ADVISORY),
    _yn("started_recently", "Have you started a patient on {drug} in the last six months?", "Prescribing intent", 0.55, a=-0.3, e=0.7),
    _yn("coverage_limits", "Do coverage or prior authorization issues limit your use of {drug}?", "Access", 0.42, a=0.8, landscape=ACCESS_L),
    _yn("testing_routine", "Is {biomarker} testing done routinely before treatment decisions at your site?", "Biomarker testing", 0.62, a=-0.35, landscape=BIOMARKER_L),
    _yn("site_trial", "Does your site currently participate in a trial involving {drug}?", "Trial design", 0.3, e=0.3, landscape=EVIDENCE_L),
    _yn("uses_ctdna", "Are you using ctDNA monitoring for patients on {drug}?", "Emerging: ctDNA", 0.1, e=0.15, landscape=BIOMARKER_L, p={"grow": 0.3}),
    _likert("evidence_sufficient", "The evidence base for {drug} in {tumor} is sufficient for my practice.", "Evidence", 3.5, e=0.9, landscape=EVIDENCE_L),
    _likert("safety_manageable", "The safety profile of {drug} is manageable in my clinic.", "Safety", 3.6, e=0.6, landscape=SAFETY_L),
    _likert("access_easy", "Obtaining coverage for {drug} is straightforward at my site.", "Access", 3.2, a=-1.6, landscape=ACCESS_L),
    _likert("guideline_clear", "Current guidelines give me clear direction on using {drug}.", "Guidelines", 3.3, e=0.4, survey=ADVISORY),
    _likert("advantage_vs_alt", "{drug} offers a meaningful advantage over alternative options.", "Competitive landscape", 3.4, e=1.0, survey=CONGRESS),
    _likert("testing_fast", "Biomarker results for {biomarker} come back fast enough to act on.", "Biomarker testing", 3.3, a=-0.9, landscape=BIOMARKER_L),
    _rating("recommend", "How likely are you to recommend {drug} to a colleague?", "Prescribing intent", 6.4, a=-1.5, e=2.6),
    _rating("data_satisfaction", "How satisfied are you with the clinical data available for {drug}?", "Evidence", 6.6, e=1.6, landscape=EVIDENCE_L),
    _rating("msl_value", "How valuable was today's scientific exchange?", "Engagement", 7.2, e=1.2),
    _rating("selection_confidence", "How confident are you in selecting the right patients for {drug}?", "Patient selection", 6.9, a=-0.6, e=1.8),
    _num("pct_eligible", "What percentage of your {tumor} patients are eligible for {drug}? (%)", "Patient selection", 5, 80, 5, 0.35, a=-0.1, e=0.25),
    _num("pts_per_month", "How many {tumor} patients do you start on systemic therapy per month?", "Patient volume", 1, 25, 1, 0.32, e=0.1),
    _num("months_on_drug", "What is the typical time on {drug} for your patients? (months)", "Efficacy", 2, 24, 1, 0.4, e=0.3),
    _num("pct_tested", "What percentage of eligible patients receive {biomarker} testing before first-line decisions? (%)", "Biomarker testing", 30, 100, 5, 0.68, a=-0.3, landscape=BIOMARKER_L),
    _num("turnaround_days", "What is your typical {biomarker} test turnaround time? (days)", "Biomarker testing", 3, 28, 1, 0.38, a=0.25, landscape=BIOMARKER_L),
    _num("pct_dose_reduced", "What percentage of your patients on {drug} need a dose reduction? (%)", "Safety", 5, 45, 5, 0.35, e=-0.15, landscape=SAFETY_L),
    _date("first_rx_date", "On what date did you first prescribe {drug}?", "Prescribing intent", -540, -14),
    _date("expected_earlier_date", "By what date do you expect to use {drug} in an earlier setting?", "Sequencing", 30, 400),
    _rank("rank_selection", "Rank the factors that drive your choice of therapy in {tumor}, from most to least important.", "Evidence",
          ["Efficacy", "Safety / tolerability", "Guideline endorsement", "Access / coverage", "Convenience of administration", "Biomarker fit"], [0.9, 0.7, 0.55, 0.5, 0.3, 0.45],
          p={"a_opts": {"Access / coverage": 1.2}}),
    _rank("rank_barriers", "Rank the barriers to using {drug}, from biggest to smallest.", "Access",
          ["Cost / coverage", "Prior authorization burden", "Biomarker testing availability", "Safety / monitoring burden", "Infusion / site-of-care logistics"], [0.9, 0.8, 0.5, 0.55, 0.4],
          landscape=ACCESS_L, p={"a_opts": {"Cost / coverage": 1.4, "Prior authorization burden": 1.4}}),
    _rank("rank_unmet", "Rank the unmet needs in {tumor}, from most to least pressing.", "Unmet need",
          ["Overcoming resistance", "CNS disease control", "Earlier-stage options", "Better tolerability", "Predictive biomarkers"], [0.9, 0.7, 0.6, 0.55, 0.5], survey=CONGRESS),
]


def _with(concept: Concept, parent: str, trigger: tuple) -> Concept:
    from dataclasses import replace
    return replace(concept, parent=parent, trigger=trigger)


NO = ("in", {"No", "Unsure"})
YES = ("in", {"Yes"})
LOW2 = ("le", 2)
LOW6 = ("le", 6)
HIGH9 = ("ge", 9)

#: Follow-up concepts: conditional on the parent concept's answer, asked in the same interaction.
_CHILDREN: list[Concept] = [
    _with(_open("fu_start_barrier", "What is the main barrier to starting patients on {drug}?", "Access", "barrier"), "started_recently", NO),  # [0] becomes concept 24 -> orphan in Q-0100
    _with(_open("fu_coverage", "What is the main coverage challenge you face?", "Access", "barrier", landscape=ACCESS_L), "coverage_limits", YES),
    _with(_open("fu_testing_barrier", "What is the main barrier to routine testing?", "Biomarker testing", "barrier", landscape=BIOMARKER_L), "testing_routine", NO),
    _with(_open("fu_why_evidence", "What is the main reason for your low score?", "Evidence", "why_low", landscape=EVIDENCE_L), "evidence_sufficient", LOW2),
    _with(_open("fu_why_safety", "What is the main reason for your low score?", "Safety", "why_low", landscape=SAFETY_L), "safety_manageable", LOW2),
    _with(_open("fu_why_advantage", "What is the main reason for your low score?", "Competitive landscape", "why_low", survey=CONGRESS), "advantage_vs_alt", LOW2),
    _with(_open("fu_why_unlikely", "What would need to change for you to use {drug}?", "Prescribing intent", "why_low", survey=TRACKER), "tracker_likelihood", LOW6),
    _with(_open("fu_why_no_recommend", "What holds you back from recommending {drug}?", "Prescribing intent", "why_low"), "recommend", LOW6),
    _with(_open("fu_why_data", "What is missing from the data for {drug}?", "Evidence", "why_low", landscape=EVIDENCE_L), "data_satisfaction", ("le", 5)),
    _with(_open("fu_why_recommend", "What drives your high likelihood to recommend {drug}?", "Prescribing intent", "why_high"), "recommend", HIGH9),
    _with(_open("fu_why_confident", "What makes you confident in selecting patients?", "Patient selection", "why_high"), "selection_confidence", HIGH9),
    _with(_open("fu_why_tracker_conf", "What makes you confident in positioning {drug} earlier?", "Sequencing", "why_high", survey=TRACKER), "tracker_confidence", ("ge", 5)),
    _with(_open("fu_high_volume", "Which patients make up your highest volume?", "Patient selection", "patient_selection"), "pts_per_month", ("ge", 15)),
    _with(_open("fu_why_later", "What keeps you from using {drug} earlier?", "Sequencing", "sequencing", survey=TRACKER), "line_placement", ("in", {"Third line or later"})),
    _with(_single("fu_main_barrier", "What is the main barrier to starting patients on {drug}?", "Access", BARRIERS, [0.2, 0.17, 0.13, 0.14, 0.1, 0.1, 0.1, 0.06],
                  landscape=ACCESS_L, p={"a_opts": {"Cost / coverage": 2.0, "Prior authorization burden": 2.0}}), "started_recently", NO),
    _with(_single("fu_testing_cause", "What is the main barrier to routine testing?", "Biomarker testing",
                  ["Cost / reimbursement for testing", "Tissue availability", "Turnaround time", "Lack of reflex testing", "No local lab capability"], [0.2, 0.2, 0.25, 0.2, 0.15],
                  landscape=BIOMARKER_L, p={"a_opts": {"Cost / reimbursement for testing": 1.2}}), "testing_routine", NO),
    _with(_single("fu_guideline_help", "What would help you most to follow the guideline?", "Guidelines", ["Pathway summary", "MSL discussion", "Peer example", "Payer clarity"],
                  [0.3, 0.3, 0.2, 0.2], survey=ADVISORY, p={"a_opts": {"Payer clarity": 1.0}}), "aware_guideline", NO),
    _with(_single("fu_access_barrier", "What is the main access barrier?", "Access", ["Prior authorization", "Step edits", "Copay / cost to patient", "Site-of-care restrictions", "Appeals workload"],
                  [0.3, 0.2, 0.2, 0.15, 0.15], landscape=ACCESS_L, p={"a_opts": {"Prior authorization": 1.4, "Step edits": 0.8}}), "access_easy", LOW2),
    _with(_single("fu_evidence_gap", "Which evidence gap matters most?", "Evidence", ["Head-to-head data", "Long-term follow-up", "Real-world outcomes", "Subgroup data"],
                  [0.3, 0.25, 0.25, 0.2], landscape=EVIDENCE_L), "evidence_sufficient", LOW2),
    _with(_single("fu_slow_results", "What is the main reason results are slow?", "Biomarker testing", ["Send-out lab", "Pathology backlog", "Insufficient tissue", "Ordering workflow"],
                  [0.35, 0.25, 0.2, 0.2], landscape=BIOMARKER_L), "testing_fast", LOW2),
    _with(_num("fu_started_count", "How many patients have you started on {drug} in the last six months?", "Patient volume", 1, 20, 1, 0.3, e=0.3), "started_recently", YES),
    _with(_num("fu_pct_ctdna", "What percentage of your patients on {drug} are monitored with ctDNA? (%)", "Emerging: ctDNA", 5, 100, 5, 0.3, e=0.2, landscape=BIOMARKER_L), "uses_ctdna", YES),
    _with(_num("fu_pct_earlier", "What percentage of your eligible patients would you move earlier? (%)", "Sequencing", 5, 80, 5, 0.4, e=0.3, survey=TRACKER), "tracker_earlier", YES),
    _with(_num("fu_denials", "How many prior authorization denials did you have in the past 90 days?", "Access", 0, 12, 1, 0.3, a=0.5, landscape=ACCESS_L), "barriers_multi", ("has", {"Prior authorization burden"})),
    _with(_date("fu_last_start", "On what date did you start your most recent patient?", "Prescribing intent", -180, -1), "started_recently", YES),
    _with(_yn("fu_turnaround_delay", "Does turnaround time delay treatment decisions?", "Biomarker testing", 0.55, a=0.4, landscape=BIOMARKER_L), "test_method", ("in", {"Send-out reference lab", "Tissue NGS panel"})),
    _with(_yn("fu_peer_to_peer", "Have you needed a peer-to-peer review in the last 90 days?", "Access", 0.6, a=0.7, landscape=ACCESS_L), "barriers_multi", ("has", {"Prior authorization burden", "Cost / coverage"})),
    _with(_yn("fu_pft", "Do you use pre-treatment pulmonary function testing?", "Safety", 0.4, e=0.1, landscape=SAFETY_L), "patient_factors", ("has", {"Lung disease history"})),
    _with(_yn("fu_refer_trial", "Are you referring eligible patients to the trial?", "Trial design", 0.7, e=0.3, landscape=EVIDENCE_L), "site_trial", YES),
    _with(_multi("fu_increase_factors", "Which factors would increase your likelihood to use {drug}?", "Prescribing intent",
                 ["Stronger efficacy data", "Easier coverage", "Simpler monitoring", "Guideline endorsement", "Peer experience", "Patient demand"], [0.4, 0.4, 0.3, 0.35, 0.25, 0.2],
                 survey=TRACKER, p={"a_opts": {"Easier coverage": 1.4}}), "tracker_likelihood", LOW6),
    _with(_multi("fu_concerns", "Which concerns apply to {drug}?", "Prescribing intent",
                 ["Efficacy in my patients", "Tolerability", "Monitoring workload", "Coverage", "Lack of guidelines"], [0.3, 0.4, 0.3, 0.4, 0.2], p={"a_opts": {"Coverage": 1.4}}), "recommend", LOW6),
    _with(_multi("fu_payers", "Which payers cause the most difficulty?", "Access", ["Commercial", "Medicare", "Medicaid", "Regional plan", "Pharmacy benefit manager"], [0.35, 0.25, 0.3, 0.2, 0.3],
                 landscape=ACCESS_L), "coverage_limits", YES),
    _with(_likert("fu_ae_confidence", "I am confident managing {ae} in patients on {drug}.", "Safety", 3.6, e=0.7, landscape=SAFETY_L), "ae_support", ("has", {"Dose reduction protocol", "Steroid protocol"})),
    _with(_likert("fu_tolerated", "My patients on {drug} have tolerated it well.", "Safety", 3.7, e=0.5, landscape=SAFETY_L), "safety_manageable", ("ge", 4)),
    _with(_rank("fu_rank_recommend", "Rank what drives your recommendation of {drug}.", "Prescribing intent",
                ["Efficacy", "Safety / tolerability", "Patient outcomes", "Convenience", "Guideline endorsement"], [0.9, 0.7, 0.7, 0.3, 0.4]), "recommend", HIGH9),
    _with(_rating("fu_outcome_satisfaction", "How satisfied are you with patient outcomes so far?", "Efficacy", 7.2, e=1.2), "months_on_drug", ("ge", 12)),
    _with(_yn("fu_trial_nearby", "Are suitable trials available within travel distance of your patients?", "Trial design", 0.45, landscape=EVIDENCE_L), "post_progression", ("in", {"Enroll in a clinical trial"})),
    _with(_single("fu_denial_reason", "What is the main denial reason cited?", "Access", ["Not medically necessary", "Step therapy not met", "Off-label", "Missing biomarker documentation"],
                  [0.3, 0.3, 0.15, 0.25], landscape=ACCESS_L, p={"a_opts": {"Step therapy not met": 0.6}}), "payer_experience", ("in", {"Frequently denied"})),
    _with(_single("fu_incomplete_testing", "What is the main reason for incomplete testing?", "Biomarker testing", ["Insufficient tissue", "Cost", "Ordering workflow", "Patient declined"],
                  [0.35, 0.2, 0.3, 0.15], landscape=BIOMARKER_L, p={"a_opts": {"Cost": 1.0}}), "pct_tested", ("le", 60)),
]

# Q-0100 is the planted orphan (its parent id is not in the catalog), so concept 24 (Q-0097..Q-0100)
# must be a follow-up concept. All other concepts keep their authored order around it.
_ROOTS = _ROOTS_A + _ROOTS_B
_ORDER = _ROOTS[:24] + [_CHILDREN[0]] + _ROOTS[24:] + _CHILDREN[1:]
CONCEPTS: tuple[Concept, ...] = tuple(_ORDER)
BY_KEY = {c.key: c for c in CONCEPTS}
INDEX = {c.key: i for i, c in enumerate(CONCEPTS)}
CHILDREN_OF: dict[str, list[Concept]] = {}
for _concept in CONCEPTS:
    if _concept.parent:
        CHILDREN_OF.setdefault(_concept.parent, []).append(_concept)

assert len(CONCEPTS) == 100, len(CONCEPTS)
assert len(BY_KEY) == 100
assert sum(1 for c in CONCEPTS if c.parent) == 39, sum(1 for c in CONCEPTS if c.parent)
assert CONCEPTS[0].qtype == "single_choice" and CONCEPTS[0].key == "line_placement"
assert CONCEPTS[24].parent is not None
assert all(c.parent in BY_KEY for c in CONCEPTS if c.parent)


def qid(concept_key: str, program: int) -> str:
    return f"Q-{INDEX[concept_key] * 4 + program + 1:04}"


def ext_to_concept(qstn_ext_id: str) -> tuple[Concept, int]:
    n = int(qstn_ext_id[2:]) - 1
    return CONCEPTS[n // 4], n % 4


def render(template: str, program: int) -> str:
    return template.format(drug=MOLECULES[program], tumor=TUMORS[program], study=STUDIES[program], biomarker=BIOMARKERS[program], ae=ADVERSE_EVENTS[program])


def triggered(child: Concept, parent_answer: str) -> bool:
    """Does the parent's stored answer text trigger the child concept?"""
    kind, arg = child.trigger
    if kind == "in":
        return parent_answer in arg
    if kind == "has":
        return bool(set(parent_answer.split(";")) & arg)
    value = float(parent_answer)
    return value <= arg if kind == "le" else value >= arg
