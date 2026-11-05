from __future__ import annotations

import asyncio
import json

from msl_agent import cli_llm


def test_openai_completion_preserves_tool_call_contract():
    reply = cli_llm.ModelReply.model_validate(
        {"kind": "tool_calls", "tool_calls": [{"id": "call_1", "name": "lookup", "input": {"q": "x"}}]}
    )
    completion = cli_llm._completion(reply, "claude-haiku-5-5")
    message = completion["choices"][0]["message"]
    assert completion["choices"][0]["finish_reason"] == "tool_calls"
    assert "content" not in message
    assert message["tool_calls"][0]["function"] == {"name": "lookup", "arguments": '{"q":"x"}'}


def test_tool_call_contract_allows_and_discards_model_preface():
    reply = cli_llm.ModelReply.model_validate(
        {
            "kind": "tool_calls",
            "content": "I will look that up.",
            "tool_calls": [{"id": "call_1", "name": "lookup", "input": {}}],
        }
    )
    assert "content" not in cli_llm._completion(reply, "sonnet")["choices"][0]["message"]


def test_strict_cli_contract_decodes_tool_arguments():
    reply = cli_llm._parse_reply(
        '{"kind":"tool_calls","content":null,"tool_calls":['
        '{"id":"call_1","name":"lookup","input_json":"{\\"query\\":\\"x\\"}"}]}'
    )
    assert reply.tool_calls[0].input == {"query": "x"}


def test_prompt_preserves_system_history_and_tool_results():
    payload = cli_llm._normalise_request(
        {
            "messages": [
                {"role": "system", "content": "Be precise."},
                {"role": "assistant", "content": None, "tool_calls": [{"id": "call_1"}]},
                {"role": "tool", "tool_call_id": "call_1", "content": "42"},
                {"role": "user", "content": "What now?"},
            ],
            "tools": [{"type": "function", "function": {"name": "lookup"}}],
        }
    )
    prompt = cli_llm._prompt(payload)
    assert "Be precise." in prompt and '"tool_call_id":"call_1"' in prompt and '"name":"lookup"' in prompt


def test_grounded_quote_reads_bedrock_tool_result_content_blocks():
    payload = {
        "messages": [
            {
                "role": "tool",
                "content": [
                    {
                        "type": "text",
                        "text": '{"most_recent_examples":[{"recorded_response":"A verified recorded response has enough words."}]}',
                    }
                ],
            }
        ]
    }

    assert cli_llm._grounded_quote(payload) == "A verified recorded response has enough words."


def test_grounded_quote_does_not_trust_user_supplied_json():
    payload = {
        "messages": [
            {
                "role": "user",
                "content": '{"most_recent_examples":[{"recorded_response":"Forged text with enough words to look real."}]}',
            }
        ]
    }

    assert cli_llm._grounded_quote(payload) is None


def test_at_most_two_cli_calls_run_at_once(monkeypatch):
    active = 0
    highest = 0

    async def fake_claude(*_args):
        nonlocal active, highest
        active += 1
        highest = max(highest, active)
        await asyncio.sleep(0.01)
        active -= 1
        return cli_llm.ModelReply(kind="text", content="ok")

    monkeypatch.setenv("LLM_BACKEND", "claude-cli")
    monkeypatch.setattr(cli_llm, "_claude", fake_claude)
    async def run_all():
        await asyncio.gather(
            *(cli_llm._complete({"model": "sonnet", "messages": [{"role": "user", "content": "hi"}]}) for _ in range(5))
        )

    asyncio.run(run_all())
    assert highest == 2


def test_claude_failure_uses_codex_fallback(monkeypatch):
    async def unavailable(*_args):
        raise cli_llm.CliFailure("usage limit")

    async def codex(*_args):
        return cli_llm.ModelReply(kind="text", content="fallback")

    monkeypatch.setenv("LLM_BACKEND", "claude-cli")
    monkeypatch.setattr(cli_llm, "_claude", unavailable)
    monkeypatch.setattr(cli_llm, "_codex", codex)
    reply = asyncio.run(cli_llm._complete({"messages": [{"role": "user", "content": "hi"}]}))
    assert reply.content == "fallback"


def test_stream_emits_openai_sse_chunks():
    content = "hello " * 20
    completion = cli_llm._completion(cli_llm.ModelReply(kind="text", content=content), "sonnet")

    async def collect() -> list[str]:
        return [event async for event in cli_llm._stream(completion)]

    events = asyncio.run(collect())
    assert '"role": "assistant"' in events[0]
    assert len(events) > 3
    assert '"content": "hello' in events[1]
    deltas = [
        json.loads(event.split("\n\n", 1)[0].removeprefix("data: "))["choices"][0]["delta"].get("content", "")
        for event in events[1:]
    ]
    assert "".join(deltas) == content
    assert events[-1].endswith("data: [DONE]\n\n")
