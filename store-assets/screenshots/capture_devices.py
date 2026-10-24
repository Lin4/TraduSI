"""Capture real TraduSI screens for each App Store device class.

usage: python capture_devices.py iphone|duo|ipad
  iphone : iPhone 6.3" Dynamic Island  402x874  @3x -> 1206x2622
  duo    : iPhone Duo (inner display)   669x951  @3x -> 2007x2853
  ipad   : iPad 13"                    1032x1376 @2x -> 2064x2752
"""
import asyncio, sys
from pathlib import Path
from playwright.async_api import async_playwright

URL = "https://optionscope.preview.emergentagent.com"
DEVICES = {"iphone": (402, 874, 3), "duo": (669, 951, 3), "ipad": (1032, 1376, 2)}
LONG_TICKER, OPT_TICKER = "AMZN", "NVDA"


async def top(page, test_id, offset=0):
    """Scroll the nearest scroll container so `test_id` sits `offset` px below the top."""
    el = page.get_by_test_id(test_id).first
    await el.wait_for(timeout=120000)
    await el.evaluate("(e, o) => { e.scrollIntoView({block: 'start'}); let p = e.parentElement;"
                      " while (p) { if (p.scrollHeight > p.clientHeight + 4 && getComputedStyle(p).overflowY !== 'visible') { p.scrollTop -= o; break; } p = p.parentElement; } }", offset)
    await page.wait_for_timeout(1200)


async def main(dev):
    w, h, dpr = DEVICES[dev]
    out = Path(__file__).parent / "raw" / dev
    out.mkdir(parents=True, exist_ok=True)

    async def shot(page, name):
        await page.wait_for_timeout(800)
        await page.screenshot(path=str(out / f"{name}.png"))
        print(dev, "saved", name, flush=True)

    async with async_playwright() as pw:
        b = await pw.chromium.launch(executable_path="/root/bin/chromium", args=["--no-sandbox"])
        ctx = await b.new_context(viewport={"width": w, "height": h}, device_scale_factor=dpr, is_mobile=dev != "ipad", has_touch=True)
        page = await ctx.new_page()
        await page.goto(URL)
        await page.wait_for_function("document.querySelector('#root') && document.querySelector('#root').innerText.length > 20", timeout=120000)
        await page.wait_for_timeout(2500)
        if await page.get_by_test_id("login-email").count():
            await page.get_by_test_id("login-email").fill("trader@optiscreen.app")
            await page.get_by_test_id("login-password").fill("TestPass123!")
            await page.get_by_test_id("login-submit").click()
        await page.get_by_test_id("disc-run").wait_for(timeout=60000)
        await page.wait_for_timeout(1500)

        # 1 market scan results
        await page.get_by_test_id("disc-run").click()
        await page.locator("[data-testid^='disc-result-']").first.wait_for(timeout=150000)
        try:
            await page.wait_for_function("!document.body.innerText.includes('AI is writing explanations')", timeout=90000)
        except Exception:
            pass
        await top(page, "scan-stats", 8)
        await shot(page, "1_scan")

        # 2-4 ranking, trade plan, validation
        await page.goto(f"{URL}/analyze?ticker={OPT_TICKER}&range=month")
        await page.get_by_test_id("optiscore-card").wait_for(timeout=150000)
        await page.wait_for_timeout(2500)
        await top(page, "quote-source-badge", 14)
        await shot(page, "2_rank")
        await top(page, "plan-card", 12)
        await shot(page, "3_plan")
        await page.get_by_test_id("validation-card-toggle").click()
        await page.get_by_test_id("validation-verdict").wait_for()
        await top(page, "validation-card", 12)
        await shot(page, "4_validate")

        # 5 performance tracking
        await page.goto(f"{URL}/track-record")
        await page.get_by_test_id("track-tab-backtest").click()
        await page.get_by_test_id("track-backtest").wait_for(timeout=90000)
        await page.wait_for_timeout(2000)
        await shot(page, "5_track")

        # 6 long-term investing
        await page.goto(f"{URL}/analyze")
        await page.get_by_test_id("lab-long").wait_for(timeout=60000)
        await page.get_by_test_id("lab-long").click()
        await page.get_by_test_id("analyze-ticker").fill(LONG_TICKER)
        await page.get_by_test_id("analyze-run").click()
        await page.get_by_test_id("optiiq-card").wait_for(timeout=150000)
        await page.wait_for_timeout(3000)
        await top(page, "optiiq-card", 64)
        await shot(page, "6_long")
        await b.close()


asyncio.run(main(sys.argv[1]))
