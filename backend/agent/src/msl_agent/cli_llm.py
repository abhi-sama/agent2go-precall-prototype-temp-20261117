"""A local OpenAI-compatible bridge backed by subscription CLIs.

The bridge deliberately has no credentials configuration.  It starts the installed
``claude`` or ``codex`` executable, which performs its own subscription
authentication, from an empty temporary directory.  This keeps the Bedrock
Converse boundary intact while allowing floci to use a local model provider.
"""

from __future__ import annotations

import asyncio
import json
import os
import re
import tempfile
import time
import uuid
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any, Literal

from a2g_logging import get_logger
from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, ConfigDict, Field, model_validator


def _positive_env(name: str, default: int) -> int:
    """Read a small operational limit without letting a bad local env wedge the bridge."""
    try:
        return max(1, int(os.getenv(name, str(default))))
    except ValueError:
        return default


# The subscription CLI is much slower than an API, but two independent
# subprocesses are sustainable.  The eval runner keeps each suite to one
# request at a time, so four suites create a bounded queue instead of a burst.
MAX_IN_FLIGHT = _positive_env("A2G_CLI_MAX_IN_FLIGHT", 2)
# A stalled subscription CLI must not wedge an AppSync chat run or the two-slot
# queue.  Callers may raise this deliberately, but local development fails over
# promptly by default.
DEFAULT_TIMEOUT_SECONDS = 120
_TOOL_UNAVAILABLE = re.compile(r"\b(?:tool|chart)\b.{0,80}(?:not available|unavailable|isn't|is not|wasn't|was not|can't|cannot)", re.I)
_DATA_LOOKUP_FAILURE = re.compile(
    r"(?:\b(?:data\s+(?:lookup|tool|tools|source|sources)|lookup|retriev(?:e|al)|count|breakdown|number|share)\b"
    r".{0,80}\b(?:failed|error(?:s)?|unavailable|can't|cannot|couldn't|could not)\b"
    r"|\b(?:can't|cannot|couldn't|could not)\b.{0,80}"
    r"\b(?:get|retrieve|provide)\b.{0,80}\b(?:count|breakdown|number|share)\b)",
    re.I,
)
log = get_logger(__name__)


class ToolCall(BaseModel):
    """The only tool-call shape the CLI is allowed to return."""

    id: str = Field(min_length=1, max_length=128)
    name: str = Field(min_length=1, max_length=128)
    input: dict[str, Any]


class ModelReply(BaseModel):
    """Strict contract used instead of giving either CLI executable tools."""

    kind: Literal["text", "tool_calls"]
    content: str | None = None
    tool_calls: list[ToolCall] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_shape(self) -> ModelReply:
        if self.kind == "text" and (self.content is None or self.tool_calls):
            raise ValueError("text replies need content and cannot contain tool_calls")
        if self.kind == "tool_calls" and not self.tool_calls:
            raise ValueError("tool replies need tool_calls")
        return self


class CliFailure(RuntimeError):
    """A non-successful CLI invocation; Claude failures may use the fallback.

    ``kind`` is a fixed category (unavailable, timeout, exit or contract) that is
    safe to log; the CLI's own output never is.
    """

    def __init__(self, kind: Literal["unavailable", "timeout", "exit", "contract"]) -> None:
        super().__init__(f"CLI failure: {kind}")
        self.kind = kind


# Every reply schema is hand-written instead of using Pydantic's schema output.
# Codex's strict structured-output endpoint requires every object to forbid extra
# properties and to list every property as required.
_STRICT_SCALARS = frozenset({"string", "integer", "number", "boolean", "null"})
_STRICT_KEYWORDS = ("description", "enum")


def _strict(schema: Any) -> dict[str, Any] | None:
    """Translate one tool-parameter JSON schema into strict structured-output form.

    Optional properties become required-but-nullable, because strict mode cannot
    express an omitted property; ``_drop_optional_nulls`` restores the omission
    before the arguments reach the agent. ``None`` means the schema uses a
    construct this translation does not understand.
    """
    if not isinstance(schema, dict):
        return None
    if "anyOf" in schema:
        options = [_strict(option) for option in schema["anyOf"]]
        return None if any(option is None for option in options) else {"anyOf": options}
    kind = schema.get("type")
    kept = {key: schema[key] for key in _STRICT_KEYWORDS if key in schema}
    if kind == "object":
        properties = schema.get("properties", {})
        if not isinstance(properties, dict) or schema.get("additionalProperties") not in (None, False):
            return None
        required = set(schema.get("required", []))
        strict_properties: dict[str, Any] = {}
        for name, value in properties.items():
            translated = _strict(value)
            if translated is None:
                return None
            strict_properties[name] = translated if name in required else _nullable(translated)
        return {
            **kept,
            "type": "object",
            "additionalProperties": False,
            "required": list(strict_properties),
            "properties": strict_properties,
        }
    if kind == "array":
        items = _strict(schema.get("items", {"type": "string"}))
        return None if items is None else {**kept, "type": "array", "items": items}
    if isinstance(kind, str) and kind in _STRICT_SCALARS:
        return {**kept, "type": kind}
    if isinstance(kind, list) and kind and all(isinstance(item, str) and item in _STRICT_SCALARS for item in kind):
        return {**kept, "type": kind}
    return None


def _nullable(schema: dict[str, Any]) -> dict[str, Any]:
    if "anyOf" in schema:
        options = schema["anyOf"]
        return schema if {"type": "null"} in options else {"anyOf": [*options, {"type": "null"}]}
    kind = schema["type"]
    kinds = kind if isinstance(kind, list) else [kind]
    if "null" in kinds:
        return schema
    if "enum" in schema:
        return {"anyOf": [schema, {"type": "null"}]}
    return {**schema, "type": [*kinds, "null"]}


def _tool_function(tool: Any) -> dict[str, Any] | None:
    function = tool.get("function") if isinstance(tool, dict) else None
    name = function.get("name") if isinstance(function, dict) else None
    return function if isinstance(name, str) and name else None


def _tool_call_schema(function: dict[str, Any]) -> dict[str, Any]:
    """The reply shape for one declared tool: its exact name and its own argument schema.

    Arguments are a structured object, never a JSON document inside a string: the
    CLI's constrained decoder can enforce an object's structure, but a string field
    accepts any text, and Codex intermittently continued an ``input_json`` string
    with leaked reasoning tokens instead of closing it.
    """
    name = {"type": "string", "enum": [function["name"]]}
    parameters = _strict(function.get("parameters") or {"type": "object", "properties": {}})
    if parameters is None or parameters.get("type") != "object":
        # A schema strict mode cannot express still gets a pinned name; its
        # arguments use the serialized fallback and are validated on parse.
        return {
            "type": "object",
            "additionalProperties": False,
            "required": ["name", "input_json"],
            "properties": {"name": name, "input_json": {"type": "string"}},
        }
    return {
        "type": "object",
        "additionalProperties": False,
        "required": ["name", "input"],
        "properties": {"name": name, "input": parameters},
    }


def reply_schema(tools: list[Any]) -> dict[str, Any]:
    """The strict reply contract for one request, generated from the tools it declares."""
    functions = [function for tool in tools if (function := _tool_function(tool)) is not None]
    if functions:
        kinds = ["text", "tool_calls"]
        item: dict[str, Any] = {"anyOf": [_tool_call_schema(function) for function in functions]}
    else:
        # Nothing is callable, so only a text reply is valid.
        kinds = ["text"]
        item = {"type": "object", "additionalProperties": False, "required": [], "properties": {}}
    return {
        "type": "object",
        "additionalProperties": False,
        "required": ["kind", "content", "tool_calls"],
        "properties": {
            "kind": {"type": "string", "enum": kinds},
            "content": {"type": ["string", "null"]},
            "tool_calls": {"type": "array", "items": item},
        },
    }


def _drop_optional_nulls(value: Any, schema: Any) -> Any:
    """Undo ``_strict``'s nullable stand-in for an omitted optional argument."""
    if not isinstance(value, dict) or not isinstance(schema, dict) or schema.get("type") != "object":
        return value
    properties = schema.get("properties", {})
    required = set(schema.get("required", []))
    return {
        key: _drop_optional_nulls(item, properties.get(key))
        for key, item in value.items()
        if item is not None or key in required
    }


app = FastAPI(title="agent2go local CLI LLM", docs_url=None, redoc_url=None)
_capacity = asyncio.Semaphore(MAX_IN_FLIGHT)


class CliToolCall(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=128)
    input: dict[str, Any] | None = None
    input_json: str | None = None


class CliReply(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: Literal["text", "tool_calls"]
    content: str | None
    tool_calls: list[CliToolCall]


def _model_alias(model: str) -> str:
    return "haiku" if "haiku" in model.lower() else "sonnet"


def _message_text(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "\n".join(
            block.get("text", "") if isinstance(block, dict) and block.get("type") == "text" else json.dumps(block)
            for block in content
        )
    return json.dumps(content)


def _normalise_request(request: dict[str, Any]) -> dict[str, Any]:
    messages = request.get("messages")
    if not isinstance(messages, list) or not messages:
        raise HTTPException(status_code=422, detail="messages must be a non-empty array")

    system: list[str] = []
    turns: list[dict[str, Any]] = []
    for raw in messages:
        if not isinstance(raw, dict) or not isinstance(raw.get("role"), str):
            raise HTTPException(status_code=422, detail="each message needs a role")
        if raw["role"] == "system":
            system.append(_message_text(raw.get("content", "")))
            continue
        # Preserve assistant tool calls and subsequent tool results verbatim in the
        # contract payload.  They are context for the model, never executable tools.
        turn = {"role": raw["role"], "content": raw.get("content")}
        if raw.get("tool_calls") is not None:
            turn["tool_calls"] = raw["tool_calls"]
        if raw.get("tool_call_id") is not None:
            turn["tool_call_id"] = raw["tool_call_id"]
        turns.append(turn)

    tools = request.get("tools", [])
    if not isinstance(tools, list):
        raise HTTPException(status_code=422, detail="tools must be an array")
    return {"system": "\n\n".join(system), "messages": turns, "tools": tools}


_ADAPTER_SYSTEM_PROMPT = """You are a model adapter, not an agent. Do not use tools, browse, read files, or execute commands.
Answer the conversation encoded below. Tool definitions are declarative: if a tool is needed, return a tool_calls
reply. Give every tool call the declared tool's name and its arguments as the input object, using null for an optional
argument you leave out. Tool-result messages are prior results and must
be used as conversational context. Return exactly one JSON object that conforms to the supplied schema, with no
Markdown or explanation. In a data-grounded answer, use double quotation marks only for exact, verbatim text from a
tool result. Do not quote your own framing, paraphrases, labels, dates, or explanations."""


def _prompt(payload: dict[str, Any], *, include_system: bool = True) -> str:
    """Encode only the conversation data for the CLI's user turn.

    Claude CLI receives the application's system prompt through ``--system-prompt``. Keep the
    complete form for Codex, which has no equivalent non-interactive system-prompt flag.
    """
    conversation = payload if include_system else {"messages": payload["messages"], "tools": payload["tools"]}
    return "CONVERSATION:\n" + json.dumps(conversation, ensure_ascii=False, separators=(",", ":"))


def _claude_system_prompt(payload: dict[str, Any]) -> str:
    """Keep the API system instructions at real system priority in Claude CLI."""
    system = payload["system"].strip()
    return f"{system}\n\n{_ADAPTER_SYSTEM_PROMPT}" if system else _ADAPTER_SYSTEM_PROMPT


def _codex_prompt(payload: dict[str, Any]) -> str:
    """Make the application protocol legible to Codex's single prompt channel.

    ``codex exec`` has no non-interactive system-prompt option.  Putting the
    application system message and the tool contract in named instruction
    sections is materially different from serialising them as data inside a
    conversation object: the model must decide whether to emit the strict
    ``tool_calls`` reply before it can see any tool result.
    """
    system = payload["system"].strip()
    return (
        "APPLICATION RULES (follow these rules while answering):\n"
        f"{system}\n\n"
        f"{_ADAPTER_SYSTEM_PROMPT}\n\n"
        "DECLARATIVE TOOL DEFINITIONS (return tool_calls to use one; do not claim tools are unavailable):\n"
        f"{json.dumps(payload['tools'], ensure_ascii=False, separators=(',', ':'))}\n\n"
        "CONVERSATION HISTORY:\n"
        f"{json.dumps(payload['messages'], ensure_ascii=False, separators=(',', ':'))}"
    )


def _recorded_quote(content: Any) -> str | None:
    """Find a read-tool quote in either OpenAI text or Bedrock content-block form."""
    if isinstance(content, str):
        try:
            return _recorded_quote(json.loads(content))
        except json.JSONDecodeError:
            return None
    if isinstance(content, list):
        for item in content:
            if quote := _recorded_quote(item):
                return quote
        return None
    if not isinstance(content, dict):
        return None

    examples = content.get("most_recent_examples", [])
    if isinstance(examples, list):
        for example in examples:
            quote = example.get("recorded_response") if isinstance(example, dict) else None
            if isinstance(quote, str) and len(quote.split()) >= 4:
                return quote.replace('"', "'")
    # Bedrock's proxy represents a tool result as a text content block.  Recurse
    # only within the trusted tool-result turn, never across user messages.
    return _recorded_quote(content.get("text"))


def _grounded_quote(payload: dict[str, Any]) -> str | None:
    """Return one verbatim response supplied by the read tool, never model prose."""
    for turn in payload["messages"]:
        content = turn.get("content")
        # Bedrock converts tool results to a user turn containing structured
        # content blocks. A plain user string is never eligible: otherwise a
        # user could forge the evidence JSON contract in their prompt.
        trusted_tool_result = turn["role"] == "tool" or isinstance(content, (dict, list))
        if trusted_tool_result and (quote := _recorded_quote(content)):
            return quote
    return None


def _ground_quotes(reply: ModelReply, payload: dict[str, Any]) -> ModelReply:
    if reply.kind != "text" or reply.content is None:
        return reply
    quote = _grounded_quote(payload)
    if quote is None:
        return reply
    # Model prose is never allowed to masquerade as a source quote. Preserve a
    # single quote copied byte-for-byte from the read-tool evidence instead.
    text = reply.content.translate(str.maketrans({'"': "'", "“": "'", "”": "'"}))
    return ModelReply(kind="text", content=f'{text}\n\nRecorded response: "{quote}"')


def _must_retry_for_tool(reply: ModelReply, payload: dict[str, Any]) -> bool:
    """Repair the CLI's occasional false claim that declared tools do not exist."""
    messages = payload.get("messages", [])
    latest_user = max(
        (index for index, message in enumerate(messages) if message.get("role") == "user"), default=-1
    )
    has_current_turn_tool_result = any(
        message.get("role") == "tool" for message in messages[latest_user + 1 :]
    )
    return bool(
        payload["tools"]
        and not has_current_turn_tool_result
        and reply.kind == "text"
        and reply.content
        and (_TOOL_UNAVAILABLE.search(reply.content) or _DATA_LOOKUP_FAILURE.search(reply.content))
    )


async def _run(command: list[str], prompt: str, cwd: Path, timeout: int) -> str:
    try:
        process = await asyncio.create_subprocess_exec(
            *command,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=cwd,
        )
    except FileNotFoundError as error:
        raise CliFailure("unavailable") from error
    try:
        stdout, _stderr = await asyncio.wait_for(process.communicate(prompt.encode()), timeout=timeout)
    except TimeoutError as error:
        process.kill()
        await process.wait()
        raise CliFailure("timeout") from error
    if process.returncode:
        # stderr can include model output or account details; never return or log it.
        raise CliFailure("exit")
    return stdout.decode("utf-8", errors="replace")


def _parse_reply(raw: str, tools: list[Any]) -> ModelReply:
    """Validate a CLI reply against the request's own tools.

    Call ids are transport metadata owned by the bridge: the CLI never sees an
    id field, and every call gets one that is unique across the conversation.
    """
    parameters = {function["name"]: function.get("parameters") for tool in tools if (function := _tool_function(tool))}
    try:
        parsed = CliReply.model_validate_json(raw)
        calls: list[ToolCall] = []
        for call in parsed.tool_calls:
            if call.name not in parameters or (call.input is None) == (call.input_json is None):
                raise ValueError("tool call must name a declared tool and carry one argument form")
            arguments = call.input if call.input is not None else json.loads(call.input_json or "")
            if not isinstance(arguments, dict):
                raise ValueError("tool arguments must be an object")
            calls.append(
                ToolCall(
                    id=f"a2g_{uuid.uuid4().hex}",
                    name=call.name,
                    input=_drop_optional_nulls(arguments, parameters[call.name]),
                )
            )
        return ModelReply(kind=parsed.kind, content=parsed.content, tool_calls=calls)
    except (json.JSONDecodeError, ValueError) as error:
        raise CliFailure("contract") from error


def _parse_claude(raw: str, tools: list[Any]) -> ModelReply:
    try:
        result = json.loads(raw)
        text = result.get("result", result) if isinstance(result, dict) else result
        return _parse_reply(text if isinstance(text, str) else json.dumps(text), tools)
    except (json.JSONDecodeError, ValueError) as error:
        raise CliFailure("contract") from error


async def _claude(
    prompt: str, model: str, cwd: Path, timeout: int, system_prompt: str, tools: list[Any]
) -> ModelReply:
    command = [
        "claude",
        "-p",
        "--output-format",
        "json",
        "--json-schema",
        json.dumps(reply_schema(tools)),
        "--model",
        _model_alias(model),
        "--system-prompt",
        system_prompt,
        "--tools",
        "",
        "--strict-mcp-config",
        "--mcp-config",
        '{"mcpServers":{}}',
        "--safe-mode",
        "--restricted",
        "--no-session-persistence",
        "--permission-prompts",
        "none",
    ]
    return _parse_claude(await _run(command, prompt, cwd, timeout), tools)


async def _codex(prompt: str, cwd: Path, timeout: int, tools: list[Any]) -> ModelReply:
    schema = cwd / "reply-schema.json"
    output = cwd / "reply.json"
    output.unlink(missing_ok=True)  # a retry must never read the previous attempt's reply
    schema.write_text(json.dumps(reply_schema(tools)), encoding="utf-8")
    command = [
        "codex",
        "exec",
        "--ephemeral",
        "--skip-git-repo-check",
        "--cd",
        str(cwd),
        "--sandbox",
        "read-only",
        # The bridge is a model adapter, so the operator's interactive Codex
        # setup must not run inside it: no lifecycle hooks, MCP servers, plugins
        # or turn notifications. The configured model and effort still apply.
        "--disable",
        "hooks",
        "-c",
        "mcp_servers={}",
        "-c",
        "plugins={}",
        "-c",
        "notify=[]",
        "--output-schema",
        str(schema),
        "--output-last-message",
        str(output),
        "-",
    ]
    await _run(command, prompt, cwd, timeout)
    try:
        raw = output.read_text(encoding="utf-8")
    except FileNotFoundError as error:
        raise CliFailure("contract") from error
    return _parse_reply(raw, tools)


async def _codex_answer(payload: dict[str, Any], cwd: Path, timeout: int) -> ModelReply:
    """Ask Codex once more after an unusable reply, failed exit or stall.

    Structured arguments remove the known malformed-reply cause, but a
    subscription CLI can still fail transiently (a falsely flagged prompt, a
    stalled stream); one bounded retry keeps that from failing the user's whole
    chat turn. Two timeouts stay inside the agent's model read timeout.
    """
    try:
        return await _codex(_codex_prompt(payload), cwd, timeout, payload["tools"])
    except CliFailure as error:
        if error.kind == "unavailable":
            raise
        log.warning(f"CLI completion retried backend=codex-cli failure={error.kind}")
        return await _codex(_codex_prompt(payload), cwd, timeout, payload["tools"])


async def _complete(request: dict[str, Any]) -> ModelReply:
    backend = os.getenv("LLM_BACKEND", "claude-cli").lower()
    if backend not in {"claude-cli", "codex-cli"}:
        raise HTTPException(status_code=503, detail="CLI bridge requires LLM_BACKEND=claude-cli or codex-cli")
    payload = _normalise_request(request)
    timeout = int(os.getenv("A2G_CLI_TIMEOUT_SECONDS", str(DEFAULT_TIMEOUT_SECONDS)))
    async with _capacity:
        with tempfile.TemporaryDirectory(prefix="a2g-cli-llm-") as temporary:
            cwd = Path(temporary)
            if backend == "codex-cli":
                reply = await _codex_answer(payload, cwd, timeout)
                log.warning(f"CLI completion served backend=codex-cli reply_kind={reply.kind}")
                return _ground_quotes(reply, payload)
            model = str(request.get("model", "sonnet"))
            try:
                reply = await _claude(
                    _prompt(payload, include_system=False), model, cwd, timeout,
                    _claude_system_prompt(payload), payload["tools"],
                )
                if _must_retry_for_tool(reply, payload):
                    reply = await _claude(
                        _prompt(payload, include_system=False)
                        + "\n\nA declared tool is available. Do not claim it is unavailable; return tool_calls for the needed tool.",
                        model, cwd, timeout, _claude_system_prompt(payload), payload["tools"],
                    )
                log.warning(f"CLI completion served backend=claude-cli reply_kind={reply.kind}")
                return _ground_quotes(reply, payload)
            except CliFailure as error:
                # A failure includes subscription limits and transient CLI errors.  The
                # fallback has the identical strict contract, so callers see no change.
                log.warning(f"CLI completion fell back backend=claude-cli to_backend=codex-cli failure={error.kind}")
                reply = await _codex_answer(payload, cwd, timeout)
                log.warning(f"CLI completion served backend=codex-cli reply_kind={reply.kind}")
                return _ground_quotes(reply, payload)


def _completion(reply: ModelReply, model: str) -> dict[str, Any]:
    message: dict[str, Any] = {"role": "assistant", "content": reply.content}
    finish_reason = "stop"
    if reply.kind == "tool_calls":
        # floci incorrectly turns a null OpenAI tool-call preface into an
        # assistant text event. Omit it altogether so only a validated text
        # reply is streamed to the agent after the tool result returns.
        message.pop("content")
        message["tool_calls"] = [
            {
                "id": call.id,
                "type": "function",
                "function": {"name": call.name, "arguments": json.dumps(call.input, separators=(",", ":"))},
            }
            for call in reply.tool_calls
        ]
        finish_reason = "tool_calls"
    return {
        "id": f"chatcmpl-{uuid.uuid4().hex}",
        "object": "chat.completion",
        "created": int(time.time()),
        "model": model,
        "choices": [{"index": 0, "message": message, "finish_reason": finish_reason}],
    }


async def _stream(completion: dict[str, Any]) -> AsyncIterator[str]:
    choice = completion["choices"][0]
    message = choice["message"]
    initial = {**completion, "object": "chat.completion.chunk", "choices": [{"index": 0, "delta": {"role": "assistant"}, "finish_reason": None}]}
    yield f"data: {json.dumps(initial)}\n\n"
    if message.get("tool_calls"):
        delta = {"tool_calls": [{"index": index, **call} for index, call in enumerate(message["tool_calls"])]}
        chunk = {**completion, "object": "chat.completion.chunk", "choices": [{"index": 0, "delta": delta, "finish_reason": None}]}
        yield f"data: {json.dumps(chunk)}\n\n"
    else:
        # ConverseStream callers surface each OpenAI delta as an AG-UI text event.
        # Keep chunks modest so a normal answer appears progressively rather than
        # as a single large block.
        for start in range(0, len(message["content"] or ""), 48):
            chunk = {**completion, "object": "chat.completion.chunk", "choices": [{"index": 0, "delta": {"content": message["content"][start : start + 48]}, "finish_reason": None}]}
            yield f"data: {json.dumps(chunk)}\n\n"
    final = {**completion, "object": "chat.completion.chunk", "choices": [{"index": 0, "delta": {}, "finish_reason": choice["finish_reason"]}]}
    yield f"data: {json.dumps(final)}\n\ndata: [DONE]\n\n"


@app.get("/healthz")
async def healthz() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/v1/chat/completions")
async def chat_completions(request: dict[str, Any]):
    try:
        reply = await _complete(request)
    except CliFailure as error:
        log.warning(f"CLI completion failed failure={error.kind}")
        # Do not let framework exception traces render a prompt or model response.
        raise HTTPException(status_code=503, detail="local model backend unavailable") from error
    completion = _completion(reply, str(request.get("model", "claude-sonnet-5-5")))
    if request.get("stream"):
        return StreamingResponse(_stream(completion), media_type="text/event-stream")
    return JSONResponse(completion)
