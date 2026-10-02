"""Record the README demo GIF + screenshots from a deployed Agent Autopsy (default: the live site).

usage: python scripts/record_demo.py [BASE_URL]   (needs playwright + ffmpeg)
"""

import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "https://gfxroy.github.io/agent-autopsy/"
DOCS = Path(__file__).resolve().parent.parent / "docs"
DOCS.mkdir(exist_ok=True)
W, H = 1280, 800


def daily_answer(page) -> str:
    return page.evaluate(
        """() => { const A = window.agentAutopsy; const t = new Date();
        const key = `${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,'0')}-${String(t.getDate()).padStart(2,'0')}`;
        const d = A.dailyPuzzle(key); return A.analyze(A.buildLevel(d.level.bug, d.seed)).verdict.killer.spanIds[0] }"""
    )


with tempfile.TemporaryDirectory() as tmp, sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={"width": W, "height": H}, record_video_dir=tmp, record_video_size={"width": W, "height": H})
    page = ctx.new_page()
    page.goto(BASE)
    page.wait_for_selector('[data-testid="dropzone"]')
    page.wait_for_timeout(1800)
    page.click('[data-testid="sample-looping-research"]')
    page.wait_for_selector('[data-testid="grade"]')
    page.wait_for_timeout(4200)
    page.get_by_role("button", name="Roast").first.click()
    page.wait_for_timeout(1500)
    page.mouse.wheel(0, 420)
    page.wait_for_timeout(1800)
    page.mouse.wheel(0, -420)
    page.click('[data-testid="open-certificate"]')
    page.wait_for_selector('[data-testid="certificate"]')
    page.wait_for_timeout(2600)
    page.keyboard.press("Escape")
    page.click("text=Spot the Bug")
    page.click('[data-testid="start-daily"]')
    page.wait_for_timeout(900)
    page.click('[data-testid="begin-case"]')
    answer = daily_answer(page)
    page.wait_for_timeout(1200)
    page.click(f'[data-testid="case-span"][data-span-id="{answer}"]')
    page.wait_for_timeout(1200)
    page.click('[data-testid="accuse"]')
    page.wait_for_timeout(3600)
    video = page.video.path()
    ctx.close()
    mp4 = Path(tempfile.gettempdir()) / "agent-autopsy-demo.webm"
    shutil.move(video, mp4)
    gif = DOCS / "demo.gif"
    vf = "setpts=0.8*PTS,fps=8,scale=800:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=64:stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle"
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-ss", "0.6", "-i", str(mp4), "-vf", vf, str(gif)], check=True)
    print("gif", gif, gif.stat().st_size // 1024, "KB")

    # Static screenshots (fresh profile, then toasts hidden for clean shots)
    ctx = browser.new_context(viewport={"width": 1440, "height": 900})
    page = ctx.new_page()
    hide = "document.querySelectorAll('[aria-live]').forEach(e => e.style.display='none')"

    def snap(hash_: str, name: str, wait: int = 4500, before=None):
        page.goto(BASE + "#" + hash_)
        page.wait_for_load_state("networkidle")
        if before:
            before()
        page.wait_for_timeout(wait)
        page.evaluate(hide)
        page.screenshot(path=str(DOCS / f"{name}.png"))

    page.goto(BASE)
    page.wait_for_selector('[data-testid="dropzone"]')
    snap("sample=injected-browser&tab=autopsy", "screenshot-autopsy", 6000)
    snap("sample=coding-agent&tab=timeline", "screenshot-timeline", 1200, lambda: page.locator('[data-testid="span-row"]').nth(4).click())
    page.goto(BASE + "#tab=diff")
    page.click('[data-testid="diff-demo"]')
    page.wait_for_selector('[data-testid="diff-verdict"]')
    page.wait_for_timeout(5000)
    page.evaluate(hide)
    page.screenshot(path=str(DOCS / "screenshot-diff.png"))
    page.goto(BASE + "#tab=game")
    page.click('[data-testid="level-1"]')
    page.click('[data-testid="begin-case"]')
    page.locator('[data-testid="case-span"]').nth(3).click()
    page.wait_for_timeout(5000)
    page.evaluate(hide)
    page.screenshot(path=str(DOCS / "screenshot-game.png"))
    snap("tab=profile", "screenshot-profile", 1500)
    page.goto(BASE + "#sample=looping-research&tab=autopsy")
    page.wait_for_timeout(6500)
    page.click('[data-testid="open-certificate"]')
    page.wait_for_timeout(1200)
    page.locator('[data-testid="certificate"]').screenshot(path=str(DOCS / "certificate.png"))
    browser.close()
print("screenshots written to", DOCS)
