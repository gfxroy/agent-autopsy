"""``agent-autopsy summary run.jsonl`` — quick terminal summary of a recorded run."""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from typing import Any


def summarize(lines: list[dict[str, Any]]) -> dict[str, Any]:
    spans = [r for r in lines if r.get("type") != "meta"]
    kinds = Counter(s.get("kind", "other") for s in spans)
    errors = [s for s in spans if (s.get("status") or {}).get("code") == "ERROR"]
    tokens_in = sum(int((s.get("attributes") or {}).get("gen_ai.usage.input_tokens", 0) or 0) for s in spans)
    tokens_out = sum(
        int((s.get("attributes") or {}).get("gen_ai.usage.output_tokens", 0) or 0) for s in spans
    )
    starts = [s["start_time_unix_nano"] for s in spans if s.get("start_time_unix_nano")]
    ends = [s["end_time_unix_nano"] for s in spans if s.get("end_time_unix_nano")]
    tool_calls = Counter(
        (s.get("attributes") or {}).get("gen_ai.tool.name") for s in spans if s.get("kind") == "tool"
    )
    return {
        "spans": len(spans),
        "kinds": dict(kinds),
        "errors": len(errors),
        "input_tokens": tokens_in,
        "output_tokens": tokens_out,
        "duration_ms": round((max(ends) - min(starts)) / 1e6, 1) if starts and ends else 0,
        "tool_calls": dict(tool_calls),
    }


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="agent-autopsy", description="Inspect Agent Autopsy JSONL traces.")
    sub = p.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("summary", help="print a summary of a JSONL trace")
    s.add_argument("path")
    s.add_argument("--json", action="store_true", help="machine-readable output")
    args = p.parse_args(argv)
    with open(args.path, encoding="utf-8") as fh:
        lines = [json.loads(line) for line in fh if line.strip()]
    info = summarize(lines)
    if args.json:
        print(json.dumps(info))
    else:
        print(f"spans: {info['spans']}  ({', '.join(f'{k}={v}' for k, v in info['kinds'].items())})")
        print(f"errors: {info['errors']}")
        print(f"tokens: {info['input_tokens']} in / {info['output_tokens']} out")
        print(f"duration: {info['duration_ms']} ms")
        if info["tool_calls"]:
            print("tools: " + ", ".join(f"{k}×{v}" for k, v in info["tool_calls"].items()))
        print("→ open https://gfxroy.github.io/agent-autopsy/ and drop the file in for a full autopsy")
    return 0


if __name__ == "__main__":
    sys.exit(main())
