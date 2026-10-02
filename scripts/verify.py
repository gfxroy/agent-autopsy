"""End-to-end check of a deployed (or local) Agent Autopsy build with headless Playwright.

usage: python scripts/verify.py https://gfxroy.github.io/agent-autopsy/ [--shots docs]
"""

import json
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:4173/agent-autopsy/"
SHOTS = Path(sys.argv[sys.argv.index("--shots") + 1]) if "--shots" in sys.argv else None
SAMPLES = [
    "looping-research",
    "looping-research-fixed",
    "coding-agent",
    "injected-browser",
    "clean-travel",
    "hr-agent",
    "filesystem-mcp",
    "refund-support",
    "triage-pingpong",
    "trip-planner",
]

results: dict[str, object] = {}
errors: list[str] = []


def shot(page, name):
    if SHOTS:
        SHOTS.mkdir(parents=True, exist_ok=True)
        page.screenshot(path=str(SHOTS / f"{name}.png"))


def fresh(page, hash_: str):
    page.goto(BASE + "#" + hash_)
    page.wait_for_load_state("networkidle")


with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={"width": 1440, "height": 900}, device_scale_factor=1)
    page = ctx.new_page()
    page.on("console", lambda m: m.type == "error" and errors.append(m.text))
    page.on("pageerror", lambda e: errors.append(str(e)))

    page.goto(BASE)
    page.wait_for_selector('[data-testid="dropzone"]')
    shot(page, "landing")
    ids = page.eval_on_selector_all('[data-testid^="sample-"]', "els => els.map(e => e.dataset.testid.slice(7))")
    results["landing_samples"] = ids

    for sid in ids:
        fresh(page, f"sample={sid}&tab=autopsy")
        page.wait_for_selector('[data-testid="grade"]')
        page.wait_for_timeout(3400)  # let the staged reveal finish
        grade = page.inner_text('[data-testid="grade"]').strip()
        cause = page.inner_text('[data-testid="cause"]').strip()
        findings = page.locator('[data-testid="finding"]').count()
        results[sid] = {"grade": grade, "cause": cause[:80], "findings": findings}
        if sid == "looping-research":
            page.wait_for_timeout(800)
            shot(page, "autopsy")

    # Timeline
    fresh(page, "sample=coding-agent&tab=timeline")
    page.wait_for_selector('[data-testid="span-row"]')
    rows = page.locator('[data-testid="span-row"]')
    results["timeline_rows"] = rows.count()
    rows.nth(3).click()
    page.wait_for_selector('[data-testid="inspector"]')
    shot(page, "timeline")

    # Diff
    fresh(page, "tab=diff")
    page.click('[data-testid="diff-demo"]')
    page.wait_for_selector('[data-testid="diff-verdict"]')
    results["diff_verdict"] = page.inner_text('[data-testid="diff-verdict"]')
    shot(page, "diff")

    # Spot the Bug daily
    fresh(page, "tab=game")
    answer = page.evaluate(
        """() => { const A = window.agentAutopsy; const d = A.dailyPuzzle((() => { const t = new Date();
           return `${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,'0')}-${String(t.getDate()).padStart(2,'0')}` })());
           const a = A.analyze(A.buildLevel(d.level.bug, d.seed)); return { level: d.level.title, ids: a.verdict.killer.spanIds } }"""
    )
    page.click('[data-testid="start-daily"]')
    page.click('[data-testid="begin-case"]')
    page.wait_for_selector('[data-testid="case-span"]')
    page.click(f'[data-testid="case-span"][data-span-id="{answer["ids"][0]}"]')
    page.wait_for_timeout(600)
    shot(page, "game")
    page.click('[data-testid="accuse"]')
    page.wait_for_selector('[data-testid="case-result"][data-won="true"]')
    page.wait_for_timeout(1600)
    results["daily"] = {
        "level": answer["level"],
        "score": page.inner_text('[data-testid="case-score"]'),
        "xp": page.inner_text('[data-testid="xp"]'),
    }
    shot(page, "game-solved")
    stored = page.evaluate("() => JSON.parse(localStorage.getItem('agent-autopsy:v1')).state.progress")
    results["daily_persisted"] = bool(stored["daily"]) and "daily-doctor" in stored["badges"]

    # Death certificate
    fresh(page, "sample=looping-research&tab=autopsy")
    page.wait_for_selector('[data-testid="open-certificate"]', timeout=15000)
    page.wait_for_timeout(4500)  # let the reveal confetti settle
    page.click('[data-testid="open-certificate"]')
    page.wait_for_selector('[data-testid="certificate"]')
    page.wait_for_timeout(500)
    nonblank = page.evaluate(
        """() => { const c = document.querySelector('[data-testid="certificate"]'); const d = c.getContext('2d').getImageData(0,0,c.width,c.height).data;
           const seen = new Set(); for (let i = 0; i < d.length; i += 4*997) seen.add(d[i]<<16|d[i+1]<<8|d[i+2]); return seen.size }"""
    )
    results["certificate_colors"] = nonblank
    results["share_text"] = page.input_value('[data-testid="share-text"]')[:120]
    page.locator('[data-testid="certificate"]').screenshot(path="/tmp/aa-certificate.png")
    if SHOTS:
        page.locator('[data-testid="certificate"]').screenshot(path=str(SHOTS / "certificate.png"))

    # Profile
    fresh(page, "tab=profile")
    page.wait_for_selector('[data-testid="profile"]')
    results["badges_unlocked"] = page.locator('[data-testid="badge"][data-unlocked="true"]').count()
    results["rank"] = page.inner_text('[data-testid="rank"]')
    shot(page, "profile")

    # Mobile layout smoke
    m = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True)
    mp = m.new_page()
    mp.on("pageerror", lambda e: errors.append("mobile: " + str(e)))
    mp.goto(BASE + "#sample=injected-browser&tab=autopsy")
    mp.wait_for_selector('[data-testid="grade"]')
    mp.wait_for_timeout(3200)
    results["mobile_overflow_px"] = mp.evaluate("() => document.documentElement.scrollWidth - window.innerWidth")
    if SHOTS:
        mp.screenshot(path=str(SHOTS / "mobile.png"))
    browser.close()

results["console_errors"] = errors
print(json.dumps(results, indent=2))
sys.exit(1 if errors or not results.get("daily_persisted") or results.get("certificate_colors", 0) < 5 else 0)
