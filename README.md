<div align="center">

# ☠️ Agent Autopsy

**Find out what killed your AI agent.** Drop in a trace and get the cause of death, time of death, a grade from A+ to F, and the fix. Then try to beat the daily *Spot the Bug* case.

### ▶ **[Live demo: gfxroy.github.io/agent-autopsy](https://gfxroy.github.io/agent-autopsy/)**

Runs 100% in your browser · no sign-up · no API key needed · traces never leave your machine

[![CI](https://github.com/gfxroy/agent-autopsy/actions/workflows/ci.yml/badge.svg)](https://github.com/gfxroy/agent-autopsy/actions/workflows/ci.yml)
[![Pages](https://github.com/gfxroy/agent-autopsy/actions/workflows/pages.yml/badge.svg)](https://github.com/gfxroy/agent-autopsy/actions/workflows/pages.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-rose.svg)](LICENSE)

<img src="docs/demo.gif" alt="Agent Autopsy demo: a looping agent is pronounced dead, roast mode, death certificate, and a Spot the Bug case solved" width="900">

</div>

---

## Why

Agent runs fail in boring, expensive ways. They loop on the same tool call, hallucinate a tool, send arguments that break the schema, obey a prompt injection hidden in a web page, or drag a 9k-token document through every turn. Raw traces are a wall of JSON. Agent Autopsy reads the trace, runs 13 diagnostics, and tells you **which span killed the agent, why, what it cost and how to fix it**. It tries to make that as fun as doom-scrolling.

## Features

### The serious part
- **Universal importer** with format auto-detection: OpenAI Chat Completions (message arrays, request bodies, request/response logs), OpenAI Responses API, OpenAI Agents SDK traces, Anthropic Messages, LangChain/LangSmith runs, OpenTelemetry GenAI (OTLP JSON, OpenInference, legacy `gen_ai.prompt.N`), MCP JSON-RPC logs (including Claude Desktop log lines), and span JSONL.
- **13 diagnostics.** Each finding carries a severity, the offending spans, wasted tokens and dollars, and a concrete fix (see the [table below](#diagnostics)).
- **Timeline / waterfall** with a span inspector (messages, tool args/results, tokens, cost) and keyboard navigation.
- **Replay**: scrub through the run step by step and watch the context window grow.
- **Tool graph** with data-lineage edges: *this ID returned by `search_flights` was fed into `book_flight`*.
- **Cost & context**: per-model and per-step cost, context-growth chart, and an editable price table.
- **Diff two runs** (before/after a prompt change): metric deltas, LCS-aligned tool sequence, findings fixed, introduced or still present.
- **Redaction** of keys, JWTs, bearer tokens, emails, Luhn-valid cards, SSNs, phones and IPs. One toggle applies it to the UI, the exports and the certificate (the certificate is always redacted).
- **Exports**: Markdown and self-contained HTML reports.
- Optional **"Explain this failure"**, using your own OpenAI or Gemini key. The key is kept in `sessionStorage` and only a short, redacted digest is sent.
- **Python helper** (`agent_autopsy`): a zero-dependency recorder that writes OTel-GenAI-style JSONL.

### The dopamine part
- **Autopsy reveal**: the verdict is slammed onto the page (DECEASED / WOUNDED / ALIVE). It shows cause and time of death, a rolling grade from A+ to F, an animated health ring, *Agent IQ*, an efficiency %, a money-wasted counter that ticks up, and an ECG line that flatlines.
- **🌶️ Roast mode**: witty, deterministic roast lines for every diagnostic ("Called `web_search` 5 times with the same arguments. Einstein had a word for this."). Optional LLM roast with your own key.
- **🎯 Spot the Bug**: a date-seeded **daily case** that is the same for everyone each day. Read the evidence and click the span that killed the agent before 90 s runs out. You get 3 lives, hints cost 30%, and combos give up to ×3. There is also a **10-case campaign** of increasingly sneaky bugs: tool down → loop → phantom tool → missing arg → trojan web page (injection) → context hoarder → paraphrase loop → enum hallucination → sleeper failure → handoff hot-potato.
- **XP & ranks**: from Intern Coroner 🧑‍⚕️ up to **Chief Medical Examiner 👑**, plus **21 badges**, daily streaks, campaign stars, a local leaderboard with calibrated bot rivals, confetti, count-ups and sound effects (off by default).
- **📜 Death Certificate**: a shareable 1200×675 card with the cause and time of death, grade, IQ, money wasted and a roast. Download it as a PNG, or copy the text for X/LinkedIn. Redaction is always applied.

All progress lives in `localStorage`. There is no account and no server.

<table>
<tr>
<td><img src="docs/screenshot-autopsy.png" alt="Autopsy reveal"></td>
<td><img src="docs/screenshot-game.png" alt="Spot the Bug"></td>
</tr>
<tr>
<td><img src="docs/screenshot-timeline.png" alt="Timeline and inspector"></td>
<td><img src="docs/screenshot-diff.png" alt="Diff two runs"></td>
</tr>
<tr>
<td><img src="docs/certificate.png" alt="Death certificate"></td>
<td><img src="docs/screenshot-profile.png" alt="Ranks and badges"></td>
</tr>
</table>

## Supported formats

| Format | What to drop in | Timing | Tokens |
|---|---|---|---|
| OpenAI Chat Completions | `messages` array, request body `{model, messages, tools}`, or `[{request, response}]` logs | estimated¹ | real if `usage` present, else estimated |
| OpenAI Responses API | response object(s), item lists, `{input, output}` or `[{request, response}]` logs | estimated¹ | real if `usage` present |
| OpenAI Agents SDK | exported traces/spans (`trace.span`, JSON or JSONL) | real | real |
| Anthropic Messages | `{system, tools, messages}` with `tool_use` / `tool_result` blocks | estimated¹ | real if `usage` present |
| LangChain / LangSmith | run tree export (`child_runs`) or flat runs list | real | real |
| OpenTelemetry GenAI | OTLP JSON (`resourceSpans`), OpenInference, legacy indexed attributes | real | real |
| MCP | JSON-RPC 2.0 lines, `{timestamp, direction, message}` records, Claude Desktop logs | real if timestamped | estimated |
| Span JSONL | output of the Python helper, or any flat span records | real | real |

¹ Message arrays carry no timestamps, so durations are synthesized and marked *estimated*. Timing-based rules are skipped for them.

Ten realistic sample traces (one or more per format) are bundled in [`web/public/samples`](web/public/samples) and are one click away on the landing page.

## Diagnostics

| Rule | Detects |
|---|---|
| `loop` | Identical tool calls (canonical-JSON args) and near-duplicate paraphrased calls |
| `tool-error` | Failed tools, blind retries with unchanged args, and whether the agent recovered |
| `unknown-tool` | Calls to tools that were never declared, with a "did you mean" suggestion |
| `invalid-args` | Tool arguments that violate the JSON schema (required, types, enums, broken JSON) |
| `prompt-injection` | Injection patterns in tool output, rated critical when the agent then *complies* (reuses an injected URL/email/tool) |
| `context-bloat` | Huge tool results re-sent on every following turn (tokens and $ wasted) |
| `context-overflow` | Prompts at ≥80% of the model's context window, or runaway context growth |
| `no-final-answer` | The run ended mid-tool-call, crashed, replied with nothing, or gave up |
| `truncated-output` | Responses cut off by `max_tokens` / `length` |
| `handoff-pingpong` | Multi-agent handoffs bouncing back and forth |
| `slow-step` | A single step that dominates wall-clock time |
| `expensive-step` | A single LLM call that takes most of the budget |
| `unused-tools` | Declared tools that were never used but are billed on every call |

The **killer** is the highest-severity finding. The health score (0–100) maps to the grade, and *Agent IQ* = 55 + 0.8 × health + 15 × efficiency. These are heuristics with deliberately conservative thresholds; see [Limitations](#limitations).

## Python helper

```bash
pip install "git+https://github.com/gfxroy/agent-autopsy#subdirectory=python"
```

```python
from agent_autopsy import Recorder

rec = Recorder("run.jsonl", name="my agent")
client = rec.instrument_openai(OpenAI())  # optional: auto-record chat.completions.create

@rec.tool_fn                       # records args, result, exceptions (sync or async)
def search(query: str) -> list[str]: ...

with rec.agent("Researcher"):
    with rec.llm(model="gpt-4o-mini", messages=messages, tools=tools) as call:
        call.record_response(raw_client.chat.completions.create(...))  # OpenAI Chat/Responses or Anthropic
    search("eu ai act fines")
rec.close(final_output=answer)
```

Then drop `run.jsonl` on the site, or run `agent-autopsy summary run.jsonl` for a terminal summary. Use `capture_content=False` to record only structure, timings, tokens and errors. The helper is thread-safe and asyncio-safe (`contextvars`) and supports Python 3.9+. More in [`python/README.md`](python/README.md).

## Architecture

```mermaid
flowchart LR
  A[Trace file / paste / sample] --> B[parseJsonOrJsonl]
  B --> C{detectFormat}
  C --> D[Importers<br/>openai-chat · responses · agents-sdk<br/>anthropic · langsmith · otel · mcp · jsonl]
  D --> E[normalize<br/>single root · DFS order · timing · token estimates]
  E --> R[redact optional]
  R --> F[buildContext]
  F --> G[13 rules]
  G --> H[analyze<br/>health · grade · IQ · verdict · waste]
  H --> UI[React UI<br/>Autopsy · Timeline · Replay · Graph · Cost · Diff]
  H --> CERT[Death certificate canvas]
  H --> REP[Markdown / HTML report]
  subgraph Game
    L[levels.ts<br/>seeded trace builder] --> H
    H --> S[Spot the Bug<br/>answer = verdict.killer.spanIds]
    S --> P[progress.ts<br/>XP · ranks · badges · streaks]
  end
  P --> LS[(localStorage)]
```

- `web/src/engine/` is a pure TypeScript analysis engine (no DOM), used by both the UI and the game.
- `web/src/game/` builds the campaign and daily traces procedurally from a seed (mulberry32). The answer to each case is whatever the engine names as the killer, so the game and the diagnostics can never disagree. A test checks this for 400 seeds.
- `web/src/lib/` contains progress/XP, the certificate renderer, reports, the BYO-key LLM client and the confetti/sound effects.
- `python/` contains the `agent_autopsy` recorder package.
- Power users get a console API: `agentAutopsy.analyze(agentAutopsy.loadTrace(text))`.

## Privacy

- Everything runs client-side on a static GitHub Pages site. There is no backend, no analytics and no uploads.
- Traces are kept in memory. Only settings and game progress go to `localStorage`.
- The optional LLM explain/roast sends a **short, redacted digest** (never the raw trace) straight from your browser to the provider you choose. Your key stays in `sessionStorage`.
- The death certificate and its share text are always redacted.

## Development

```bash
cd web
npm install
npm run dev          # http://localhost:5173
npm test             # vitest (importers, rules, scoring, redaction, diff, graph, game, progress, UI)
npm run lint && npm run format:check && npm run typecheck
npm run build:pages  # static build with base /agent-autopsy/

cd ../python
pip install -e ".[dev]" && pytest -q && ruff check .

python scripts/make_samples.py                     # regenerate the bundled sample traces
python scripts/verify.py https://gfxroy.github.io/agent-autopsy/   # headless end-to-end check (Playwright)
```

CI runs lint, format, typecheck, tests and both builds, plus ruff and pytest on Python 3.9 and 3.13, plus gitleaks. Pages deploys on every push to `main`.

## Limitations

- Diagnostics are **heuristics**. They are tuned to be conservative, but expect the occasional false positive or miss on unusual traces.
- For message-only formats (Chat Completions, Anthropic, Responses without timestamps), **timings are synthesized** and **tokens are estimated** (~4 chars/token) unless the trace includes `usage`.
- **Prices are defaults** for common models and may be out of date. Edit them in the Cost tab.
- Prompt-injection detection is **regex/pattern based** plus a compliance check. It is not a classifier and can be evaded.
- The **leaderboard is local** to your browser (with bot rivals). There is no global leaderboard because there is no server.
- Very large traces (tens of MB) work but can be slow, since everything runs in the main thread.

## License

[MIT](LICENSE) © 2026 Aaditya Roy
