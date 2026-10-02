"""agent_autopsy — record AI agent runs as OTel-GenAI-style JSONL for https://gfxroy.github.io/agent-autopsy/.

Zero dependencies. Typical use::

    from agent_autopsy import Recorder

    rec = Recorder("run.jsonl")
    with rec.agent("Researcher"):
        with rec.llm(model="gpt-4o-mini", messages=messages, tools=tools) as call:
            resp = client.chat.completions.create(model="gpt-4o-mini", messages=messages, tools=tools)
            call.record_response(resp)
        with rec.tool("web_search", arguments={"q": "..."}, call_id="call_1") as t:
            t.set_result(search("..."))
    rec.close()
"""

from .messages import to_genai_messages
from .recorder import LlmSpan, Recorder, Span, ToolSpan, current_recorder, record, tool

__all__ = [
    "Recorder",
    "Span",
    "LlmSpan",
    "ToolSpan",
    "record",
    "tool",
    "current_recorder",
    "to_genai_messages",
]
__version__ = "0.1.0"
