"""Detector for the planted qualitative themes (no labels are stored in the database).

The fixture ``corpus/qualitative_corpus.json`` is organised by topic, so it doubles as
labelled training data. This module trains a small multinomial naive-Bayes text classifier
(stdlib only) on 70% of the fixture's answers and exposes ``HELD_OUT``: the other 30% of
answers, which the classifier has never seen. The unit test and the seeded-stack test
classify only held-out answers found in ``rspns_txt``, so "the planted themes, emerging
topics and shifts are detectable" is proved on text the detector did not memorise.

Real analytics would use embeddings or an LLM; this only has to show the signal is there.
"""
from __future__ import annotations

import hashlib
import json
import math
import re
from collections import Counter, defaultdict
from functools import lru_cache
from pathlib import Path

CORPUS = Path(__file__).resolve().parent / "corpus" / "qualitative_corpus.json"
THEMES = ["efficacy", "safety", "sequencing", "biomarker", "access", "guidelines", "trial_design", "competitor", "patient_selection", "unmet_need"]
EMERGING = ["ctdna", "pulm_surveillance", "early_stage"]
TOPICS = THEMES + EMERGING
_TOKEN = re.compile(r"[a-z][a-z0-9\-]+")


def is_held_out(text: str) -> bool:
    return hashlib.blake2b(text.encode(), digest_size=2).digest()[0] % 10 >= 7


def _features(text: str) -> list[str]:
    words = _TOKEN.findall(text.lower())
    return words + [a + "_" + b for a, b in zip(words, words[1:])]


@lru_cache(maxsize=1)
def _model():
    cells = json.loads(CORPUS.read_text())["cells"]
    counts: dict[str, Counter] = defaultdict(Counter)
    docs: Counter = Counter()
    for cell, entries in cells.items():
        topic = cell.split("|")[0]
        if topic not in TOPICS:
            continue
        for entry in entries:
            if is_held_out(entry["t"]):
                continue
            counts[topic].update(_features(entry["t"]))
            docs[topic] += 1
    vocab = {w for c in counts.values() for w in c}
    totals = {t: sum(c.values()) for t, c in counts.items()}
    return counts, totals, docs, len(vocab)


def classify(text: str) -> str:
    counts, totals, docs, v = _model()
    feats = _features(text)
    best, best_score = "", -math.inf
    n_docs = sum(docs.values())
    for topic in TOPICS:
        score = math.log(docs[topic] / n_docs)
        c, tot = counts[topic], totals[topic]
        for f in feats:
            score += math.log((c[f] + 0.5) / (tot + 0.5 * v))
        if score > best_score:
            best, best_score = topic, score
    return best


def held_out_accuracy() -> float:
    cells = json.loads(CORPUS.read_text())["cells"]
    ok = n = 0
    for cell, entries in cells.items():
        topic = cell.split("|")[0]
        if topic in TOPICS:
            for e in entries:
                if is_held_out(e["t"]):
                    n += 1
                    ok += classify(e["t"]) == topic
    return ok / n


if __name__ == "__main__":
    print(f"held-out accuracy: {held_out_accuracy():.3f}")
