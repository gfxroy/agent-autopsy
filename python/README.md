# agent-autopsy (Python helper)

Zero-dependency recorder that writes your agent runs as **OpenTelemetry-GenAI-style JSONL** —
drop the file into **[Agent Autopsy](https://gfxroy.github.io/agent-autopsy/)** for a timeline,
cost breakdown and automatic diagnosis (loops, tool errors, hallucinated tools, prompt injection…).

```bash
pip install "git+https://github.com/gfxroy/agent-autopsy#subdirectory=python"
```

```python
from agent_autopsy import Recorder

rec = Recorder("run.jsonl", name="my agent")
client = rec.instrument_openai(OpenAI())  # optional: auto-record chat.completions.create


@rec.tool_fn  # records args, result, exceptions
def search(query: str) -> list[str]: ...


with rec.agent("Researcher"):
    with rec.llm(model="gpt-4o-mini", messages=messages, tools=tools) as call:
        resp = raw_client.chat.completions.create(model="gpt-4o-mini", messages=messages, tools=tools)
        call.record_response(resp)  # OpenAI Chat / Responses or Anthropic objects or dicts
    search("eu ai act fines")
rec.close(final_output=answer)
```

* `capture_content=False` keeps only structure, timings, token counts and errors (no prompts/outputs).
* Thread-safe; nesting uses `contextvars` (works with asyncio).
* `agent-autopsy summary run.jsonl` prints a quick summary in the terminal.

Attribute names follow the [OTel GenAI semantic conventions](https://github.com/open-telemetry/semantic-conventions-genai)
(`gen_ai.operation.name`, `gen_ai.input.messages`, `gen_ai.tool.call.arguments`, `gen_ai.usage.*`…).
