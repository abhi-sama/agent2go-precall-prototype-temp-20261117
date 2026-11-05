"""Operational scheduling tests for the golden-suite runner."""

from dataclasses import replace

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


def test_local_cli_suite_can_opt_into_matching_bridge_slots() -> None:
    settings = replace(_settings("codex-cli"), cli_eval_workers=4)

    assert _worker_count(settings) == 4


def test_cli_worker_opt_in_is_ignored_outside_local_development() -> None:
    settings = replace(_settings("codex-cli"), env="aws", cli_eval_workers=4)

    assert _worker_count(settings) == CLI_WORKERS


def test_cli_eval_worker_setting_is_local_and_opt_in() -> None:
    env = {
        "A2G_ENV": "local",
        "A2G_COGNITO_ISSUER": "https://issuer.example.test",
        "A2G_COGNITO_CLIENT_IDS": "client",
        "A2G_DB_DSN": "postgresql://unused",
        "A2G_CLI_EVAL_WORKERS": "4",
    }

    assert Settings.from_env(env).cli_eval_workers == 4
    assert Settings.from_env({**env, "A2G_ENV": "aws"}).cli_eval_workers is None
    assert Settings.from_env({key: value for key, value in env.items() if key != "A2G_CLI_EVAL_WORKERS"}).cli_eval_workers is None
