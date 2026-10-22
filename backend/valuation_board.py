"""S&P 500 valuation board, intrinsic-value buy levels and the price-alert checker.

Board: every S&P 500 constituent's price vs its OptiIQ Value -- the same model as Analyze -> Long-term
(engine.optiiq_value on the same Finnhub metrics + SEC quarterly financials) -- bucketed by discount/premium.
Fundamentals refresh once a day per stock, paced so most of the Finnhub budget stays free for users; prices
refresh every 10 minutes from batched Tradier quotes and every valuation is recomputed from them.
"""
from __future__ import annotations
import asyncio
import json
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

import httpx
from fastapi import Header
from pymongo import UpdateOne

import market
import tradier
from engine import optiiq_value

SP500: List[Dict[str, str]] = json.loads((Path(__file__).parent / "data" / "sp500.json").read_text())
SP500_INDEX = {s["ticker"]: s for s in SP500}

BUCKETS = [
    {"id": "very_under", "label": "Very Undervalued", "range": "< −30%"},
    {"id": "under", "label": "Undervalued", "range": "−30% to −10%"},
    {"id": "fair", "label": "Fairly Valued", "range": "−10% to +10%"},
    {"id": "over", "label": "Overvalued", "range": "+10% to +30%"},
    {"id": "very_over", "label": "Very Overvalued", "range": "> +30%"},
]
FUND_TTL = 86400.0        # fundamentals refresh once a day
RETRY_TTL = 3600.0        # stocks with missing data are retried after an hour
BOARD_FINNHUB_CAP = 30    # board pauses while the last minute's Finnhub calls exceed this (budget 55/min)
PRICE_EVERY = 600


def bucket_of(premium: float) -> str:
    if premium < -30:
        return "very_under"
    if premium < -10:
        return "under"
    if premium <= 10:
        return "fair"
    if premium <= 30:
        return "over"
    return "very_over"


def optiiq_sector(tk: str, fallback: Optional[str]) -> str:
    """GICS sector for S&P 500 names (so the board and Analyze pick the same model), provider sector otherwise."""
    return SP500_INDEX.get(tk, {}).get("sector") or fallback or ""


def fill_balance_gaps(financials: List[Dict[str, Any]], metrics: Dict[str, Any], price: float) -> None:
    """Latest quarter's missing cash / equity estimated from per-share metrics x share count."""
    if not financials or not price or not metrics.get("market_cap"):
        return
    last = financials[-1]
    shares = metrics["market_cap"] / price
    if last.get("cash") is None and metrics.get("cash_per_share_q"):
        last["cash"] = metrics["cash_per_share_q"] * shares
        last["cash_estimated"] = True
    if last.get("equity") is None and metrics.get("book_value_per_share_q"):
        last["equity"] = metrics["book_value_per_share_q"] * shares
        last["equity_estimated"] = True


def evaluate(doc: Dict[str, Any], price: float) -> Dict[str, Any]:
    rows = [dict(r) for r in doc.get("financials") or []]
    metrics = doc.get("metrics") or {}
    fill_balance_gaps(rows, metrics, price)
    o = optiiq_value(price, metrics, rows, doc.get("sector") or "")
    if not o.get("available"):
        return {"price": round(price, 2), "value": None, "premium": None, "bucket": None, "reason": o.get("reason")}
    prem = round((price / o["value"] - 1) * 100, 1)
    return {"price": round(price, 2), "value": o["value"], "premium": prem, "bucket": bucket_of(prem), "reason": None}


def _date(t: Optional[float]) -> Optional[str]:
    if not t:
        return None
    return datetime.fromtimestamp(t / 1000 if t > 1e11 else t, tz=timezone.utc).strftime("%Y-%m-%d")


def buy_levels(candles: List[Dict[str, float]], price: float, intrinsic: Optional[float], count: int = 4) -> List[Dict[str, Any]]:
    """Up to `count` buy levels below min(price, intrinsic value), highest first.
    History: swing lows (lowest low of +/-5 days) that bounced >=3% within 15 days, clustered within ~1 ATR;
    a cluster needs 2+ bounces. Strongest first (bounces + recency), at least 3% apart.
    Any gap is filled with 10% steps below that ceiling."""
    ceiling = min(price, intrinsic) if intrinsic else price
    cap = ceiling * 0.99
    n = len(candles)
    chosen: List[Dict[str, Any]] = []
    if n >= 40:
        lows = [c["l"] for c in candles]
        closes = [c["c"] for c in candles]
        atr = sum(c["h"] - c["l"] for c in candles[-50:]) / min(50, n) / price
        tol = min(max(atr, 0.012), 0.04)
        pivots = []
        for i in range(5, n - 2):
            if lows[i] == min(lows[i - 5: i + 6]):
                fwd = closes[i + 1: i + 16]
                if fwd and max(fwd) >= lows[i] * 1.03:
                    pivots.append((lows[i], i))
        pivots.sort()
        clusters: List[Dict[str, Any]] = []
        for p, i in pivots:
            if clusters and p <= clusters[-1]["floor"] * (1 + tol):
                clusters[-1]["pts"].append((p, i))
            else:
                clusters.append({"floor": p, "pts": [(p, i)]})
        cands = []
        for c in clusters:
            touches = len(c["pts"])
            level = sum(p for p, _ in c["pts"]) / touches
            if touches < 2 or level >= cap:
                continue
            last = max(i for _, i in c["pts"])
            age = n - 1 - last
            cands.append({"price": level, "source": "history", "touches": touches, "last_i": last,
                          "strength": touches + (0.5 if age <= 126 else 0.25 if age <= 252 else 0)})
        for x in sorted(cands, key=lambda x: (-x["strength"], -x["price"])):
            if all(abs(x["price"] / y["price"] - 1) >= 0.03 for y in chosen):
                chosen.append(x)
            if len(chosen) == count:
                break
    step = 1
    while len(chosen) < count and step <= 9:
        lvl = ceiling * (1 - 0.1 * step)
        if lvl < cap and all(abs(lvl / y["price"] - 1) >= 0.03 for y in chosen):
            chosen.append({"price": lvl, "source": "step", "step_pct": 10 * step})
        step += 1
    out = []
    for j, x in enumerate(sorted(chosen, key=lambda x: -x["price"]), 1):
        d = {"label": f"B{j}", "price": round(x["price"], 2), "source": x["source"],
             "below_price_pct": round((x["price"] / price - 1) * 100, 1),
             "below_value_pct": round((x["price"] / intrinsic - 1) * 100, 1) if intrinsic else None}
        if x["source"] == "history":
            d["touches"] = x["touches"]
            d["last_touch"] = _date(candles[x["last_i"]].get("t"))
        else:
            d["step_pct"] = x["step_pct"]
            d["step_from"] = "value" if intrinsic and intrinsic <= price else "price"
        out.append(d)
    return out


def register(api_router, *, db, get_user: Callable, send_push: Callable, market_open_now: Callable, logger) -> Dict[str, Callable]:
    col = db.valuation_board
    cache: Dict[str, Any] = {}

    async def refresh_fundamentals(client: httpx.AsyncClient, s: Dict[str, str], price: Optional[float]) -> None:
        tk = s["ticker"]
        metrics = await market.get_metrics(client, tk)
        fins = await market.get_quarterly_financials(client, tk, 8) if metrics.get("market_cap") else []
        if not price:
            price = ((await market.get_quote(client, tk)) or {}).get("price")
        doc: Dict[str, Any] = {
            "ticker": tk, "name": s["name"], "sector": s["sector"], "metrics": metrics,
            "financials": [{k: r.get(k) for k in ("free_cash_flow", "cash", "total_debt", "equity")} for r in fins[-4:]],
            "fund_ts": time.time() - (FUND_TTL - RETRY_TTL if not (metrics.get("market_cap") and fins) else 0),
        }
        if price:
            doc.update(evaluate(doc, price))
            doc["price_ts"] = time.time()
        await col.update_one({"_id": tk}, {"$set": doc}, upsert=True)

    async def fundamentals_loop():
        await asyncio.sleep(45)
        while True:
            try:
                now = time.time()
                seen = {d["_id"]: d.get("fund_ts", 0) async for d in col.find({}, {"fund_ts": 1})}
                todo = sorted((s for s in SP500 if now - seen.get(s["ticker"], 0) > FUND_TTL), key=lambda s: seen.get(s["ticker"], 0))
                if todo:
                    async with httpx.AsyncClient() as client:
                        prices = await tradier.quotes(client, [s["ticker"] for s in todo])
                        for s in todo:
                            while market.recent_calls("finnhub.io") > BOARD_FINNHUB_CAP:
                                await asyncio.sleep(2)
                            try:
                                await refresh_fundamentals(client, s, prices.get(s["ticker"]))
                            except Exception as ex:
                                logger.warning(f"board {s['ticker']}: {ex}")
                            cache.clear()
                            await asyncio.sleep(1.5)
            except Exception as ex:
                logger.warning(f"board loop: {ex}")
            await asyncio.sleep(900)

    async def price_loop():
        await asyncio.sleep(60)
        while True:
            try:
                async with httpx.AsyncClient() as client:
                    prices = await tradier.quotes(client, [s["ticker"] for s in SP500])
                ops = [UpdateOne({"_id": d["_id"]}, {"$set": {**evaluate(d, prices[d["_id"]]), "price_ts": time.time()}})
                       async for d in col.find({"metrics": {"$exists": True}}) if prices.get(d["_id"])]
                if ops:
                    await col.bulk_write(ops, ordered=False)
                    cache.clear()
            except Exception as ex:
                logger.warning(f"board prices: {ex}")
            await asyncio.sleep(PRICE_EVERY if market_open_now() else 3 * PRICE_EVERY)

    async def check_price_alerts() -> int:
        alerts = await db.alerts.find({"kind": {"$in": ["price_above", "price_below"]}, "active": True}, {"_id": 0}).to_list(5000)
        if not alerts:
            return 0
        tks = sorted({a["ticker"] for a in alerts})
        async with httpx.AsyncClient() as client:
            prices = await tradier.quotes(client, tks)
            for tk in tks:
                if not prices.get(tk):
                    q = await market.get_quote(client, tk)
                    if q and q.get("price"):
                        prices[tk] = q["price"]
        fired = 0
        for a in alerts:
            p, th = prices.get(a["ticker"]), a.get("threshold")
            below = a["kind"] == "price_below"
            if not p or not th or not (p <= th if below else p >= th):
                continue
            now = datetime.now(timezone.utc)
            res = await db.alerts.update_one({"alert_id": a["alert_id"], "active": True},
                                             {"$set": {"active": False, "triggered_at": now, "triggered_price": round(p, 2)}})
            if not res.modified_count:
                continue
            title = f"{a['ticker']} {'dropped to' if below else 'rose to'} ${p:,.2f}"
            message = f"{a.get('note') or ('Price below' if below else 'Price above')} · your level ${th:,.2f}"
            await db.alert_events.insert_one({
                "event_id": f"evt_{uuid.uuid4().hex[:12]}", "user_id": a["user_id"], "key": a["alert_id"], "kind": a["kind"],
                "ticker": a["ticker"], "price": round(p, 2), "threshold": th, "title": title, "message": message,
                "created_at": now, "read": False,
            })
            try:
                await send_push(recipients=[a["user_id"]], data={"title": title, "message": message, "action_url": f"/ticker/{a['ticker']}"})
            except Exception as ex:
                logger.info(f"price alert push skipped: {ex}")
            fired += 1
        return fired

    async def price_alert_loop():
        await asyncio.sleep(75)
        while True:
            try:
                if market_open_now():
                    await check_price_alerts()
            except Exception as ex:
                logger.warning(f"price alerts: {ex}")
            await asyncio.sleep(120)

    @api_router.get("/valuation/board")
    async def valuation_board(authorization: Optional[str] = Header(default=None)):
        await get_user(authorization)
        hit = cache.get("board")
        if hit and time.time() - hit[0] < 60:
            return hit[1]
        rows = await col.find({}, {"_id": 0, "metrics": 0, "financials": 0}).to_list(1000)
        stocks = sorted(({"t": r["ticker"], "n": r["name"], "s": r["sector"], "p": r["price"], "v": r["value"],
                          "d": r["premium"], "b": r["bucket"]} for r in rows if r.get("bucket")), key=lambda x: x["d"])
        counts = {b["id"]: 0 for b in BUCKETS}
        for x in stocks:
            counts[x["b"]] += 1
        stamp = lambda k: max((r.get(k) or 0 for r in rows), default=0)
        out = {
            "buckets": [{**b, "count": counts[b["id"]]} for b in BUCKETS],
            "stocks": stocks,
            "unrated": [{"t": r["ticker"], "n": r["name"], "s": r["sector"], "why": r.get("reason") or "No price yet"}
                        for r in rows if not r.get("bucket")],
            "sectors": sorted({s["sector"] for s in SP500}),
            "progress": {"valued": len(rows), "total": len(SP500)},
            "prices_at": datetime.fromtimestamp(stamp("price_ts"), tz=timezone.utc).isoformat() if stamp("price_ts") else None,
            "method": "Premium = price ÷ OptiIQ Value − 1, the same intrinsic-value model as Analyze → Long-term. "
                      "Company numbers refresh daily, prices every 10 minutes. Research only, not investment advice.",
        }
        cache["board"] = (time.time(), out)
        return out

    return {"fundamentals_loop": fundamentals_loop, "price_loop": price_loop, "price_alert_loop": price_alert_loop,
            "check_price_alerts": check_price_alerts}
