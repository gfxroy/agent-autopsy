"""A scripted (no API key needed) trip-planning agent instrumented with agent_autopsy.

Run:  python examples/fake_trip_planner.py trip.jsonl
Then drop trip.jsonl into https://gfxroy.github.io/agent-autopsy/
"""

from __future__ import annotations

import json
import sys
import time

from agent_autopsy import Recorder

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "get_weather",
            "description": "Forecast for a city and date.",
            "parameters": {
                "type": "object",
                "properties": {"city": {"type": "string"}, "date": {"type": "string"}},
                "required": ["city", "date"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "search_hotels",
            "description": "Find hotels under a nightly budget.",
            "parameters": {
                "type": "object",
                "properties": {"city": {"type": "string"}, "max_eur": {"type": "number"}},
                "required": ["city", "max_eur"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "book_hotel",
            "description": "Book a hotel by id.",
            "parameters": {
                "type": "object",
                "properties": {"hotel_id": {"type": "string"}, "nights": {"type": "integer"}},
                "required": ["hotel_id", "nights"],
            },
        },
    },
]

_attempts = {"book": 0}


def main(path: str) -> None:
    rec = Recorder(path, name="Trip planner (Python helper demo)")

    @rec.tool_fn
    def get_weather(city: str, date: str) -> dict:
        time.sleep(0.12)
        return {"city": city, "date": date, "high_c": 21, "conditions": "partly cloudy"}

    @rec.tool_fn
    def search_hotels(city: str, max_eur: float) -> dict:
        time.sleep(1.6)  # slow upstream API
        return {
            "hotels": [
                {"id": "htl-porto-0412", "name": "Casa da Ribeira", "eur": 92},
                {"id": "htl-porto-0977", "name": "Bolhão Lofts", "eur": 118},
            ]
        }

    @rec.tool_fn
    def book_hotel(hotel_id: str, nights: int) -> dict:
        time.sleep(0.25)
        _attempts["book"] += 1
        if _attempts["book"] == 1:
            raise TimeoutError("booking provider timed out after 250ms")
        return {"confirmation": "BK-55120", "hotel_id": hotel_id, "nights": nights}

    messages = [
        {"role": "system", "content": "You are a trip planner. Use tools; be brief."},
        {"role": "user", "content": "Plan 2 nights in Porto from 2026-10-09 under €100/night and book it."},
    ]

    def llm(reply: dict, in_tok: int, out_tok: int, delay: float) -> None:
        with rec.llm(model="gpt-4o-mini", provider="openai", messages=messages, tools=TOOLS) as call:
            time.sleep(delay)
            call.record_response(
                {
                    "model": "gpt-4o-mini-2024-07-18",
                    "choices": [
                        {
                            "message": reply,
                            "finish_reason": "tool_calls" if reply.get("tool_calls") else "stop",
                        }
                    ],
                    "usage": {"prompt_tokens": in_tok, "completion_tokens": out_tok},
                }
            )
        messages.append(reply)

    def tc(id_: str, name: str, args: dict) -> dict:
        return {"id": id_, "type": "function", "function": {"name": name, "arguments": json.dumps(args)}}

    def run_tool(fn, call_id: str, **kwargs) -> None:
        try:
            out = fn(**kwargs)
            content = json.dumps(out)
        except Exception as e:  # the recorder already marked the span as an error
            content = f"Error: {e}"
        messages.append({"role": "tool", "tool_call_id": call_id, "content": content})

    with rec.agent("TripPlanner"):
        llm(
            {
                "role": "assistant",
                "content": None,
                "tool_calls": [
                    tc("call_w1", "get_weather", {"city": "Porto", "date": "2026-10-09"}),
                    tc("call_h1", "search_hotels", {"city": "Porto", "max_eur": 100}),
                ],
            },
            233,
            58,
            0.7,
        )
        run_tool(get_weather, "call_w1", city="Porto", date="2026-10-09")
        run_tool(search_hotels, "call_h1", city="Porto", max_eur=100)
        llm(
            {
                "role": "assistant",
                "content": None,
                "tool_calls": [tc("call_b1", "book_hotel", {"hotel_id": "htl-porto-0412", "nights": 2})],
            },
            402,
            31,
            0.5,
        )
        run_tool(book_hotel, "call_b1", hotel_id="htl-porto-0412", nights=2)
        llm(
            {
                "role": "assistant",
                "content": None,
                "tool_calls": [tc("call_b2", "book_hotel", {"hotel_id": "htl-porto-0412", "nights": 2})],
            },
            455,
            31,
            0.45,
        )
        run_tool(book_hotel, "call_b2", hotel_id="htl-porto-0412", nights=2)
        answer = (
            "Booked **Casa da Ribeira** in Porto for 2 nights from 9 Oct (€92/night, confirmation BK-55120). "
            "Expect 21 °C and partly cloudy skies."
        )
        llm({"role": "assistant", "content": answer}, 520, 42, 0.6)
    rec.close(final_output=answer)


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "trip.jsonl")
