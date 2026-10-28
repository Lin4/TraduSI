"""Calibration run for OptiIQ v5 (revenue-driven DCF) on live data: python scripts/optiiq_calibrate.py TSLA PLTR ..."""
import asyncio
import sys
from pathlib import Path

import httpx
from dotenv import load_dotenv

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
load_dotenv(Path(__file__).resolve().parent.parent / ".env")
import market  # noqa: E402
from engine import optiiq_value  # noqa: E402
from valuation_board import fill_balance_gaps, optiiq_sector  # noqa: E402


async def one(client, tk):
    q = await market.get_quote(client, tk)
    m = await market.get_metrics(client, tk)
    fins = await market.get_quarterly_financials(client, tk, 8)
    e = await market.get_earnings(client, tk)
    hist = await market.get_capex_history(client, tk)
    price = (q or {}).get("price")
    fill_balance_gaps(fins, m, price)
    o = optiiq_value(price, m, fins, optiiq_sector(tk, None), tk, e.get("estimates"), hist)
    if not o.get("available"):
        print(f"{tk:5} ${price:>8.2f}  unavailable: {o.get('reason')}")
        return
    g, mg, r, d, sc = o.get("growth", {}), o.get("margin", {}), o.get("reinvestment", {}), o.get("discount", {}), o.get("scenarios", {})
    ins = ", ".join(f"{x['label'][:22]} {x['pct']}%" for x in g.get("inputs", []))
    print(f"{tk:5} ${price:>8.2f} -> ${o['value']:>9.2f} ({o['upside_pct']:+.1f}%){' LOW' if o.get('confidence') == 'low' else ''} | "
          f"g1 {g.get('year1', 0) * 100:.1f}% fade {g.get('fade', 0) * 100:.0f}% [{ins}] | "
          f"EBIT {mg.get('initial', 0) * 100:.1f}%(rep {round((mg.get('reported') or 0) * 100, 1)} +SBC {round((mg.get('stock_pay_addback') or 0) * 100, 1)})"
          f"->{mg.get('stable', 0) * 100:.1f}% | DA {r.get('da_pct', 0) * 100:.1f}% "
          f"capex {r.get('capex_pct', 0) * 100:.1f}%->{r.get('capex_target_pct', 0) * 100:.1f}% NWC {r.get('nwc_pct_of_revenue_change', 0) * 100:.1f}% | "
          f"WACC {d.get('wacc', 0) * 100:.1f}% TV {o.get('terminal_share_pct')}% | bear {sc.get('bear', {}).get('value')} bull {sc.get('bull', {}).get('value')}")


async def main(tks):
    async with httpx.AsyncClient(timeout=30) as client:
        for tk in tks:
            try:
                await one(client, tk)
            except Exception as ex:
                print(tk, "ERROR", type(ex).__name__, ex)

asyncio.run(main(sys.argv[1:]))
