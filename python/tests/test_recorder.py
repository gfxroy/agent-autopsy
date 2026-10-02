import asyncio
import io
import json
import threading

import pytest

from agent_autopsy import Recorder, record, to_genai_messages, tool
from agent_autopsy.__main__ import main, summarize


def lines(buf: io.StringIO):
    return [json.loads(x) for x in buf.getvalue().splitlines() if x.strip()]


def test_nested_spans_share_trace_and_link_parents():
    buf = io.StringIO()
    rec = Recorder(buf, name="t")
    with rec.agent("A") as agent:
        with rec.llm(model="gpt-4o-mini", provider="openai") as llm:
            pass
        with rec.tool("search", arguments={"q": "x"}, call_id="c1") as t:
            t.set_result({"hits": 3})
    rec.close()
    out = lines(buf)
    spans = {s["span_id"]: s for s in out if s.get("type") != "meta"}
    assert spans[llm.span_id]["parent_span_id"] == agent.span_id
    assert spans[t.span_id]["parent_span_id"] == agent.span_id
    assert spans[agent.span_id]["parent_span_id"] is None
    assert len({s["trace_id"] for s in spans.values()}) == 1
    tool_attrs = spans[t.span_id]["attributes"]
    assert tool_attrs["gen_ai.operation.name"] == "execute_tool"
    assert tool_attrs["gen_ai.tool.name"] == "search"
    assert tool_attrs["gen_ai.tool.call.id"] == "c1"
    assert json.loads(tool_attrs["gen_ai.tool.call.arguments"]) == {"q": "x"}
    assert json.loads(tool_attrs["gen_ai.tool.call.result"]) == {"hits": 3}
    assert out[-1]["type"] == "meta" and out[-1]["name"] == "t"


def test_children_are_written_before_parents_with_valid_timing():
    rec = Recorder(None)
    with rec.agent("A"):
        with rec.tool("x"):
            pass
    assert [s["kind"] for s in rec.spans] == ["tool", "agent"]
    for s in rec.spans:
        assert s["end_time_unix_nano"] >= s["start_time_unix_nano"] > 0


def test_tool_fn_records_args_result_and_exceptions():
    rec = Recorder(None)

    @rec.tool_fn
    def divide(a: int, b: int = 1) -> float:
        return a / b

    assert divide(6, b=3) == 2
    with pytest.raises(ZeroDivisionError):
        divide(1, 0)
    ok, bad = rec.spans
    assert json.loads(ok["attributes"]["gen_ai.tool.call.arguments"]) == {"a": 6, "b": 3}
    assert ok["attributes"]["gen_ai.tool.call.result"] == "2.0"
    assert ok["status"]["code"] == "OK"
    assert bad["status"]["code"] == "ERROR"
    assert "ZeroDivisionError" in bad["status"]["message"]
    assert bad["attributes"]["error.type"] == "ZeroDivisionError"


def test_async_tool_fn():
    rec = Recorder(None)

    @rec.tool_fn(name="fetch")
    async def fetch(url: str) -> str:
        await asyncio.sleep(0)
        return "ok:" + url

    assert asyncio.run(fetch("u")) == "ok:u"
    assert rec.spans[0]["attributes"]["gen_ai.tool.name"] == "fetch"


def test_record_openai_chat_response_dict():
    rec = Recorder(None)
    msgs = [{"role": "system", "content": "s"}, {"role": "user", "content": "hi"}]
    tools = [{"type": "function", "function": {"name": "add", "parameters": {"type": "object"}}}]
    with rec.llm(model="gpt-4o-mini", messages=msgs, tools=tools) as call:
        call.record_response(
            {
                "model": "gpt-4o-mini-2024-07-18",
                "choices": [
                    {
                        "message": {
                            "role": "assistant",
                            "content": None,
                            "tool_calls": [
                                {
                                    "id": "c1",
                                    "type": "function",
                                    "function": {"name": "add", "arguments": '{"a":1}'},
                                }
                            ],
                        },
                        "finish_reason": "tool_calls",
                    }
                ],
                "usage": {"prompt_tokens": 12, "completion_tokens": 5},
            }
        )
    rec.close()
    a = rec.spans[0]["attributes"]
    assert a["gen_ai.usage.input_tokens"] == 12 and a["gen_ai.usage.output_tokens"] == 5
    assert a["gen_ai.response.model"] == "gpt-4o-mini-2024-07-18"
    assert a["gen_ai.response.finish_reasons"] == ["tool_calls"]
    out = json.loads(a["gen_ai.output.messages"])
    assert out[0]["parts"][0] == {"type": "tool_call", "id": "c1", "name": "add", "arguments": {"a": 1}}
    inp = json.loads(a["gen_ai.input.messages"])
    assert inp[1] == {"role": "user", "parts": [{"type": "text", "content": "hi"}]}
    assert json.loads(a["gen_ai.tool.definitions"])[0]["name"] == "add"


class Obj:
    def __init__(self, **kw):
        self.__dict__.update(kw)


def test_record_anthropic_response_object_counts_cache_tokens():
    rec = Recorder(None)
    resp = Obj(
        type="message",
        model="claude-sonnet-4-5",
        stop_reason="tool_use",
        content=[
            Obj(type="text", text="let me check"),
            Obj(type="tool_use", id="toolu_1", name="read", input={"p": "a"}),
        ],
        usage=Obj(
            input_tokens=10, output_tokens=7, cache_read_input_tokens=100, cache_creation_input_tokens=0
        ),
    )
    with rec.llm(model="claude-sonnet-4-5", provider="anthropic") as call:
        call.record_response(resp)
    a = rec.spans[0]["attributes"]
    assert a["gen_ai.usage.input_tokens"] == 110
    assert a["gen_ai.usage.cache_read.input_tokens"] == 100
    parts = json.loads(a["gen_ai.output.messages"])[0]["parts"]
    assert parts[1]["name"] == "read" and parts[1]["arguments"] == {"p": "a"}


def test_record_responses_api_dict():
    rec = Recorder(None)
    with rec.llm(model="gpt-5-mini") as call:
        call.record_response(
            {
                "model": "gpt-5-mini",
                "output": [
                    {"type": "function_call", "call_id": "c9", "name": "lookup", "arguments": '{"id":"1"}'}
                ],
                "usage": {"input_tokens": 50, "output_tokens": 9},
            }
        )
    a = rec.spans[0]["attributes"]
    assert a["gen_ai.usage.input_tokens"] == 50
    assert json.loads(a["gen_ai.output.messages"])[0]["parts"][0]["id"] == "c9"


def test_capture_content_false_keeps_structure_only():
    rec = Recorder(None, capture_content=False)
    with rec.llm(model="m", messages=[{"role": "user", "content": "secret"}]) as call:
        call.set_output(content="secret answer")
        call.set_usage(1, 2)
    with rec.tool("t", arguments={"password": "x"}) as t:
        t.set_result("secret")
    blob = json.dumps(rec.spans)
    assert "secret" not in blob and "password" not in blob
    assert rec.spans[0]["attributes"]["gen_ai.usage.output_tokens"] == 2


def test_module_level_tool_decorator_uses_active_recorder():
    @tool
    def ping() -> str:
        return "pong"

    assert ping() == "pong"  # no recorder: plain call
    buf = io.StringIO()
    with record(buf, name="ctx") as rec:
        ping()
    assert rec.spans[0]["attributes"]["gen_ai.tool.name"] == "ping"
    assert lines(buf)[-1]["type"] == "meta"


def test_threads_write_complete_lines():
    buf = io.StringIO()
    rec = Recorder(buf)

    def work(i):
        for _ in range(50):
            with rec.tool(f"t{i}"):
                pass

    threads = [threading.Thread(target=work, args=(i,)) for i in range(8)]
    for th in threads:
        th.start()
    for th in threads:
        th.join()
    rec.close()
    out = lines(buf)
    assert len(out) == 401
    # Each thread has its own context: tool spans have no parent.
    assert all(s.get("parent_span_id") is None for s in out if s.get("type") != "meta")


def test_instrument_openai_with_fake_client():
    class Completions:
        def create(self, **kw):
            return {
                "model": kw["model"],
                "choices": [{"message": {"role": "assistant", "content": "4"}, "finish_reason": "stop"}],
                "usage": {"prompt_tokens": 3, "completion_tokens": 1},
            }

    client = Obj(chat=Obj(completions=Completions()))
    rec = Recorder(None)
    rec.instrument_openai(client)
    rec.instrument_openai(client)  # idempotent
    client.chat.completions.create(model="gpt-4o-mini", messages=[{"role": "user", "content": "2+2"}])
    assert len(rec.spans) == 1
    assert rec.spans[0]["attributes"]["gen_ai.usage.input_tokens"] == 3


def test_to_genai_messages_handles_tool_roles_and_anthropic_blocks():
    m = to_genai_messages(
        [
            {"role": "developer", "content": "be nice"},
            {"role": "tool", "tool_call_id": "c1", "content": "42"},
            {"role": "user", "content": [{"type": "tool_result", "tool_use_id": "t1", "content": "ok"}]},
            {"role": "assistant", "content": [{"type": "tool_use", "id": "t2", "name": "x", "input": {}}]},
        ]
    )
    assert m[0]["role"] == "system"
    assert m[1]["parts"][0] == {"type": "tool_call_response", "id": "c1", "response": "42"}
    assert m[2]["parts"][0]["id"] == "t1"
    assert m[3]["parts"][0]["type"] == "tool_call"
    assert to_genai_messages("hello")[0]["parts"][0]["content"] == "hello"


def test_large_values_are_clipped(monkeypatch):
    import agent_autopsy.recorder as r

    monkeypatch.setattr(r, "MAX_ATTR_CHARS", 100)
    rec = Recorder(None)
    with rec.tool("big") as t:
        t.set_result("x" * 1000)
    assert len(rec.spans[0]["attributes"]["gen_ai.tool.call.result"]) <= 100


def test_cli_summary(tmp_path, capsys):
    p = tmp_path / "run.jsonl"
    rec = Recorder(p)
    with rec.agent("A"):
        with rec.llm(model="m") as c:
            c.set_usage(10, 3)
        with pytest.raises(ValueError):
            with rec.tool("t"):
                raise ValueError("boom")
    rec.close()
    assert main(["summary", str(p), "--json"]) == 0
    info = json.loads(capsys.readouterr().out)
    assert info["spans"] == 3 and info["errors"] == 1
    assert info["input_tokens"] == 10 and info["tool_calls"] == {"t": 1}
    assert summarize([])["spans"] == 0
