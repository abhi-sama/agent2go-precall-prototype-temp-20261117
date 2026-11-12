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


LOOKUP = {
    "type": "function",
    "function": {
        "name": "lookup",
        "parameters": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "What to look up."},
                "from_date": {"type": "string", "default": ""},
                "limit": {"type": "integer", "default": 5},
            },
            "required": ["query"],
        },
    },
}
FOLLOW_UPS = {
    "type": "function",
    "function": {
        "name": "suggest_follow_ups",
        "parameters": {
            "type": "object",
            "properties": {"questions": {"type": "array", "items": {"type": "string"}}},
            "required": ["questions"],
        },
    },
}


def test_reply_schema_gives_each_declared_tool_its_own_strict_argument_object():
    schema = cli_llm.reply_schema([LOOKUP, FOLLOW_UPS])

    lookup, follow_ups = schema["properties"]["tool_calls"]["items"]["anyOf"]
    assert lookup["properties"]["name"] == {"type": "string", "enum": ["lookup"]}
    arguments = lookup["properties"]["input"]
    assert arguments["additionalProperties"] is False
    assert arguments["required"] == ["query", "from_date", "limit"]
    assert arguments["properties"]["query"] == {"description": "What to look up.", "type": "string"}
    assert arguments["properties"]["from_date"] == {"type": ["string", "null"]}
    assert arguments["properties"]["limit"] == {"type": ["integer", "null"]}
    assert follow_ups["properties"]["input"]["properties"]["questions"] == {"type": "array", "items": {"type": "string"}}
    assert "input_json" not in json.dumps(schema)


def test_reply_schema_without_tools_only_allows_text():
    assert cli_llm.reply_schema([])["properties"]["kind"]["enum"] == ["text"]


def test_reply_schema_keeps_a_serialized_fallback_for_an_untranslatable_tool():
    odd = {"type": "function", "function": {"name": "odd", "parameters": {"type": "object", "additionalProperties": True}}}

    (item,) = cli_llm.reply_schema([odd])["properties"]["tool_calls"]["items"]["anyOf"]

    assert item["required"] == ["name", "input_json"]
    reply = cli_llm._parse_reply(
        '{"kind":"tool_calls","content":null,"tool_calls":[{"name":"odd","input_json":"{\\"x\\":1}"}]}', [odd]
    )
    assert reply.tool_calls[0].input == {"x": 1}


def test_strict_cli_contract_decodes_structured_arguments_and_drops_omitted_optionals():
    reply = cli_llm._parse_reply(
        '{"kind":"tool_calls","content":null,"tool_calls":['
        '{"name":"lookup","input":{"query":"x","from_date":null,"limit":null}},'
        '{"name":"lookup","input":{"query":"y","from_date":"2026-10-01","limit":2}}]}',
        [LOOKUP],
    )

    assert [call.input for call in reply.tool_calls] == [
        {"query": "x"},
        {"query": "y", "from_date": "2026-10-01", "limit": 2},
    ]
    ids = [call.id for call in reply.tool_calls]
    assert all(call_id.startswith("a2g_") for call_id in ids) and len(set(ids)) == 2


def test_strict_cli_contract_rejects_an_undeclared_tool():
    try:
        cli_llm._parse_reply('{"kind":"tool_calls","content":null,"tool_calls":[{"name":"exec","input":{}}]}', [LOOKUP])
    except cli_llm.CliFailure as error:
        assert error.kind == "contract"
    else:
        raise AssertionError("an undeclared tool must not reach the agent")


def test_strict_cli_contract_rejects_the_observed_runaway_argument_string():
    # Captured from a failing eval turn: the serialized arguments never closed and
    # continued with leaked reasoning tokens. This is why arguments are now objects.
    runaway = (
        '{"kind":"tool_calls","content":null,"tool_calls":[{"name":"suggest_follow_ups","input_json":'
        '"{\\"questions\\":[\\"What themes are emerging?\\"]}]}]} assistant to=functions.exec no. final"}]}'
    )
    try:
        cli_llm._parse_reply(runaway, [{"type": "function", "function": {"name": "suggest_follow_ups"}}])
    except cli_llm.CliFailure as error:
        assert error.kind == "contract"
    else:
        raise AssertionError("a runaway argument string must be rejected")


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


def test_claude_receives_the_api_system_prompt_at_system_priority(monkeypatch):
    captured: dict[str, str] = {}

    async def fake_claude(prompt, _model, _cwd, _timeout, system_prompt, _tools):
        captured["prompt"] = prompt
        captured["system_prompt"] = system_prompt
        return cli_llm.ModelReply(kind="text", content="ok")

    monkeypatch.setenv("LLM_BACKEND", "claude-cli")
    monkeypatch.setattr(cli_llm, "_claude", fake_claude)
    reply = asyncio.run(
        cli_llm._complete(
            {
                "messages": [
                    {"role": "system", "content": "Use tools for every data question."},
                    {"role": "user", "content": "How many calls did I have?"},
                ]
            }
        )
    )

    assert reply.content == "ok"
    assert "Use tools for every data question." in captured["system_prompt"]
    assert "Use tools for every data question." not in captured["prompt"]
    assert "How many calls did I have?" in captured["prompt"]


def test_claude_retries_a_false_tool_unavailable_reply(monkeypatch):
    prompts: list[str] = []

    async def fake_claude(prompt, *_args):
        prompts.append(prompt)
        if len(prompts) == 1:
            return cli_llm.ModelReply(kind="text", content="The chart tool isn't available.")
        return cli_llm.ModelReply(kind="tool_calls", tool_calls=[{"id": "call_1", "name": "show_chart", "input": {}}])

    monkeypatch.setenv("LLM_BACKEND", "claude-cli")
    monkeypatch.setattr(cli_llm, "_claude", fake_claude)
    reply = asyncio.run(cli_llm._complete({"messages": [{"role": "user", "content": "Compare months."}], "tools": [{"type": "function"}]}))

    assert reply.kind == "tool_calls" and len(prompts) == 2
    assert "Do not claim it is unavailable" in prompts[1]


def test_tool_unavailable_retry_catches_past_tense_refusals():
    payload = {"tools": [{"type": "function"}]}
    assert cli_llm._must_retry_for_tool(cli_llm.ModelReply(kind="text", content="The search tool wasn't available."), payload)


def test_tool_unavailable_retry_catches_a_generic_data_failure_before_any_tool_result():
    payload = {
        "tools": [{"type": "function"}],
        "messages": [{"role": "user", "content": "How many HCPs engaged on a product in October?"}],
    }

    assert cli_llm._must_retry_for_tool(
        cli_llm.ModelReply(
            kind="text",
            content="I couldn't get that count. The data lookup failed, so I don't have a number.",
        ),
        payload,
    )


def test_tool_unavailable_retry_does_not_repeat_after_a_current_turn_tool_result():
    payload = {
        "tools": [{"type": "function"}],
        "messages": [
            {"role": "user", "content": "How many calls?"},
            {"role": "assistant", "tool_calls": [{"id": "call_1"}]},
            {"role": "tool", "tool_call_id": "call_1", "content": '{"status":"out_of_scope"}'},
        ],
    }

    assert not cli_llm._must_retry_for_tool(
        cli_llm.ModelReply(kind="text", content="I can't give that count because the data is unavailable."), payload
    )


def test_claude_command_sets_the_system_prompt_flag(monkeypatch, tmp_path):
    captured: dict[str, object] = {}

    async def fake_run(command, prompt, cwd, timeout):
        captured.update(command=command, prompt=prompt, cwd=cwd, timeout=timeout)
        return json.dumps({"result": json.dumps({"kind": "text", "content": "ok", "tool_calls": []})})

    monkeypatch.setattr(cli_llm, "_run", fake_run)
    reply = asyncio.run(cli_llm._claude("conversation", "claude-haiku-5-5", tmp_path, 31, "API system", [LOOKUP]))

    assert reply.content == "ok"
    command = captured["command"]
    assert isinstance(command, list)
    assert command[command.index("--system-prompt") + 1] == "API system"
    assert captured["prompt"] == "conversation"
    assert captured["cwd"] == tmp_path and captured["timeout"] == 31
    assert json.loads(command[command.index("--json-schema") + 1]) == cli_llm.reply_schema([LOOKUP])


def test_codex_prompt_makes_system_rules_and_tools_explicit():
    payload = cli_llm._normalise_request(
        {
            "messages": [
                {"role": "system", "content": "Use data tools before answering."},
                {"role": "assistant", "content": None, "tool_calls": [{"id": "call_1"}]},
                {"role": "tool", "tool_call_id": "call_1", "content": "42"},
                {"role": "user", "content": "How many calls?"},
            ],
            "tools": [{"type": "function", "function": {"name": "lookup"}}],
        }
    )

    prompt = cli_llm._codex_prompt(payload)

    assert "APPLICATION RULES" in prompt and "Use data tools before answering." in prompt
    assert "DECLARATIVE TOOL DEFINITIONS" in prompt and '"name":"lookup"' in prompt
    assert "CONVERSATION HISTORY" in prompt and '"tool_call_id":"call_1"' in prompt


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
        raise cli_llm.CliFailure("exit")

    async def codex(*_args):
        return cli_llm.ModelReply(kind="text", content="fallback")

    monkeypatch.setenv("LLM_BACKEND", "claude-cli")
    monkeypatch.setattr(cli_llm, "_claude", unavailable)
    monkeypatch.setattr(cli_llm, "_codex", codex)
    reply = asyncio.run(cli_llm._complete({"messages": [{"role": "user", "content": "hi"}]}))
    assert reply.content == "fallback"


def test_codex_retries_once_after_an_unusable_reply(monkeypatch):
    attempts: list[int] = []

    async def codex(*_args):
        attempts.append(1)
        if len(attempts) == 1:
            raise cli_llm.CliFailure("contract")
        return cli_llm.ModelReply(kind="text", content="second attempt")

    monkeypatch.setenv("LLM_BACKEND", "codex-cli")
    monkeypatch.setattr(cli_llm, "_codex", codex)
    reply = asyncio.run(cli_llm._complete({"messages": [{"role": "user", "content": "hi"}]}))

    assert reply.content == "second attempt" and len(attempts) == 2


def test_codex_retries_a_stall_once_then_gives_up(monkeypatch):
    attempts: list[int] = []

    async def codex(*_args):
        attempts.append(1)
        raise cli_llm.CliFailure("timeout")

    monkeypatch.setenv("LLM_BACKEND", "codex-cli")
    monkeypatch.setattr(cli_llm, "_codex", codex)
    try:
        asyncio.run(cli_llm._complete({"messages": [{"role": "user", "content": "hi"}]}))
    except cli_llm.CliFailure as error:
        assert error.kind == "timeout"
    else:
        raise AssertionError("a second stall must fail the request")
    assert len(attempts) == 2


def test_codex_does_not_retry_a_missing_cli(monkeypatch):
    attempts: list[int] = []

    async def codex(*_args):
        attempts.append(1)
        raise cli_llm.CliFailure("unavailable")

    monkeypatch.setenv("LLM_BACKEND", "codex-cli")
    monkeypatch.setattr(cli_llm, "_codex", codex)
    try:
        asyncio.run(cli_llm._complete({"messages": [{"role": "user", "content": "hi"}]}))
    except cli_llm.CliFailure:
        pass
    assert len(attempts) == 1


def test_codex_writes_the_request_schema_and_ignores_a_stale_reply(monkeypatch, tmp_path):
    (tmp_path / "reply.json").write_text('{"kind":"text","content":"stale","tool_calls":[]}')

    async def fake_run(command, _prompt, _cwd, _timeout):
        schema = json.loads((tmp_path / "reply-schema.json").read_text())
        assert schema == cli_llm.reply_schema([LOOKUP])
        raise cli_llm.CliFailure("exit")

    monkeypatch.setattr(cli_llm, "_run", fake_run)
    try:
        asyncio.run(cli_llm._codex("prompt", tmp_path, 5, [LOOKUP]))
    except cli_llm.CliFailure:
        pass
    assert not (tmp_path / "reply.json").exists()


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
