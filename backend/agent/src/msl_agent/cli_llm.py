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
import tempfile
import time
import uuid
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any, Literal

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
    """A non-successful CLI invocation; Claude failures may use the fallback."""


# This is deliberately hand-written instead of using Pydantic's schema output.
# Codex's strict structured-output endpoint requires every object to forbid extra
# properties, while tool arguments themselves remain arbitrary JSON objects.
REPLY_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": ["kind", "content", "tool_calls"],
    "properties": {
        "kind": {"type": "string", "enum": ["text", "tool_calls"]},
        "content": {"type": ["string", "null"]},
        "tool_calls": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["id", "name", "input_json"],
                "properties": {
                    "id": {"type": "string", "minLength": 1, "maxLength": 128},
                    "name": {"type": "string", "minLength": 1, "maxLength": 128},
                    "input_json": {"type": "string"},
                },
            },
        },
    },
}
app = FastAPI(title="agent2go local CLI LLM", docs_url=None, redoc_url=None)
_capacity = asyncio.Semaphore(MAX_IN_FLIGHT)


class CliToolCall(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=1, max_length=128)
    name: str = Field(min_length=1, max_length=128)
    input_json: str


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


def _prompt(payload: dict[str, Any]) -> str:
    return """You are a model adapter, not an agent. Do not use tools, browse, read files, or execute commands.
Answer the conversation encoded below. Tool definitions are declarative: if a tool is needed, return a tool_calls
reply. Every tool call's input_json must be a serialized JSON object. Tool-result messages are prior results and must
be used as conversational context. Return exactly one JSON object that conforms to the supplied schema, with no
Markdown or explanation. In a data-grounded answer, use double quotation marks only for exact, verbatim text from a
tool result. Do not quote your own framing, paraphrases, labels, dates, or explanations.\n\nCONVERSATION:\n""" + json.dumps(
        payload, ensure_ascii=False, separators=(",", ":")
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
        raise CliFailure(f"CLI unavailable: {command[0]}") from error
    try:
        stdout, stderr = await asyncio.wait_for(process.communicate(prompt.encode()), timeout=timeout)
    except TimeoutError as error:
        process.kill()
        await process.wait()
        raise CliFailure("CLI timed out") from error
    if process.returncode:
        # stderr can include model output or account details; never return or log it.
        raise CliFailure(f"CLI exited {process.returncode}")
    return stdout.decode("utf-8", errors="replace")


def _parse_reply(raw: str) -> ModelReply:
    try:
        parsed = CliReply.model_validate_json(raw)
        calls = [
            ToolCall(id=call.id, name=call.name, input=json.loads(call.input_json)) for call in parsed.tool_calls
        ]
        if any(not isinstance(call.input, dict) for call in calls):
            raise ValueError("tool input_json must decode to an object")
        return ModelReply(kind=parsed.kind, content=parsed.content, tool_calls=calls)
    except (json.JSONDecodeError, ValueError) as error:
        raise CliFailure("CLI returned an invalid model contract") from error


def _parse_claude(raw: str) -> ModelReply:
    try:
        result = json.loads(raw)
        text = result.get("result", result) if isinstance(result, dict) else result
        return _parse_reply(text if isinstance(text, str) else json.dumps(text))
    except (json.JSONDecodeError, ValueError) as error:
        raise CliFailure("Claude returned an invalid model contract") from error


async def _claude(prompt: str, model: str, cwd: Path, timeout: int) -> ModelReply:
    command = [
        "claude",
        "-p",
        "--output-format",
        "json",
        "--json-schema",
        json.dumps(REPLY_SCHEMA),
        "--model",
        _model_alias(model),
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
    return _parse_claude(await _run(command, prompt, cwd, timeout))


async def _codex(prompt: str, cwd: Path, timeout: int) -> ModelReply:
    schema = cwd / "reply-schema.json"
    output = cwd / "reply.json"
    schema.write_text(json.dumps(REPLY_SCHEMA), encoding="utf-8")
    command = [
        "codex",
        "exec",
        "--ephemeral",
        "--skip-git-repo-check",
        "--cd",
        str(cwd),
        "--sandbox",
        "read-only",
        "--output-schema",
        str(schema),
        "--output-last-message",
        str(output),
        "-",
    ]
    await _run(command, prompt, cwd, timeout)
    try:
        return _parse_reply(output.read_text(encoding="utf-8"))
    except (FileNotFoundError, ValueError) as error:
        raise CliFailure("Codex returned an invalid model contract") from error


async def _complete(request: dict[str, Any]) -> ModelReply:
    backend = os.getenv("LLM_BACKEND", "claude-cli").lower()
    if backend not in {"claude-cli", "codex-cli"}:
        raise HTTPException(status_code=503, detail="CLI bridge requires LLM_BACKEND=claude-cli or codex-cli")
    payload = _normalise_request(request)
    timeout = int(os.getenv("A2G_CLI_TIMEOUT_SECONDS", str(DEFAULT_TIMEOUT_SECONDS)))
    async with _capacity:
        with tempfile.TemporaryDirectory(prefix="a2g-cli-llm-") as temporary:
            cwd = Path(temporary)
            prompt = _prompt(payload)
            if backend == "codex-cli":
                return _ground_quotes(await _codex(prompt, cwd, timeout), payload)
            try:
                return _ground_quotes(await _claude(prompt, str(request.get("model", "sonnet")), cwd, timeout), payload)
            except CliFailure:
                # A failure includes subscription limits and transient CLI errors.  The
                # fallback has the identical strict contract, so callers see no change.
                return _ground_quotes(await _codex(prompt, cwd, timeout), payload)


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
        # Do not let framework exception traces render a prompt or model response.
        raise HTTPException(status_code=503, detail="local model backend unavailable") from error
    completion = _completion(reply, str(request.get("model", "claude-sonnet-5-5")))
    if request.get("stream"):
        return StreamingResponse(_stream(completion), media_type="text/event-stream")
    return JSONResponse(completion)
