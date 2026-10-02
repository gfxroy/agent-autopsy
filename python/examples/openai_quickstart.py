"""Record a real OpenAI tool-calling loop (needs OPENAI_API_KEY and `pip install openai`)."""

from __future__ import annotations

import json

from openai import OpenAI

from agent_autopsy import Recorder

rec = Recorder("openai_run.jsonl", name="OpenAI quickstart")
client = rec.instrument_openai(OpenAI())  # every chat.completions.create call becomes an LLM span

tools = [
    {
        "type": "function",
        "function": {
            "name": "add",
            "description": "Add two integers.",
            "parameters": {
                "type": "object",
                "properties": {"a": {"type": "integer"}, "b": {"type": "integer"}},
                "required": ["a", "b"],
            },
        },
    }
]


@rec.tool_fn
def add(a: int, b: int) -> int:
    return a + b


messages = [{"role": "user", "content": "What is 1234 + 4321? Use the tool."}]
with rec.agent("Calculator"):
    while True:
        resp = client.chat.completions.create(model="gpt-4o-mini", messages=messages, tools=tools)
        msg = resp.choices[0].message
        messages.append(msg.model_dump(exclude_none=True))
        if not msg.tool_calls:
            break
        for call in msg.tool_calls:
            result = add(**json.loads(call.function.arguments))
            messages.append({"role": "tool", "tool_call_id": call.id, "content": str(result)})
rec.close(final_output=msg.content)
print("wrote openai_run.jsonl")
