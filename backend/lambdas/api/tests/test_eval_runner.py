"""Operational scheduling tests for the golden-suite runner."""

from a2g_api.eval_runner import CLI_WORKERS, DEFAULT_WORKERS, _worker_count
from a2g_api.settings import Settings


def _settings(llm_backend: str) -> Settings:
    return Settings(
        env="local",
        issuer="https://issuer.example.test",
        jwks_url="https://issuer.example.test/.well-known/jwks.json",
        client_ids=("client",),
        trust_appsync_identity=True,
        db_dsn="postgresql://unused",
        default_range_days=90,
        llm_backend=llm_backend,
    )


def test_cli_suites_use_both_sustainable_bridge_slots() -> None:
    assert _worker_count(_settings("claude-cli")) == CLI_WORKERS == 2
    assert _worker_count(_settings("codex-cli")) == CLI_WORKERS


def test_api_and_deployed_suites_keep_their_broader_fanout() -> None:
    assert _worker_count(_settings("api")) == DEFAULT_WORKERS == 6
