"""TraduSI App Store screenshots in a dark, Robinhood-style layout, built from the user's own iPhone screenshots.

user_raw/IMG_xxxx.webp (923x2000 phone screenshots) -> big white headline + subline on a near-black background,
the screen inside a graphite iPhone frame. The phone's own status bar (time, focus icon, low battery) is replaced
with a clean 9:41 / full-battery bar.
  - iPhone 6.3" canvas: the whole phone is visible.
  - iPhone Duo (inner display) and iPad 13" canvases are much wider, so the phone is larger and runs off the
    bottom edge (like the template).
Output: final_dark/<size>/NN_name.png  (RGB, exact App Store pixel sizes)
"""
import asyncio, base64, io, json, shutil
from pathlib import Path
from PIL import Image
from playwright.async_api import async_playwright

ROOT = Path(__file__).parent
RAW = ROOT / "user_raw"
OUT = ROOT / "final_dark"
FONT = Path.home() / ".fonts"

# (file, slug, headline, subline)  -- order = App Store order
SHOTS = [
    ("IMG_6525", "scan", "Find high-odds trades in seconds", "TraduSI scans the market and scores every idea 0–100, with a ready-made plan."),
    ("IMG_6524", "risk", "Trades that match your risk", "Pick low, balanced or high risk. Every pick starts at 70%+ modeled odds of profit."),
    ("IMG_6526", "plan", "Know your entry, target & stop", "Every trade comes with a clear plan, sized to your account."),
    ("IMG_6527", "payoff", "See how a trade pays off", "Payoff charts, breakevens and AI answers from live market data."),
    ("IMG_6528", "risks", "Know what could go wrong", "Profit and loss across price moves and time, before you trade."),
    ("IMG_6529", "chain", "Live option chains, made simple", "Real-time bids, asks, IV and open interest. Tap to build a trade."),
    ("IMG_6530", "builder", "Build any options strategy", "One-tap templates with max profit, max loss and odds of profit."),
    ("IMG_6531", "pnl", "Plan every day of the trade", "See your profit or loss for every date and price move."),
    ("IMG_6533", "buylevels", "Buy at the right price", "Intrinsic value plus 4 support-based buy levels, with price alerts."),
    ("IMG_6534", "financials", "Invest with the full picture", "Quarterly revenue, earnings and cash flow from SEC filings."),
]

# W, H, u = text scale (designed on the 1206-wide canvas), dev_top = fixed phone top,
# runoff = share of the phone hidden below the bottom edge (0 = whole phone visible, with a bottom margin)
SIZES = {
    "iPhone_6.3in_1206x2622": dict(W=1206, H=2622, u=1.0, dev_top=650, runoff=0.0),
    "iPhone_Duo_inner_2007x2853": dict(W=2007, H=2853, u=1.5, dev_top=880, runoff=0.17),
    "iPad_13in_2064x2752": dict(W=2064, H=2752, u=1.5, dev_top=860, runoff=0.17),
}
STATUS_FRACTION = 125 / 2000  # height of the phone's own status bar in the 923x2000 screenshots
SCREEN_AR = 2000 / 923

ICONS = """<svg viewBox="0 0 150 40" fill="#fff">
  <rect x="0" y="26" width="9" height="12" rx="2"/><rect x="13" y="19" width="9" height="19" rx="2"/>
  <rect x="26" y="11" width="9" height="27" rx="2"/><rect x="39" y="3" width="9" height="35" rx="2"/>
  <path d="M74 14a26 26 0 0 1 34 0l-4 4a20 20 0 0 0-26 0z M80 21a17 17 0 0 1 22 0l-4 4a11 11 0 0 0-14 0z M86 28a8 8 0 0 1 10 0l-5 6z"/>
  <rect x="114" y="6" width="31" height="28" rx="7" fill="none" stroke="#fff" stroke-opacity=".45" stroke-width="3"/>
  <rect x="118" y="10" width="23" height="20" rx="4"/><rect x="146" y="15" width="3" height="10" rx="1.5" fill-opacity=".45"/>
</svg>"""


def screen_png(name: str) -> str:
    im = Image.open(RAW / f"{name}.webp").convert("RGB")
    cut = round(im.height * STATUS_FRACTION)
    im.paste((0, 0, 0), (0, 0, im.width, cut))  # remove the phone's own status bar (app background is pure black)
    buf = io.BytesIO()
    im.save(buf, "PNG")
    return base64.b64encode(buf.getvalue()).decode()


def device_width(d: dict) -> float:
    """Phone frame width so the frame fills the space under the text (or runs off the bottom by `runoff`)."""
    W, H, top, runoff = d["W"], d["H"], d["dev_top"], d["runoff"]
    dev_h = (H - top) / (1 - runoff) if runoff else H - top - 0.035 * H
    k = 2 * (16 + 11) / 900  # (inner padding + titanium edge) on both sides, as a share of the frame width
    return dev_h / ((1 - k) * SCREEN_AR + k)


def html(d: dict, img_b64: str, head: str, sub: str) -> str:
    W, H, u, top = d["W"], d["H"], d["u"], d["dev_top"]
    w = device_width(d)
    v = w / 900  # frame geometry designed on a 900-wide phone
    return f"""<html><head><meta charset="utf-8"><style>
@font-face {{ font-family: InterX; src: url('file://{FONT}/Inter-Medium.ttf'); font-weight: 500; }}
@font-face {{ font-family: InterX; src: url('file://{FONT}/Inter-Regular.ttf'); font-weight: 400; }}
@font-face {{ font-family: InterX; src: url('file://{FONT}/Inter-SemiBold.ttf'); font-weight: 600; }}
* {{ margin: 0; padding: 0; box-sizing: border-box; }}
body {{ width: {W}px; height: {H}px; overflow: hidden; font-family: InterX, sans-serif; }}
.c {{ position: relative; width: {W}px; height: {H}px; overflow: hidden;
      background: radial-gradient(120% 60% at 50% 72%, #10201D 0%, #0B0D0C 55%, #080808 100%); }}
.zone {{ position: absolute; left: 0; right: 0; top: {60*u}px; height: {top - 140*u}px; display: flex; align-items: center; justify-content: center; }}
.text {{ text-align: center; padding: 0 {80*u}px; }}
h1 {{ font-weight: 500; font-size: {104*u}px; line-height: 1.08; letter-spacing: {-1.6*u}px; color: #fff; text-wrap: balance; }}
p {{ margin: {34*u}px auto 0; max-width: {960*u}px; font-weight: 400; font-size: {44*u}px; line-height: 1.34; color: #D4D7DB; text-wrap: balance; }}
.dev {{ position: absolute; left: {(W - w) / 2}px; top: {top}px; width: {w}px; padding: {16*v}px; border-radius: {138*v}px; border: {11*v}px solid transparent;
        background: linear-gradient(#050505, #050505) padding-box,
                    linear-gradient(140deg, #8E8E93 0%, #3A3A3D 18%, #A1A1A6 40%, #2C2C2F 62%, #7C7C81 82%, #3C3C40 100%) border-box;
        box-shadow: 0 0 {140*v}px rgba(45,212,191,.10), 0 {40*v}px {120*v}px rgba(0,0,0,.6); }}
.btn {{ position: absolute; width: {11*v}px; background: linear-gradient(90deg, #4A4A4E, #A1A1A6 55%, #4A4A4E); }}
.screen {{ position: relative; overflow: hidden; border-radius: {112*v}px; background: #000; }}
.screen img {{ display: block; width: 100%; }}
.status {{ position: absolute; left: 0; right: 0; top: 0; height: {108*v}px; display: flex; align-items: center; justify-content: space-between;
           padding: {14*v}px {78*v}px 0 {96*v}px; color: #fff; font-weight: 600; font-size: {40*v}px; z-index: 2; }}
.status svg {{ height: {30*v}px; }}
.island {{ position: absolute; left: 50%; transform: translateX(-50%); top: {30*v}px; width: {282*v}px; height: {82*v}px; border-radius: {41*v}px; background: #000; z-index: 3; }}
</style></head><body><div class="c">
  <div class="zone" id="zone"><div class="text" id="text"><h1>{head}</h1><p>{sub}</p></div></div>
  <div class="dev">
    <i class="btn" style="left:{-21*v}px; top:{330*v}px; height:{80*v}px; border-radius:{11*v}px 0 0 {11*v}px"></i>
    <i class="btn" style="left:{-21*v}px; top:{470*v}px; height:{150*v}px; border-radius:{11*v}px 0 0 {11*v}px"></i>
    <i class="btn" style="left:{-21*v}px; top:{650*v}px; height:{150*v}px; border-radius:{11*v}px 0 0 {11*v}px"></i>
    <i class="btn" style="right:{-21*v}px; top:{520*v}px; height:{230*v}px; border-radius:0 {11*v}px {11*v}px 0"></i>
    <div class="screen">
      <div class="island"></div>
      <div class="status"><span>9:41</span>{ICONS}</div>
      <img src="data:image/png;base64,{img_b64}">
    </div>
  </div>
</div>
<script>
  // shrink the text if a long headline would not fit above the phone
  document.fonts.ready.then(() => {{
    const z = document.getElementById('zone'), t = document.getElementById('text');
    let s = 1;
    while (t.scrollHeight > z.clientHeight && s > 0.6) {{ s -= 0.04; t.style.zoom = s; }}
    document.body.dataset.ready = '1';
  }});
</script>
</body></html>"""


async def main():
    shutil.rmtree(OUT, ignore_errors=True)
    imgs = {f: screen_png(f) for f, *_ in SHOTS}
    async with async_playwright() as pw:
        b = await pw.chromium.launch(executable_path="/root/bin/chromium", args=["--no-sandbox", "--allow-file-access-from-files"])
        for folder, d in SIZES.items():
            out = OUT / folder
            out.mkdir(parents=True, exist_ok=True)
            pg = await b.new_page(viewport={"width": d["W"], "height": d["H"]}, device_scale_factor=1)
            for n, (f, slug, head, sub) in enumerate(SHOTS, 1):
                tmp = ROOT / f"_tmp_{slug}.html"
                tmp.write_text(html(d, imgs[f], head, sub))
                await pg.goto(f"file://{tmp}")
                await pg.wait_for_function("document.body.dataset.ready === '1'")
                await pg.wait_for_timeout(200)
                png = out / f"{n:02d}_{slug}.png"
                await pg.screenshot(path=str(png))
                Image.open(png).convert("RGB").save(png)
                tmp.unlink()
            await pg.close()
            print("done", folder)
        await b.close()
    (OUT / "captions.json").write_text(json.dumps(
        [{"order": i, "screen": f, "headline": h, "subline": s} for i, (f, _, h, s) in enumerate(SHOTS, 1)], indent=2, ensure_ascii=False))


asyncio.run(main())
