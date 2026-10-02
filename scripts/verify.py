"""Headless smoke test of a deployed Agent Autopsy. usage: python scripts/verify.py URL [SHOT_DIR]"""

import json
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "https://gfxroy.github.io/agent-autopsy/"
SHOTS = Path(sys.argv[2]) if len(sys.argv) > 2 else None
PASTE = '[{"role":"user","content":"weather in Paris?"},{"role":"assistant","content":null,"tool_calls":[{"id":"c1","type":"function","function":{"name":"get_weather","arguments":"{\\"city\\":\\"Paris\\"}"}}]},{"role":"tool","tool_call_id":"c1","content":"Error: 503"},{"role":"assistant","content":"I\'m sorry, but I couldn\'t get the weather."}]'
out, errors = {}, []
with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 1280, "height": 900})
    pg.on("console", lambda m: m.type == "error" and errors.append(m.text))
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto(BASE)
    pg.wait_for_selector('[data-testid="cta"]')
    out["headline"] = pg.inner_text("h1")
    if SHOTS:
        SHOTS.mkdir(parents=True, exist_ok=True)
        pg.screenshot(path=str(SHOTS / "landing.png"), full_page=True)
    for sid in ["looping-research", "coding-agent", "injected-browser"]:
        pg.goto(BASE + "#/examine")
        pg.click(f'[data-testid="sample-{sid}"]')
        pg.wait_for_selector('[data-testid="report"]')
        out[sid] = {
            "grade": pg.inner_text('[data-testid="grade"]'),
            "cause": pg.inner_text('[data-testid="cause"]'),
            "failed_steps": pg.locator('[data-testid="step"][data-failed="true"]').count(),
            "fixes": pg.locator('[data-testid="fixes"] li').count(),
            "cert_colors": pg.evaluate(
                "() => { const c = document.querySelector('[data-testid=certificate]'); const d = c.getContext('2d').getImageData(0,0,c.width,c.height).data; const s = new Set(); for (let i=0;i<d.length;i+=4*499) s.add(d[i]); return s.size }"
            ),
        }
        if SHOTS and sid == "looping-research":
            pg.screenshot(path=str(SHOTS / "report.png"), full_page=True)
        pg.click('[data-testid="back"]')
    pg.goto(BASE + "#/examine")
    pg.fill('[data-testid="paste-input"]', PASTE)
    pg.click('[data-testid="paste-submit"]')
    pg.wait_for_selector('[data-testid="report"]')
    out["pasted"] = {"grade": pg.inner_text('[data-testid="grade"]'), "cause": pg.inner_text('[data-testid="cause"]')}
    m = b.new_page(viewport={"width": 390, "height": 844}, is_mobile=True)
    m.on("pageerror", lambda e: errors.append("mobile " + str(e)))
    m.goto(BASE + "#/examine?sample=looping-research")
    m.wait_for_selector('[data-testid="report"]')
    out["mobile_overflow_px"] = m.evaluate("() => document.documentElement.scrollWidth - innerWidth")
    if SHOTS:
        m.screenshot(path=str(SHOTS / "mobile-report.png"))
    b.close()
out["console_errors"] = errors
print(json.dumps(out, indent=1, ensure_ascii=False))
sys.exit(1 if errors else 0)
