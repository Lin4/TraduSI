"""Compose TraduSI App Store screenshots for every required device size.

Branded background + benefit headline + the real app screen (raw/<device>/*.png) inside a device frame.
Output: final/<device folder>/NN_name.png (RGB, no alpha - App Store requirement).
"""
import asyncio, base64, json
from pathlib import Path
from PIL import Image
from playwright.async_api import async_playwright

ROOT = Path(__file__).parent
FONT = Path.home() / ".fonts"
ICON = ROOT.parent / "icon" / "individual" / "A_scan_lens_rounded.png"

SHOTS = [
    ("1_scan", "Find the best opportunities <g>instantly</g>", "TraduSI scans the market and surfaces the strongest ideas in seconds."),
    ("2_rank", "Know which ideas are <g>worth it</g>", "Every idea gets a simple <span style=\"white-space:nowrap\">0–100</span> score for return, risk and fit."),
    ("3_plan", "A clear plan <g>before you trade</g>", "Entry, take-profit, stop and position size — in plain English."),
    ("4_validate", "See how it did <g>in the past</g>", "Backtests, costs and stress tests show the risks up front."),
    ("5_track", "Results you can <g>actually check</g>", "Win rate and prediction accuracy, tracked openly."),
    ("6_long", "Invest for the <g>long run</g>", "Fair value, fundamentals and buy zones for long-term investors."),
]

# canvas W x H, raw viewport aspect (h/w), frame kind, typography (brand, h1, p, side padding, top)
DEVICES = {
    "iphone": dict(folder="iPhone_6.3in_1206x2622", W=1206, H=2622, ar=874 / 402, kind="phone", brand=38, h1=92, p=40, side=70, top=110, maxw=0.72),
    "duo": dict(folder="iPhone_Duo_2007x2853", W=2007, H=2853, ar=951 / 669, kind="duo", brand=54, h1=126, p=56, side=130, top=130, maxw=0.80),
    "ipad": dict(folder="iPad_13in_2064x2752", W=2064, H=2752, ar=1376 / 1032, kind="ipad", brand=54, h1=124, p=54, side=170, top=130, maxw=0.86),
}

# frame geometry as fractions of the device width
FRAMES = {
    "phone": dict(edge=0.013, pad=0.022, r=0.150, sr=0.118, status=0.128, bottom=0.075, island=True, font=0.045, buttons=True),
    "duo": dict(edge=0.009, pad=0.020, r=0.085, sr=0.062, status=0.070, bottom=0.045, island=False, font=0.030, buttons=True),
    "ipad": dict(edge=0.007, pad=0.020, r=0.055, sr=0.034, status=0.034, bottom=0.022, island=False, font=0.018, buttons=False),
}
# titanium side buttons: (side, top as fraction of device height, length fraction)
BUTTONS = [("l", 0.160, 0.040), ("l", 0.228, 0.072), ("l", 0.316, 0.072), ("r", 0.262, 0.110)]

STATUS_ICONS = """<svg viewBox="0 0 150 40" fill="#0B1220">
  <rect x="0" y="26" width="9" height="12" rx="2"/><rect x="13" y="19" width="9" height="19" rx="2"/>
  <rect x="26" y="11" width="9" height="27" rx="2"/><rect x="39" y="3" width="9" height="35" rx="2"/>
  <path d="M74 14a26 26 0 0 1 34 0l-4 4a20 20 0 0 0-26 0z M80 21a17 17 0 0 1 22 0l-4 4a11 11 0 0 0-14 0z M86 28a8 8 0 0 1 10 0l-5 6z"/>
  <rect x="114" y="6" width="31" height="28" rx="7" fill="none" stroke="#0B1220" stroke-width="3"/>
  <rect x="118" y="10" width="23" height="20" rx="4"/><rect x="146" y="15" width="3" height="10" rx="1.5"/>
</svg>"""


def b64(p: Path) -> str:
    return base64.b64encode(p.read_bytes()).decode()


def page_html(d: dict, raw: Path, headline: str, sub: str) -> str:
    f = FRAMES[d["kind"]]
    headline = headline.replace("<g>", '<span class="g">').replace("</g>", "</span>")
    time = "9:41 &nbsp;Tue Jun 9" if d["kind"] == "ipad" else "9:41"
    island = '<div class="island"></div>' if f["island"] else ('<div class="cam"></div>' if d["kind"] == "duo" else "")
    buttons = "".join(f'<i class="btn" data-s="{s}" data-t="{t}" data-l="{n}"></i>' for s, t, n in BUTTONS) if f["buttons"] else ""
    W, H = d["W"], d["H"]
    return f"""<html><head><meta charset="utf-8"><style>
@font-face {{ font-family: InterX; src: url('file://{FONT}/Inter-ExtraBold.ttf'); font-weight: 800; }}
@font-face {{ font-family: InterX; src: url('file://{FONT}/Inter-Bold.ttf'); font-weight: 700; }}
@font-face {{ font-family: InterX; src: url('file://{FONT}/Inter-SemiBold.ttf'); font-weight: 600; }}
@font-face {{ font-family: InterX; src: url('file://{FONT}/Inter-Medium.ttf'); font-weight: 500; }}
* {{ margin: 0; padding: 0; box-sizing: border-box; }}
body {{ width: {W}px; height: {H}px; overflow: hidden; font-family: InterX, sans-serif; }}
.c {{ position: relative; width: {W}px; height: {H}px; overflow: hidden; display: flex; flex-direction: column; align-items: center;
      padding-top: {d['top']}px; background: linear-gradient(170deg, #EAF2FF 0%, #F6F9FF 45%, #E8FBF3 100%); }}
.blob1 {{ position: absolute; width: {W*0.75}px; height: {W*0.75}px; border-radius: 50%; left: -{W*0.3}px; top: -{W*0.25}px;
          background: radial-gradient(circle, rgba(37,99,235,.16), rgba(37,99,235,0) 70%); }}
.blob2 {{ position: absolute; width: {W*0.8}px; height: {W*0.8}px; border-radius: 50%; right: -{W*0.33}px; top: {H*0.55}px;
          background: radial-gradient(circle, rgba(16,185,129,.18), rgba(16,185,129,0) 70%); }}
.text {{ position: relative; text-align: center; padding: 0 {d['side']}px; }}
.brand {{ display: inline-flex; align-items: center; gap: {d['brand']*0.4}px; font-weight: 800; font-size: {d['brand']}px; color: #1E40AF; letter-spacing: 0.5px; }}
.brand img {{ width: {d['brand']*1.35}px; height: {d['brand']*1.35}px; }}
h1 {{ text-wrap: balance; margin-top: {d['brand']*0.9}px; font-weight: 800; font-size: {d['h1']}px; line-height: 1.08; letter-spacing: -{d['h1']*0.025}px; color: #0B1B3F; }}
.g {{ background: linear-gradient(90deg, #1D4ED8, #059669); -webkit-background-clip: text; color: transparent; }}
p {{ text-wrap: balance; margin: {d['p']*0.6}px auto 0; max-width: {W*0.82}px; font-weight: 500; font-size: {d['p']}px; line-height: 1.36; color: #475569; }}
.dev {{ position: relative; margin-top: {d['p']*1.4}px; border-style: solid; border-color: transparent;
        background: linear-gradient(#05070B, #05070B) padding-box,
                    linear-gradient(135deg, #E4E7EB 0%, #7C838C 18%, #D3D7DC 38%, #5E656E 60%, #C9CDD2 80%, #8A9099 100%) border-box;
        box-shadow: 0 {W*0.045}px {W*0.1}px rgba(15,23,42,.30), 0 {W*0.01}px {W*0.02}px rgba(15,23,42,.18); }}
.btn {{ position: absolute; background: linear-gradient(90deg, #6B727B, #D5D9DE 50%, #7E858E); }}
.screen {{ position: relative; overflow: hidden; background: #fff; }}
.status {{ display: flex; align-items: center; justify-content: space-between; font-weight: 600; color: #0B1220; }}
.status svg {{ height: 32%; }}
.island {{ position: absolute; left: 50%; transform: translateX(-50%); background: #000; }}
.cam {{ position: absolute; left: 50%; transform: translateX(-50%); background: #0B1220; border-radius: 50%; }}
.screen img {{ display: block; width: 100%; }}
.home {{ position: relative; background: #fff; }}
.home i {{ position: absolute; left: 50%; bottom: 28%; transform: translateX(-50%); width: 36%; height: 16%; min-height: 8px; border-radius: 99px; background: #0B1220; }}
</style></head><body><div class="c">
<div class="blob1"></div><div class="blob2"></div>
<div class="text" id="text">
  <div class="brand"><img src="data:image/png;base64,{b64(ICON)}">TraduSI</div>
  <h1>{headline}</h1>
  <p>{sub}</p>
</div>
<div class="dev" id="dev">{buttons}<div class="screen" id="screen">
  {island}
  <div class="status" id="status"><span>{time}</span>{STATUS_ICONS}</div>
  <img src="data:image/png;base64,{b64(raw)}">
  <div class="home" id="home"><i></i></div>
</div></div>
</div>
<script>
  // size the device to fill the space under the headline (keeps the tab bar visible)
  const F = {json.dumps(f)}; const AR = {d['ar']}; const W = {W}, H = {H};
  const dev = document.getElementById('dev'), scr = document.getElementById('screen'), st = document.getElementById('status');
  const topY = document.getElementById('text').getBoundingClientRect().bottom + {d['p']*1.4};
  const avail = H - topY - {H*0.03};
  // total height = 2*(edge+pad)*w + status*w + bottom*w + (w - 2*(edge+pad)*w) * AR
  const K = F.edge + F.pad;
  let w = avail / (2 * K + F.status + F.bottom + (1 - 2 * K) * AR);
  w = Math.min(w, W * {d['maxw']});
  const pad = F.pad * w, edge = F.edge * w;
  dev.style.width = w + 'px'; dev.style.padding = pad + 'px'; dev.style.borderWidth = edge + 'px'; dev.style.borderRadius = F.r * w + 'px';
  const devH = dev.getBoundingClientRect().height, bw = w * 0.011;
  document.querySelectorAll('.btn').forEach(b => {{
    b.style.width = bw + 'px'; b.style.height = b.dataset.l * devH + 'px'; b.style.top = b.dataset.t * devH + 'px';
    b.style[b.dataset.s === 'l' ? 'left' : 'right'] = -(edge + bw * 0.9) + 'px';
    b.style.borderRadius = b.dataset.s === 'l' ? `${{bw}}px 0 0 ${{bw}}px` : `0 ${{bw}}px ${{bw}}px 0`;
  }});
  scr.style.borderRadius = F.sr * w + 'px';
  document.getElementById('home').style.height = F.bottom * w + 'px';
  st.style.height = F.status * w + 'px'; st.style.fontSize = F.font * w + 'px';
  st.style.padding = F.island ? `${{F.status * w * 0.12}}px ${{w * 0.085}}px 0 ${{w * 0.105}}px` : `0 ${{w * 0.04}}px`;
  const isl = document.querySelector('.island');
  if (isl) {{ isl.style.width = w * 0.322 + 'px'; isl.style.height = w * 0.091 + 'px'; isl.style.top = w * 0.033 + 'px'; isl.style.borderRadius = w * 0.0455 + 'px'; }}
  const cam = document.querySelector('.cam');
  if (cam) {{ const z = w * 0.022; cam.style.width = z + 'px'; cam.style.height = z + 'px'; cam.style.top = (F.status * w - z) / 2 + 'px'; }}
  document.body.dataset.ready = '1';
</script>
</body></html>"""


async def main():
    async with async_playwright() as pw:
        b = await pw.chromium.launch(executable_path="/root/bin/chromium", args=["--no-sandbox", "--allow-file-access-from-files"])
        for key, d in DEVICES.items():
            out = ROOT / "final" / d["folder"]
            out.mkdir(parents=True, exist_ok=True)
            pg = await b.new_page(viewport={"width": d["W"], "height": d["H"]}, device_scale_factor=1)
            for n, (name, head, sub) in enumerate(SHOTS, 1):
                raw = ROOT / "raw" / key / f"{name}.png"
                html = ROOT / f"_{key}_{name}.html"
                html.write_text(page_html(d, raw, head, sub))
                await pg.goto(f"file://{html}")
                await pg.wait_for_function("document.body.dataset.ready === '1'")
                await pg.evaluate("document.fonts.ready")
                await pg.wait_for_timeout(300)
                png = out / f"{n:02d}_{name.split('_', 1)[1]}.png"
                await pg.screenshot(path=str(png))
                Image.open(png).convert("RGB").save(png)
                html.unlink()
                print("composed", png.relative_to(ROOT), Image.open(png).size)
            await pg.close()
        await b.close()


asyncio.run(main())
