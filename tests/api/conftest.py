from __future__ import annotations

import pytest

from harness import Persona, owner_db


@pytest.fixture(scope="session")
def msl() -> Persona:
    return Persona.sign_in("msl-t01-01")


@pytest.fixture(scope="session")
def other_msl() -> Persona:
    return Persona.sign_in("msl-t02-01")


@pytest.fixture
def db():
    with owner_db() as conn:
        yield conn
