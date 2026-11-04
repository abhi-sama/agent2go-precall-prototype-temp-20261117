"""Tiny deterministic RNG (SplitMix64), independent of the Python version.

``random.Random`` is stable in practice, but its helper algorithms (``choices``,
``shuffle``, ``sample``) have changed between releases. The seed must produce the same
rows on every machine and Python, so the generator draws only from this class.
"""
from __future__ import annotations

import hashlib
import math
from typing import Sequence, TypeVar

T = TypeVar("T")
_MASK = (1 << 64) - 1


class Rng:
    def __init__(self, *label: object) -> None:
        digest = hashlib.blake2b("|".join(str(part) for part in label).encode(), digest_size=8).digest()
        self._state = int.from_bytes(digest, "big")

    def fork(self, *label: object) -> "Rng":
        return Rng(self._state, *label)

    def u64(self) -> int:
        self._state = (self._state + 0x9E3779B97F4A7C15) & _MASK
        z = self._state
        z = ((z ^ (z >> 30)) * 0xBF58476D1CE4E5B9) & _MASK
        z = ((z ^ (z >> 27)) * 0x94D049BB133111EB) & _MASK
        return z ^ (z >> 31)

    def random(self) -> float:
        return (self.u64() >> 11) / float(1 << 53)

    def below(self, n: int) -> int:
        return int(self.random() * n)

    def between(self, lo: int, hi: int) -> int:
        """Inclusive integer range."""
        return lo + self.below(hi - lo + 1)

    def chance(self, p: float) -> bool:
        return self.random() < p

    def choice(self, items: Sequence[T]) -> T:
        return items[self.below(len(items))]

    def weighted(self, items: Sequence[T], weights: Sequence[float]) -> T:
        total = sum(weights)
        point = self.random() * total
        acc = 0.0
        for item, weight in zip(items, weights):
            acc += weight
            if point < acc:
                return item
        return items[-1]

    def normal(self, mean: float = 0.0, sd: float = 1.0) -> float:
        u1 = max(self.random(), 1e-12)
        return mean + sd * math.sqrt(-2.0 * math.log(u1)) * math.cos(2.0 * math.pi * self.random())

    def shuffled(self, items: Sequence[T]) -> list[T]:
        out = list(items)
        for i in range(len(out) - 1, 0, -1):
            j = self.below(i + 1)
            out[i], out[j] = out[j], out[i]
        return out
