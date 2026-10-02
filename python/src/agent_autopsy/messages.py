"""Convert provider message shapes (OpenAI Chat, Anthropic, plain strings) to GenAI semconv messages.

GenAI semantic conventions represent messages as ``{"role": ..., "parts": [...]}`` where parts are
``{"type": "text", "content": ...}``, ``{"type": "tool_call", "id", "name", "arguments"}`` or
``{"type": "tool_call_response", "id", "response"}``.
"""

from __future__ import annotations

import json
from typing import Any


def _get(obj: Any, key: str, default: Any = None) -> Any:
    if isinstance(obj, dict):
        return obj.get(key, default)
    return getattr(obj, key, default)


def _text(content: Any) -> str:
    if content is None:
        return ""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        out = []
        for part in content:
            t = _get(part, "text")
            if isinstance(t, str):
                out.append(t)
            elif isinstance(part, str):
                out.append(part)
        return "\n".join(out)
    return str(content)


def _args(value: Any) -> Any:
    if isinstance(value, str):
        try:
            return json.loads(value)
        except ValueError:
            return value
    return value


def to_genai_messages(messages: Any) -> list[dict[str, Any]]:
    """Best-effort conversion of a list of chat messages to GenAI semconv form."""
    if messages is None:
        return []
    if isinstance(messages, str):
        return [{"role": "user", "parts": [{"type": "text", "content": messages}]}]
    out: list[dict[str, Any]] = []
    for m in messages:
        role = _get(m, "role", "user")
        if role == "developer":
            role = "system"
        content = _get(m, "content")
        parts: list[dict[str, Any]] = []
        if role == "tool":
            parts.append(
                {"type": "tool_call_response", "id": _get(m, "tool_call_id"), "response": _text(content)}
            )
            out.append({"role": "tool", "parts": parts})
            continue
        if isinstance(content, list) and any(_get(b, "type") in ("tool_use", "tool_result") for b in content):
            # Anthropic content blocks.
            for b in content:
                bt = _get(b, "type")
                if bt == "text":
                    parts.append({"type": "text", "content": _get(b, "text", "")})
                elif bt == "tool_use":
                    parts.append(
                        {
                            "type": "tool_call",
                            "id": _get(b, "id"),
                            "name": _get(b, "name"),
                            "arguments": _get(b, "input"),
                        }
                    )
                elif bt == "tool_result":
                    out.append(
                        {
                            "role": "tool",
                            "parts": [
                                {
                                    "type": "tool_call_response",
                                    "id": _get(b, "tool_use_id"),
                                    "response": _text(_get(b, "content")),
                                }
                            ],
                        }
                    )
            if parts:
                out.append({"role": role, "parts": parts})
            continue
        text = _text(content)
        if text:
            parts.append({"type": "text", "content": text})
        for tc in _get(m, "tool_calls") or []:
            fn = _get(tc, "function") or {}
            parts.append(
                {
                    "type": "tool_call",
                    "id": _get(tc, "id"),
                    "name": _get(fn, "name"),
                    "arguments": _args(_get(fn, "arguments")),
                }
            )
        out.append({"role": role, "parts": parts})
    return out


def tool_definitions(tools: Any) -> list[dict[str, Any]]:
    """Normalize OpenAI/Anthropic tool definitions to ``{type, name, description, parameters}``."""
    out: list[dict[str, Any]] = []
    for t in tools or []:
        fn = _get(t, "function") or t
        params = _get(fn, "parameters") or _get(fn, "input_schema") or _get(fn, "inputSchema")
        out.append(
            {
                "type": "function",
                "name": _get(fn, "name"),
                "description": _get(fn, "description"),
                "parameters": params,
            }
        )
    return out


def parse_response(resp: Any) -> dict[str, Any]:
    """Extract model, usage, output messages and finish reason from an OpenAI or Anthropic response."""
    info: dict[str, Any] = {"model": _get(resp, "model")}
    usage = _get(resp, "usage")
    choices = _get(resp, "choices")
    if choices:  # OpenAI Chat Completions
        c0 = choices[0]
        msg = _get(c0, "message")
        info["finish_reason"] = _get(c0, "finish_reason")
        info["output"] = to_genai_messages(
            [{"role": "assistant", "content": _get(msg, "content"), "tool_calls": _get(msg, "tool_calls")}]
        )
        if usage is not None:
            info["input_tokens"] = _get(usage, "prompt_tokens")
            info["output_tokens"] = _get(usage, "completion_tokens")
    elif _get(resp, "type") == "message" or isinstance(_get(resp, "content"), list):  # Anthropic
        blocks = _get(resp, "content") or []
        parts: list[dict[str, Any]] = []
        for b in blocks:
            if _get(b, "type") == "text":
                parts.append({"type": "text", "content": _get(b, "text", "")})
            elif _get(b, "type") == "tool_use":
                parts.append(
                    {
                        "type": "tool_call",
                        "id": _get(b, "id"),
                        "name": _get(b, "name"),
                        "arguments": _get(b, "input"),
                    }
                )
        info["output"] = [{"role": "assistant", "parts": parts}]
        info["finish_reason"] = _get(resp, "stop_reason")
        if usage is not None:
            cache_read = _get(usage, "cache_read_input_tokens") or 0
            cache_write = _get(usage, "cache_creation_input_tokens") or 0
            inp = _get(usage, "input_tokens")
            info["input_tokens"] = None if inp is None else inp + cache_read + cache_write
            info["output_tokens"] = _get(usage, "output_tokens")
            if cache_read:
                info["cached_tokens"] = cache_read
    elif _get(resp, "output") is not None:  # OpenAI Responses API
        parts = []
        for item in _get(resp, "output") or []:
            it = _get(item, "type")
            if it == "message":
                parts.append({"type": "text", "content": _text(_get(item, "content"))})
            elif it == "function_call":
                parts.append(
                    {
                        "type": "tool_call",
                        "id": _get(item, "call_id"),
                        "name": _get(item, "name"),
                        "arguments": _args(_get(item, "arguments")),
                    }
                )
        info["output"] = [{"role": "assistant", "parts": parts}]
        if usage is not None:
            info["input_tokens"] = _get(usage, "input_tokens")
            info["output_tokens"] = _get(usage, "output_tokens")
    return info
