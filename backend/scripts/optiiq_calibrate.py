"""OptiIQ (9-method average) on live data: python scripts/optiiq_calibrate.py AAPL MSFT KO ..."""
import asyncio
import sys
from pathlib import Path

import httpx
from dotenv import load_dotenv

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
load_dotenv(Path(__file__).resolve().parent.parent / ".env")
import market  # noqa: E402
from optiiq import optiiq_value  # noqa: E402
from valuation_board import fill_balance_gaps, optiiq_sector  # noqa: E402


async def one(client, tk):
    q = await market.get_quote(client, tk)
    m = await market.get_metrics(client, tk)
    fins = await market.get_quarterly_financials(client, tk, 8)
    e = await market.get_earnings(client, tk)
    price = (q or {}).get("price")
    fill_balance_gaps(fins, m, price)
    o = optiiq_value(price, m, fins, optiiq_sector(tk, None), tk, e.get("estimates"))
    g = (o.get("inputs") or {}).get("growth") or {}
    head = f"${o['value']:>8.2f} ({o['upside_pct']:+.0f}%){' LOW' if o.get('confidence') == 'low' else ''}" if o.get("available") else f"n/a ({o.get('reason')})"
    print(f"{tk:5} ${price:>8.2f} -> {head} | g {g.get('years_1_5', 0) * 100:.1f}/{g.get('years_6_10', 0) * 100:.1f}/"
          f"{g.get('years_11_20', 0) * 100:.1f}% r {(o.get('inputs') or {}).get('discount_rate', 0) * 100:.1f}% | "
          + " ".join(f"{x['short']} {x['value']}" for x in o.get("methods") or []))


async def main(tks):
    async with httpx.AsyncClient(timeout=30) as client:
        for tk in tks:
            try:
                await one(client, tk)
            except Exception as ex:
                print(tk, "ERROR", type(ex).__name__, ex)

asyncio.run(main(sys.argv[1:]))
