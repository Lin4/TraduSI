"""S&P 500 valuation board, buy levels (support confluence) and the price-alert checker.

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
from pymongo.errors import DuplicateKeyError

import market
import tradier
from optiiq import optiiq_value

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
PRICE_EVERY = 600
MODEL_V = 8               # OptiIQ model version the stored inputs were collected for (average of 9 valuation methods)
FIN_FIELDS = ("label", "end_date", "fiscal_year", "fiscal_quarter", "revenue", "operating_income", "dep_amort", "sbc", "capex",
              "free_cash_flow", "operating_cash_flow", "net_income", "cash", "cash_and_investments", "total_debt", "equity",
              "receivables", "inventory", "payables", "deferred_revenue")


def is_current(doc: Dict[str, Any]) -> bool:
    """Stored inputs are complete for this model. An older app version sharing the database can rewrite a doc's metrics
    without the 10-year mean multiples (and keeps model_v), so the metric itself is checked too."""
    return doc.get("model_v") == MODEL_V and "mean_years" in (doc.get("metrics") or {})


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


def optiiq_of(doc: Dict[str, Any], price: float) -> Dict[str, Any]:
    rows = [dict(r) for r in doc.get("financials") or []]
    metrics = doc.get("metrics") or {}
    fill_balance_gaps(rows, metrics, price)
    return optiiq_value(price, metrics, rows, doc.get("sector") or "", doc.get("ticker") or doc.get("_id") or "", doc.get("estimates"),
                        doc.get("currency") or "USD")


def evaluate(doc: Dict[str, Any], price: float) -> Dict[str, Any]:
    o = optiiq_of(doc, price)
    if not o.get("available") or o.get("confidence") == "low":
        why = o.get("reason") or "Value is far from the price (unusual inputs), so it isn't grouped"
        return {"price": round(price, 2), "value": None, "premium": None, "bucket": None, "reason": why}
    prem = round((price / o["value"] - 1) * 100, 1)
    return {"price": round(price, 2), "value": o["value"], "premium": prem, "bucket": bucket_of(prem), "reason": None}


def _date(t: Optional[float]) -> Optional[str]:
    if not t:
        return None
    return datetime.fromtimestamp(t / 1000 if t > 1e11 else t, tz=timezone.utc).strftime("%Y-%m-%d")


FIB_RATIOS = ((0.236, 0.5), (0.382, 0.9), (0.5, 0.9), (0.618, 1.2), (0.786, 0.8))  # (retracement, weight)
MA_SET = ((50, 0.7), (100, 0.9), (200, 1.3))  # (days, weight)


def _sma(vals: List[float], n: int) -> List[Optional[float]]:
    out: List[Optional[float]] = [None] * len(vals)
    s = 0.0
    for i, v in enumerate(vals):
        s += v
        if i >= n:
            s -= vals[i - n]
        if i >= n - 1:
            out[i] = s / n
    return out


def _pivots(candles: List[Dict[str, float]], move: float, k: int = 5, horizon: int = 20) -> List[Dict[str, Any]]:
    """Reversal points: a swing low (lowest low of +/-k days) followed by a rally of `move`, or a swing high
    (highest high of +/-k days) followed by a drop of `move`, within `horizon` days."""
    out = []
    for i in range(k, len(candles) - 1):
        win, fwd, c = candles[i - k: i + k + 1], candles[i + 1: i + 1 + horizon], candles[i]
        if c["l"] == min(x["l"] for x in win) and max(x["c"] for x in fwd) >= c["l"] * (1 + move):
            out.append({"price": c["l"], "i": i, "kind": "low"})
        elif c["h"] == max(x["h"] for x in win) and min(x["c"] for x in fwd) <= c["h"] * (1 - move):
            out.append({"price": c["h"], "i": i, "kind": "high"})
    return out


def _ma_holds(candles: List[Dict[str, float]], sma: List[Optional[float]], horizon: int = 15) -> int:
    """Times price came down to the average from above, held it (close within 1.5%) and then rallied 4%+."""
    count, last = 0, -99
    for i in range(1, len(candles) - horizon):
        m, c = sma[i], candles[i]
        if m is None or sma[i - 1] is None or i - last < 10 or candles[i - 1]["c"] <= sma[i - 1]:
            continue
        if c["l"] <= m * 1.01 and c["c"] >= m * 0.985 and max(x["c"] for x in candles[i + 1: i + 1 + horizon]) >= c["c"] * 1.04:
            count, last = count + 1, i
    return count


def _fib_swing(candles: List[Dict[str, float]]) -> Optional[tuple]:
    """Main swing for Fibonacci retracements: the 2-year high and the lowest low before it (up-move);
    if the high came first, the rebound from the low after it."""
    n = len(candles)
    ih = max(range(n), key=lambda i: candles[i]["h"])
    il = min(range(ih + 1), key=lambda i: candles[i]["l"])
    if ih - il >= 20 and candles[ih]["h"] >= candles[il]["l"] * 1.15:
        return il, ih
    il = min(range(n), key=lambda i: candles[i]["l"])
    ih = max(range(il, n), key=lambda i: candles[i]["h"])
    if ih - il >= 10 and candles[ih]["h"] >= candles[il]["l"] * 1.15:
        return il, ih
    return None


def _money(v: float) -> str:
    return f"${v:,.2f}"


def buy_plan(candles: List[Dict[str, float]], price: float, intrinsic: Optional[float], count: int = 4) -> Dict[str, Any]:
    """Up to `count` buy levels below the price, each a zone where several signals agree:
    reversal points (swing lows/highs that turned price), the 50/100/200-day averages (and how often they held),
    Fibonacci retracements of the main 2-year swing, the 52-week low and the OptiIQ Value.
    Zones are scored by signal weight + agreement between different signal types; the best `count`
    (at least 3% or two daily ranges apart) are shown highest first. Short histories fall back to 10% steps."""
    n = len(candles)
    cap, floor = price * 0.99, price * 0.5
    cands: List[Dict[str, Any]] = []
    overlay: Optional[Dict[str, Any]] = None
    smas: Dict[int, List[Optional[float]]] = {}
    tol = 0.015
    if n >= 60:
        closes = [c["c"] for c in candles]
        atr = sum(c["h"] - c["l"] for c in candles[-50:]) / min(50, n) / price
        tol = min(max(atr, 0.012), 0.03)
        # 1. reversal points (scored per zone below)
        piv = [p for p in _pivots(candles, max(0.04, 2.5 * atr)) if floor <= p["price"] < cap]
        cands += [{"price": p["price"], "w": 0.6, "group": "reversal", "key": "reversal", "pivot": p} for p in piv]
        # 2. moving averages below the price
        for days, w in MA_SET:
            s = smas[days] = _sma(closes, days)
            m = s[-1]
            if m and floor <= m < cap:
                held = _ma_holds(candles, s)
                cands.append({"price": m, "w": w + 0.3 * min(held, 4), "group": "average", "key": f"ma{days}", "short": f"the {days}-day average",
                              "text": f"{days}-day average" + (f", held {held}x in {round(n / 252)} yrs" if held else "")})
        # 3. Fibonacci retracements of the main swing
        fib = None
        sw = _fib_swing(candles)
        if sw:
            il, ih = sw
            lo, hi = candles[il]["l"], candles[ih]["h"]
            fib = {"low": round(lo, 2), "high": round(hi, 2), "low_t": candles[il].get("t"), "high_t": candles[ih].get("t"),
                   "levels": [{"ratio": r, "price": round(hi - (hi - lo) * r, 2)} for r, _ in FIB_RATIOS]}
            for r, w in FIB_RATIOS:
                lv = hi - (hi - lo) * r
                if floor <= lv < cap:
                    cands.append({"price": lv, "w": w, "group": "fib", "key": f"fib{round(r * 1000)}", "short": f"the {r * 100:.1f}% Fibonacci level",
                                  "text": f"{r * 100:.1f}% Fibonacci retracement ({_money(lo)} to {_money(hi)} swing)"})
        # 4. 52-week low
        i52 = min(range(max(0, n - 252), n), key=lambda i: candles[i]["l"])
        if floor <= candles[i52]["l"] < cap:
            cands.append({"price": candles[i52]["l"], "w": 0.6, "group": "low52", "key": "low52", "text": "52-week low", "short": "the 52-week low"})
        overlay = {"sma50": [round(v, 2) if v else None for v in smas.get(50, [])],
                   "sma200": [round(v, 2) if v else None for v in smas.get(200, [])], "fib": fib, "reversals": []}
    # 5. intrinsic value
    if intrinsic and floor <= intrinsic < cap:
        cands.append({"price": intrinsic, "w": 1.0, "group": "value", "key": "value", "text": "OptiIQ Value (intrinsic value)", "short": "the OptiIQ Value"})

    # zones: signals within ~1 daily range of each other merge into one buy zone
    zones: List[Dict[str, Any]] = []
    for c in sorted(cands, key=lambda c: -c["price"]):
        if zones and c["price"] >= zones[-1]["top"] * (1 - tol):
            zones[-1]["m"].append(c)
        else:
            zones.append({"top": c["price"], "m": [c]})
    for z in zones:
        pts = [m["pivot"] for m in z["m"] if m["group"] == "reversal"]
        sig = [m for m in z["m"] if m["group"] != "reversal"]
        if pts:  # all reversal points in the zone become one signal
            touches, last = len(pts), max(p["i"] for p in pts)
            kinds, age = {p["kind"] for p in pts}, n - 1 - last
            text = f"{touches} past reversal{'s' if touches > 1 else ''} here, last {_date(candles[last].get('t')) or 'recently'}"
            if "high" in kinds:
                text += " (old resistance, now support)" if "low" not in kinds else " (support and resistance)"
            sig.append({"price": sum(p["price"] for p in pts) / touches, "group": "reversal", "key": "reversal", "text": text,
                        "short": f"{touches} past reversal{'s' if touches > 1 else ''}", "touches": touches, "last_i": last, "points": pts,
                        "w": 0.8 + 0.6 * min(touches - 1, 4) + (0.4 if age <= 126 else 0.2 if age <= 252 else 0) + (0.3 if len(kinds) == 2 else 0)})
        z["m"] = sorted(sig, key=lambda m: -m["w"])
        wsum = sum(m["w"] for m in sig)
        z["price"] = sum(m["price"] * m["w"] for m in sig) / wsum
        z["groups"] = {m["group"] for m in sig}
        z["score"] = wsum + 0.5 * (len(z["groups"]) - 1)
    chosen: List[Dict[str, Any]] = []
    gap = max(0.03, 2 * tol)  # levels at least 3% (or two daily ranges) apart
    near = lambda z: z["score"] * (1 - 0.8 * (1 - z["price"] / price))  # prefer nearer zones at equal strength
    for z in sorted(zones, key=lambda z: -near(z)):
        if all(abs(z["price"] / y["price"] - 1) >= gap for y in chosen):
            chosen.append(z)
        if len(chosen) == count:
            break
    ceiling = min(price, intrinsic) if intrinsic else price
    step = 1
    while len(chosen) < count and step <= 9:
        lvl = ceiling * (1 - 0.1 * step)
        if floor <= lvl < cap and all(abs(lvl / y["price"] - 1) >= gap for y in chosen):
            chosen.append({"price": lvl, "step_pct": 10 * step, "score": 0, "groups": set(), "m": []})
        step += 1

    levels = []
    for j, z in enumerate(sorted(chosen, key=lambda z: -z["price"]), 1):
        d: Dict[str, Any] = {"label": f"B{j}", "price": round(z["price"], 2),
                             "below_price_pct": round((z["price"] / price - 1) * 100, 1),
                             "below_value_pct": round((z["price"] / intrinsic - 1) * 100, 1) if intrinsic else None}
        if z["m"]:
            ms = z["m"]
            d.update({"source": "confluence", "score": round(z["score"], 1), "zone_low": round(min(m["price"] for m in ms), 2),
                      "zone_high": round(max(m["price"] for m in ms), 2), "signals": [m["key"] for m in ms],
                      "reasons": [m["text"] for m in ms],
                      "strength": "Strong" if z["score"] >= 5 or (z["score"] >= 4 and len(z["groups"]) >= 3) else "Moderate" if z["score"] >= 2.2 else "Light",
                      "short": [m["short"] for m in ms]})
            rev = [m for m in ms if m["group"] == "reversal"]
            if rev:
                d["touches"] = sum(m["touches"] for m in rev)
                d["last_touch"] = _date(candles[max(m["last_i"] for m in rev)].get("t"))
                if overlay is not None:
                    overlay["reversals"] += [[candles[p["i"]].get("t"), round(p["price"], 2), p["kind"]] for m in rev for p in m["points"]]
        else:
            base = "OptiIQ Value" if intrinsic and intrinsic <= price else "price"
            d.update({"source": "step", "step_pct": z["step_pct"], "step_from": "value" if base != "price" else "price",
                      "strength": "Light", "signals": ["step"], "reasons": [f"{z['step_pct']}% step below the {base} (no support found here)"]})
        levels.append(d)

    parts = []
    s200 = (smas.get(200) or [None])[-1]
    if s200:
        parts.append(f"Price is above its 200-day average ({_money(s200)}), a long-term uptrend." if price >= s200 else
                     f"Price is below its 200-day average ({_money(s200)}), a long-term downtrend, so wait for a level to hold before buying.")
    conf = [l for l in levels if l["source"] == "confluence"]
    if conf:
        best = max(conf, key=lambda l: l["score"])
        sh = best["short"]
        what = sh[0] if len(sh) == 1 else ", ".join(sh[:-1]) + " and " + sh[-1]
        parts.append(f"Strongest buy zone: {best['label']} at {_money(best['price'])} ({best['below_price_pct']}%), where {what} line up.")
    if intrinsic:
        gap = round((price / intrinsic - 1) * 100, 1)
        if gap > 0:
            first = next((l for l in levels if l["price"] <= intrinsic), None)
            parts.append(f"Price is {gap}% above OptiIQ Value" + (f"; {first['label']} is the first level at or below it." if first else "."))
        else:
            parts.append(f"Price is {abs(gap)}% below OptiIQ Value.")
    return {"levels": levels, "overlay": overlay, "summary": " ".join(parts)}


def register(api_router, *, db, get_user: Callable, send_push: Callable, market_open_now: Callable, logger) -> Dict[str, Callable]:
    # Own collection: older app versions still write the legacy `valuation_board` collection in this shared database with
    # their own model, which would otherwise overwrite these inputs and values.
    col = db.optiiq_board
    cache: Dict[str, Any] = {}
    instance = uuid.uuid4().hex

    async def lead() -> bool:
        """The preview and published servers share this database and the data-provider key: only one runs the daily
        company-data refresh at a time (a lease renewed per stock, free again 3 minutes after its holder stops)."""
        now = time.time()
        try:
            await db.locks.find_one_and_update({"_id": "board_refresh", "$or": [{"owner": instance}, {"until": {"$lt": now}}]},
                                               {"$set": {"owner": instance, "until": now + 180}}, upsert=True)
            return True
        except DuplicateKeyError:
            return False

    async def refresh_fundamentals(client: httpx.AsyncClient, s: Dict[str, str], price: Optional[float]) -> None:
        tk = s["ticker"]
        metrics = await market.get_metrics(client, tk)
        fins = await market.get_quarterly_financials(client, tk, 8) if metrics.get("market_cap") else []
        earnings = await market.get_earnings(client, tk) if metrics.get("market_cap") else {}
        if not price:
            price = ((await market.get_quote(client, tk)) or {}).get("price")
        doc: Dict[str, Any] = {
            "ticker": tk, "name": s["name"], "sector": s["sector"], "metrics": metrics,
            "financials": [{k: r.get(k) for k in FIN_FIELDS} for r in fins[-4:]],
            "estimates": earnings.get("estimates") or [],
            "model_v": MODEL_V,
            "fund_ts": time.time() - (FUND_TTL - RETRY_TTL if not (metrics.get("market_cap") and fins) else 0),
        }
        if price:
            doc.update(evaluate(doc, price))
            doc["price_ts"] = time.time()
        await col.update_one({"_id": tk}, {"$set": doc}, upsert=True)

    async def fundamentals_loop():
        await asyncio.sleep(45)
        while True:
            pause = 900
            try:
                now = time.time()
                # stocks saved by an older OptiIQ model are refreshed first, with the inputs the current model needs
                seen = {d["_id"]: d.get("fund_ts", 0) if is_current(d) else 0
                        async for d in col.find({}, {"fund_ts": 1, "model_v": 1, "metrics.mean_years": 1})}
                todo = sorted((s for s in SP500 if now - seen.get(s["ticker"], 0) > FUND_TTL), key=lambda s: seen.get(s["ticker"], 0))
                if todo and not await lead():
                    pause = 60  # another server (or the one this restart replaced) holds the refresh: check again soon
                elif todo:
                    async with httpx.AsyncClient() as client:
                        prices = await tradier.quotes(client, [s["ticker"] for s in todo])
                        for s in todo:
                            if not await lead():
                                break
                            while market.recent_calls("finnhub.io") > market.BACKGROUND_CAP:
                                await asyncio.sleep(2)
                            try:
                                await refresh_fundamentals(client, s, prices.get(s["ticker"]))
                            except Exception as ex:
                                logger.warning(f"board {s['ticker']}: {ex}")
                            cache.clear()
                            await asyncio.sleep(1.5)
            except Exception as ex:
                logger.warning(f"board loop: {ex}")
            await asyncio.sleep(pause)

    async def price_loop():
        await asyncio.sleep(60)
        while True:
            try:
                async with httpx.AsyncClient() as client:
                    prices = await tradier.quotes(client, [s["ticker"] for s in SP500])
                ops = [UpdateOne({"_id": d["_id"]}, {"$set": {**evaluate(d, prices[d["_id"]]), "price_ts": time.time()}})
                       async for d in col.find({"model_v": MODEL_V, "metrics.mean_years": {"$exists": True}}) if prices.get(d["_id"])]
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
            if a.get("group_id"):  # trade-plan pair: target hit closes the stop alert and vice versa
                await db.alerts.update_many({"group_id": a["group_id"], "alert_id": {"$ne": a["alert_id"]}, "active": True},
                                            {"$set": {"active": False, "closed_by": a["alert_id"]}})
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
        rows = await col.find({}, {"_id": 0, "capex_history": 0}).to_list(1000)
        for r in rows:  # recomputed from the stored inputs, so the list always matches the stock sheet
            if r.get("price") and is_current(r):
                r.update(evaluate(r, r["price"]))
            elif r.get("price"):
                r.update({"bucket": None, "reason": "Valuation is being updated"})
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
            "method": "Premium = price ÷ OptiIQ Value − 1. OptiIQ Value is the average of 9 valuation methods (cash-flow, earnings, "
                      "average-multiple and growth models), the same as Analyze → Long-term. Tap a stock to see all 9. "
                      "Banks and insurers skip the 4 cash-flow models and average the other 5. "
                      "Company numbers refresh daily, prices every 10 minutes. Research only, not investment advice.",
        }
        cache["board"] = (time.time(), out)
        return out

    return {"fundamentals_loop": fundamentals_loop, "price_loop": price_loop, "price_alert_loop": price_alert_loop,
            "check_price_alerts": check_price_alerts}
