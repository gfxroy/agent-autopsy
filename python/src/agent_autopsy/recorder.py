"""Span recorder writing one JSON object per finished span (OTel GenAI attribute names)."""

from __future__ import annotations

import contextvars
import functools
import inspect
import json
import secrets
import threading
import time
from pathlib import Path
from typing import IO, Any, Callable, TypeVar, Union

from .messages import parse_response, to_genai_messages, tool_definitions

F = TypeVar("F", bound=Callable[..., Any])

_current_span: contextvars.ContextVar[Span | None] = contextvars.ContextVar(
    "agent_autopsy_span", default=None
)
_current_recorder: contextvars.ContextVar[Recorder | None] = contextvars.ContextVar(
    "agent_autopsy_recorder", default=None
)

MAX_ATTR_CHARS = 200_000


def _dumps(value: Any) -> str:
    if isinstance(value, str):
        return value
    try:
        return json.dumps(value, default=str, ensure_ascii=False)
    except (TypeError, ValueError):
        return str(value)


def _clip(text: str) -> str:
    return text if len(text) <= MAX_ATTR_CHARS else text[: MAX_ATTR_CHARS - 20] + "…[truncated]"


class Span:
    """A timed unit of work. Use as a context manager; nested spans become children."""

    kind = "other"

    def __init__(self, recorder: Recorder, name: str, attributes: dict[str, Any] | None = None):
        self.recorder = recorder
        self.name = name
        self.span_id = secrets.token_hex(8)
        self.parent: Span | None = None
        self.attributes: dict[str, Any] = {"agent_autopsy.kind": self.kind}
        self.attributes.update(attributes or {})
        self.start_ns = 0
        self.end_ns = 0
        self.status = "OK"
        self.status_message: str | None = None
        self._token: contextvars.Token[Span | None] | None = None

    # -- context manager -------------------------------------------------------------------
    def __enter__(self) -> Span:
        self.parent = _current_span.get()
        self._token = _current_span.set(self)
        self.start_ns = time.time_ns()
        return self

    def __exit__(self, exc_type: Any, exc: BaseException | None, tb: Any) -> None:
        if exc is not None:
            self.set_error(exc)
        self.end_ns = time.time_ns()
        if self._token is not None:
            _current_span.reset(self._token)
        self.recorder._emit(self)

    # -- helpers ---------------------------------------------------------------------------
    def set_attribute(self, key: str, value: Any) -> None:
        self.attributes[key] = value

    def set_error(self, error: BaseException | str) -> None:
        self.status = "ERROR"
        if isinstance(error, BaseException):
            self.status_message = f"{type(error).__name__}: {error}"
            self.attributes["error.type"] = type(error).__name__
        else:
            self.status_message = str(error)
            self.attributes.setdefault("error.type", "error")

    def to_dict(self) -> dict[str, Any]:
        d: dict[str, Any] = {
            "trace_id": self.recorder.trace_id,
            "span_id": self.span_id,
            "parent_span_id": self.parent.span_id if self.parent else None,
            "name": self.name,
            "kind": self.kind,
            "start_time_unix_nano": self.start_ns,
            "end_time_unix_nano": self.end_ns,
            "attributes": self.attributes,
            "status": {"code": self.status},
        }
        if self.status_message:
            d["status"]["message"] = self.status_message
        return d


class AgentSpan(Span):
    kind = "agent"


class LlmSpan(Span):
    """An LLM call. Feed it the request and the provider response (or set fields manually)."""

    kind = "llm"

    def set_input(self, messages: Any = None, system: str | None = None, tools: Any = None) -> None:
        if self.recorder.capture_content and messages is not None:
            self.attributes["gen_ai.input.messages"] = _clip(_dumps(to_genai_messages(messages)))
        if self.recorder.capture_content and system:
            self.attributes["gen_ai.system_instructions"] = _dumps([{"type": "text", "content": system}])
        if tools:
            defs = tool_definitions(tools)
            self.attributes["gen_ai.tool.definitions"] = _dumps(defs)
            self.recorder._declare_tools(defs)

    def set_usage(
        self,
        input_tokens: int | None = None,
        output_tokens: int | None = None,
        cached_tokens: int | None = None,
    ) -> None:
        if input_tokens is not None:
            self.attributes["gen_ai.usage.input_tokens"] = int(input_tokens)
        if output_tokens is not None:
            self.attributes["gen_ai.usage.output_tokens"] = int(output_tokens)
        if cached_tokens:
            self.attributes["gen_ai.usage.cache_read.input_tokens"] = int(cached_tokens)

    def set_output(
        self,
        content: str | None = None,
        tool_calls: list[dict[str, Any]] | None = None,
        finish_reason: str | None = None,
    ) -> None:
        """Set the model's reply. ``tool_calls`` items: ``{"id", "name", "arguments"}``."""
        parts: list[dict[str, Any]] = []
        if content:
            parts.append({"type": "text", "content": content})
        for tc in tool_calls or []:
            parts.append(
                {
                    "type": "tool_call",
                    "id": tc.get("id"),
                    "name": tc.get("name"),
                    "arguments": tc.get("arguments"),
                }
            )
        if self.recorder.capture_content:
            self.attributes["gen_ai.output.messages"] = _clip(
                _dumps([{"role": "assistant", "parts": parts, "finish_reason": finish_reason}])
            )
        if finish_reason:
            self.attributes["gen_ai.response.finish_reasons"] = [finish_reason]

    def record_response(self, response: Any) -> None:
        """Extract usage/output from an OpenAI (Chat or Responses) or Anthropic response object or dict."""
        info = parse_response(response)
        if info.get("model"):
            self.attributes["gen_ai.response.model"] = info["model"]
        self.set_usage(info.get("input_tokens"), info.get("output_tokens"), info.get("cached_tokens"))
        if self.recorder.capture_content and info.get("output") is not None:
            out = info["output"]
            if info.get("finish_reason") and out:
                out[0]["finish_reason"] = info["finish_reason"]
            self.attributes["gen_ai.output.messages"] = _clip(_dumps(out))
        if info.get("finish_reason"):
            self.attributes["gen_ai.response.finish_reasons"] = [info["finish_reason"]]


class ToolSpan(Span):
    """A tool execution."""

    kind = "tool"

    def set_result(self, result: Any) -> None:
        if self.recorder.capture_content:
            self.attributes["gen_ai.tool.call.result"] = _clip(_dumps(result))


SpanLike = Union[Span, LlmSpan, ToolSpan]


class Recorder:
    """Collects spans for one agent run and writes them as JSONL.

    Args:
        path: file path or open text stream; ``None`` keeps spans in memory only (see ``spans``).
        name: human-readable run name (shown in the UI).
        capture_content: record prompts, outputs, tool args and results (default ``True``).
            Set ``False`` to keep only structure, timings, token counts and errors.
    """

    def __init__(
        self, path: str | Path | IO[str] | None = None, name: str = "agent run", capture_content: bool = True
    ):
        self.trace_id = secrets.token_hex(16)
        self.name = name
        self.capture_content = capture_content
        self.spans: list[dict[str, Any]] = []
        self._tools: dict[str, dict[str, Any]] = {}
        self._lock = threading.Lock()
        self._owns_stream = False
        self._stream: IO[str] | None
        if path is None:
            self._stream = None
        elif isinstance(path, (str, Path)):
            self._stream = open(path, "w", encoding="utf-8")  # noqa: SIM115 - closed in close()
            self._owns_stream = True
        else:
            self._stream = path
        self._closed = False

    # -- span factories --------------------------------------------------------------------
    def agent(self, name: str, **attributes: Any) -> AgentSpan:
        attrs = {"gen_ai.operation.name": "invoke_agent", "gen_ai.agent.name": name, **attributes}
        return AgentSpan(self, f"invoke_agent {name}", attrs)

    def llm(
        self,
        model: str,
        provider: str | None = None,
        messages: Any = None,
        system: str | None = None,
        tools: Any = None,
        **attributes: Any,
    ) -> LlmSpan:
        attrs: dict[str, Any] = {"gen_ai.operation.name": "chat", "gen_ai.request.model": model, **attributes}
        if provider:
            attrs["gen_ai.provider.name"] = provider
        span = LlmSpan(self, f"chat {model}", attrs)
        span.set_input(messages, system, tools)
        return span

    def tool(
        self, name: str, arguments: Any = None, call_id: str | None = None, **attributes: Any
    ) -> ToolSpan:
        attrs: dict[str, Any] = {
            "gen_ai.operation.name": "execute_tool",
            "gen_ai.tool.name": name,
            **attributes,
        }
        if call_id:
            attrs["gen_ai.tool.call.id"] = call_id
        if arguments is not None and self.capture_content:
            attrs["gen_ai.tool.call.arguments"] = _clip(_dumps(arguments))
        return ToolSpan(self, f"execute_tool {name}", attrs)

    def span(self, name: str, **attributes: Any) -> Span:
        return Span(self, name, attributes)

    # -- decorators ------------------------------------------------------------------------
    def tool_fn(self, fn: F | None = None, *, name: str | None = None) -> Any:
        """Decorator recording every call of ``fn`` as a tool span (args, result, exceptions)."""

        def wrap(f: F) -> F:
            tool_name = name or f.__name__
            sig = inspect.signature(f)

            def bound_args(args: tuple[Any, ...], kwargs: dict[str, Any]) -> dict[str, Any]:
                try:
                    b = sig.bind_partial(*args, **kwargs)
                    return dict(b.arguments)
                except TypeError:
                    return {"args": list(args), **kwargs}

            if inspect.iscoroutinefunction(f):

                @functools.wraps(f)
                async def async_wrapper(*args: Any, **kwargs: Any) -> Any:
                    with self.tool(tool_name, arguments=bound_args(args, kwargs)) as span:
                        result = await f(*args, **kwargs)
                        span.set_result(result)
                        return result

                return async_wrapper  # type: ignore[return-value]

            @functools.wraps(f)
            def wrapper(*args: Any, **kwargs: Any) -> Any:
                with self.tool(tool_name, arguments=bound_args(args, kwargs)) as span:
                    result = f(*args, **kwargs)
                    span.set_result(result)
                    return result

            return wrapper  # type: ignore[return-value]

        return wrap(fn) if fn is not None else wrap

    def agent_fn(self, fn: F | None = None, *, name: str | None = None) -> Any:
        """Decorator wrapping a function in an agent span."""

        def wrap(f: F) -> F:
            @functools.wraps(f)
            def wrapper(*args: Any, **kwargs: Any) -> Any:
                with self.agent(name or f.__name__):
                    return f(*args, **kwargs)

            return wrapper  # type: ignore[return-value]

        return wrap(fn) if fn is not None else wrap

    # -- instrumentation -------------------------------------------------------------------
    def instrument_openai(self, client: Any) -> Any:
        """Patch ``client.chat.completions.create`` so every call is recorded as an LLM span."""
        completions = client.chat.completions
        original = completions.create
        if getattr(original, "_agent_autopsy", False):
            return client

        @functools.wraps(original)
        def create(*args: Any, **kwargs: Any) -> Any:
            with self.llm(
                model=kwargs.get("model", "unknown"),
                provider="openai",
                messages=kwargs.get("messages"),
                tools=kwargs.get("tools"),
            ) as span:
                resp = original(*args, **kwargs)
                span.record_response(resp)
                return resp

        create._agent_autopsy = True  # type: ignore[attr-defined]
        completions.create = create
        return client

    # -- output ----------------------------------------------------------------------------
    def _declare_tools(self, defs: list[dict[str, Any]]) -> None:
        for d in defs:
            if d.get("name"):
                self._tools[d["name"]] = d

    def _emit(self, span: Span) -> None:
        record = span.to_dict()
        with self._lock:
            self.spans.append(record)
            if self._stream is not None and not self._closed:
                self._stream.write(json.dumps(record, default=str, ensure_ascii=False) + "\n")
                self._stream.flush()

    def close(self, final_output: str | None = None) -> None:
        """Write the trailing meta record (run name, declared tools, final answer) and close the file."""
        with self._lock:
            if self._closed:
                return
            meta = {
                "type": "meta",
                "name": self.name,
                "trace_id": self.trace_id,
                "tools": list(self._tools.values()),
            }
            if final_output is not None and self.capture_content:
                meta["final_output"] = final_output
            if self._stream is not None:
                self._stream.write(json.dumps(meta, default=str, ensure_ascii=False) + "\n")
                self._stream.flush()
                if self._owns_stream:
                    self._stream.close()
            self._closed = True

    def __enter__(self) -> Recorder:
        self._rtoken = _current_recorder.set(self)
        return self

    def __exit__(self, *exc: Any) -> None:
        _current_recorder.reset(self._rtoken)
        self.close()


def current_recorder() -> Recorder | None:
    """The recorder activated by ``with record(...)`` / ``with Recorder(...)``, if any."""
    return _current_recorder.get()


def record(
    path: str | Path | IO[str] | None = None, name: str = "agent run", capture_content: bool = True
) -> Recorder:
    """Context manager: ``with record("run.jsonl") as rec: ...`` — activates the recorder for ``@tool``."""
    return Recorder(path, name=name, capture_content=capture_content)


def tool(fn: F | None = None, *, name: str | None = None) -> Any:
    """Module-level decorator: records calls on the currently active recorder (no-op when none)."""

    def wrap(f: F) -> F:
        @functools.wraps(f)
        def wrapper(*args: Any, **kwargs: Any) -> Any:
            rec = _current_recorder.get()
            if rec is None:
                return f(*args, **kwargs)
            return rec.tool_fn(f, name=name)(*args, **kwargs)

        return wrapper  # type: ignore[return-value]

    return wrap(fn) if fn is not None else wrap
