"""Track record (live + backtest), smart 70%+ setup alerts, and level-up lessons."""
from __future__ import annotations
import math
import asyncio
import uuid
from datetime import datetime, timedelta, timezone, date
from typing import Any, Callable, Dict, List, Optional
from zoneinfo import ZoneInfo

import httpx
from fastapi import HTTPException, Header
from pydantic import BaseModel

from engine import (
    STRATEGY_META, MIN_POP_FLOOR, CREDIT_VARIANTS, payoff_exp, volatility_profile, build_idea,
    candidate_strategies,
)
from market import get_candles

NY = ZoneInfo("America/New_York")
MAX_SMART_ALERTS_PER_DAY = 3
BACKTEST_DTE_TRADING = 21  # ~30 calendar days
BACKTEST_STEP = 5
_BACKTEST: Dict[str, Any] = {"status": "pending"}


def market_open_now() -> bool:
    n = datetime.now(NY)
    if n.weekday() >= 5:
        return False
    return (n.hour, n.minute) >= (9, 30) and n.hour < 16


def _candle_date(c: Dict) -> Optional[str]:
    t = c.get("t")
    if not t:
        return None
    return datetime.fromtimestamp(t / 1000 if t > 1e11 else t, tz=timezone.utc).strftime("%Y-%m-%d")


def settle_pnl(legs: List[Dict], premium_net: float, fees: float, close: float) -> float:
    return round(payoff_exp(close, legs, premium_net) - fees, 2)


def _stats(rows: List[Dict]) -> Dict[str, Any]:
    n = len(rows)
    wins = sum(1 for r in rows if r["won"])
    return {
        "count": n, "wins": wins, "losses": n - wins,
        "win_rate": round(wins / n * 100, 1) if n else None,
        "avg_predicted_pop": round(sum(r["pop"] for r in rows) / n, 1) if n else None,
        "total_pnl": round(sum(r["pnl"] for r in rows), 2),
        "avg_pnl": round(sum(r["pnl"] for r in rows) / n, 2) if n else None,
    }


def risk_adjusted(rows: List[Dict]) -> Optional[Dict[str, Any]]:
    """Profit factor, Sharpe-style ratio, max drawdown, return on risk, expectancy (chronological order)."""
    if len(rows) < 2:
        return None
    rows = sorted(rows, key=lambda r: str(r.get("exit_date") or r.get("settled_at") or ""))
    pnl = [r["pnl"] for r in rows]
    n = len(pnl)
    mean = sum(pnl) / n
    sd = math.sqrt(sum((x - mean) ** 2 for x in pnl) / (n - 1)) or 1e-9
    downs = [x for x in pnl if x < 0]
    dsd = math.sqrt(sum(x * x for x in downs) / len(downs)) if downs else None
    gw, gl = sum(x for x in pnl if x > 0), abs(sum(downs))
    cum = peak = dd = 0.0
    for x in pnl:
        cum += x
        peak = max(peak, cum)
        dd = min(dd, cum - peak)
    risk = sum(abs(r.get("max_loss") or 0) for r in rows)
    curve, c = [], 0.0
    for x in pnl:
        c += x
        curve.append(round(c, 2))
    step = max(1, len(curve) // 80)
    curve = curve[::step] + ([curve[-1]] if (len(curve) - 1) % step else [])
    return {"profit_factor": round(gw / gl, 2) if gl else None, "sharpe": round(mean / sd, 2),
            "sortino": round(mean / dsd, 2) if dsd else None, "max_drawdown": round(dd, 2),
            "return_on_risk_pct": round(sum(pnl) / risk * 100, 2) if risk else None, "expectancy": round(mean, 2),
            "avg_win": round(gw / max(1, sum(1 for x in pnl if x > 0)), 2), "avg_loss": round(-gl / max(1, len(downs)), 2),
            "equity": curve,
            "note": "Sharpe/Sortino are per trade (mean P&L ÷ volatility of P&L), not annualized."}


CAL_BUCKETS = [(70, 75), (75, 80), (80, 85), (85, 90), (90, 95), (95, 101)]
CAL_MIN_N = 30


def accuracy(rows: List[Dict]) -> Optional[Dict[str, Any]]:
    """How well predicted POP matched reality: Brier score, calibration error, per-bucket predicted vs realized."""
    if not rows:
        return None
    brier = sum((r["pop"] / 100 - (1 if r["won"] else 0)) ** 2 for r in rows) / len(rows)
    buckets, ece = [], 0.0
    for lo, hi in CAL_BUCKETS:
        sub = [r for r in rows if lo <= r["pop"] < hi]
        if not sub:
            continue
        pred = sum(r["pop"] for r in sub) / len(sub)
        real = sum(1 for r in sub if r["won"]) / len(sub) * 100
        ece += abs(pred - real) * len(sub) / len(rows)
        buckets.append({"range": f"{lo}–{min(hi, 100)}%", "n": len(sub), "predicted": round(pred, 1), "realized": round(real, 1),
                        "gap": round(real - pred, 1), "calibrated": len(sub) >= CAL_MIN_N})
    return {"brier": round(brier, 4), "brier_baseline": 0.25, "calibration_error": round(ece, 1), "buckets": buckets,
            "verdict": "Well calibrated" if ece <= 5 else "Slightly off" if ece <= 12 else "Needs calibration",
            "note": "Brier: 0 = perfect, 0.25 = coin flip. Calibration error = average |predicted − realized| win rate."}


_CALIB: Dict[str, Any] = {}


def build_calibration(rows: List[Dict]) -> None:
    """Per-bucket realized win rate (shrunk toward the prediction) — only for buckets with ≥30 real results."""
    _CALIB.clear()
    for lo, hi in CAL_BUCKETS:
        sub = [r for r in rows if lo <= r["pop"] < hi]
        if len(sub) >= CAL_MIN_N:
            pred = sum(r["pop"] for r in sub) / len(sub)
            wins = sum(1 for r in sub if r["won"])
            _CALIB[f"{lo}-{hi}"] = {"lo": lo, "hi": hi, "n": len(sub), "rate": (wins + 5 * pred / 100) / (len(sub) + 5) * 100, "pred": pred}


def calibrate(pop: float) -> Optional[tuple]:
    for b in _CALIB.values():
        if b["lo"] <= pop < b["hi"]:
            return round(min(99.0, max(1.0, pop + (b["rate"] - b["pred"]))), 1), b["n"]
    return None


def weekly_report(rows: List[Dict], open_rows: List[Dict], weeks: int = 8) -> Dict[str, Any]:
    """Settled picks grouped by settlement week (Mon-Fri): real win rate vs the POP shown at the time
    (calibrated when calibration was on for that pick, else the model POP)."""
    by: Dict[str, List[Dict]] = {}
    for r in rows:
        if not r.get("exit_date"):
            continue
        d = date.fromisoformat(r["exit_date"])
        by.setdefault((d - timedelta(days=d.weekday())).isoformat(), []).append(r)
    out = []
    for wk in sorted(by, reverse=True)[:weeks]:
        sub = by[wk]
        n, wins = len(sub), sum(1 for r in sub if r["won"])
        shown = [r["pop_calibrated"] if r.get("pop_calibrated") is not None else r["pop"] for r in sub]
        real, cal, model = wins / n * 100, sum(shown) / n, sum(r["pop"] for r in sub) / n
        out.append({"week_of": wk, "week_end": (date.fromisoformat(wk) + timedelta(days=4)).isoformat(), "n": n, "wins": wins,
                    "in_progress": (date.fromisoformat(wk) + timedelta(days=4)) >= date.today(),
                    "realized": round(real, 1), "calibrated_pop": round(cal, 1), "model_pop": round(model, 1),
                    "calibrated_n": sum(1 for r in sub if r.get("pop_calibrated") is not None),
                    "gap": round(real - cal, 1), "gap_model": round(real - model, 1),
                    "brier": round(sum((p / 100 - (1 if r["won"] else 0)) ** 2 for p, r in zip(shown, sub)) / n, 3),
                    "pnl": round(sum(r["pnl"] for r in sub), 2)})
    soon = (date.today() + timedelta(days=7)).isoformat()
    summary = None
    if out:
        w = out[0]
        verdict = "on target" if abs(w["gap"]) <= 5 else "better than forecast" if w["gap"] > 0 else "worse than forecast"
        summary = (f"{w['n']} pick{'s' if w['n'] != 1 else ''} settled: {w['realized']:.0f}% won vs {w['calibrated_pop']:.0f}% forecast "
                   f"({'+' if w['gap'] >= 0 else ''}{w['gap']:.1f} pts, {verdict}).")
        if len(out) > 1:
            prev = out[1]
            summary += (" Closer to the forecast than the week before." if abs(w["gap"]) < abs(prev["gap"]) - 0.5 else
                        " Further from the forecast than the week before." if abs(w["gap"]) > abs(prev["gap"]) + 0.5 else
                        " About as close as the week before.")
    return {"weeks": out, "summary": summary, "settling_next_7d": sum(1 for r in open_rows if r.get("expiration", "") <= soon),
            "note": "Forecast = the POP shown when the pick was made: calibrated POP once its bucket has 30+ real results, "
                    "otherwise the model POP. Brier: 0 = perfect, 0.25 = coin flip."}


def _buckets(rows: List[Dict]) -> List[Dict]:
    out = []
    for lo, hi in ((70, 80), (80, 90), (90, 101)):
        sub = [r for r in rows if lo <= r["pop"] < hi]
        s = _stats(sub)
        out.append({"range": f"{lo}–{min(hi, 100)}%", **s})
    return out


def run_backtest(series: Dict[str, Dict[str, Any]]) -> Dict[str, Any]:
    """Re-run the engine on past daily closes: every 5 trading days, pick the best 70%+ setup
    per ticker (low-risk strategies, Reg T) and settle it ~21 trading days later at the real close."""
    trades = []
    strategies = candidate_strategies("low_low", "any")
    for tk, s in series.items():
        candles = s["candles"]
        for i in range(25, len(candles) - BACKTEST_DTE_TRADING, BACKTEST_STEP):
            hist = candles[: i + 1]
            S = hist[-1]["c"]
            vol = volatility_profile(hist)
            best = None
            for name in strategies:
                for scale in CREDIT_VARIANTS:
                    try:
                        idea = build_idea(tk, s["info"], name, S, vol, 30, "reg_t", None, None, scale)
                    except Exception:
                        continue
                    if idea["pop"] < MIN_POP_FLOOR or idea["liquidity"].get("grade") == "Low":
                        continue
                    if best is None or idea["score"] > best["score"]:
                        best = idea
            if not best:
                continue
            close = candles[i + BACKTEST_DTE_TRADING]["c"]
            pnl = settle_pnl(best["legs"], best["premium_net"], best["pricing"]["fees"], close)
            trades.append({
                "ticker": tk, "strategy": best["strategy"], "pop": best["pop"],
                "entry_date": _candle_date(hist[-1]), "exit_date": _candle_date(candles[i + BACKTEST_DTE_TRADING]),
                "entry_price": round(S, 2), "exit_price": round(close, 2),
                "strikes": [l["strike"] for l in best["legs"] if l["type"] != "Stock"],
                "premium_net": best["premium_net"], "pnl": pnl, "won": pnl > 0, "max_loss": best["max_loss"],
            })
    trades.sort(key=lambda t: t["entry_date"] or "", reverse=True)
    by_strat: Dict[str, List[Dict]] = {}
    for t in trades:
        by_strat.setdefault(t["strategy"], []).append(t)
    return {
        "status": "ready", "stats": _stats(trades), "buckets": _buckets(trades),
        "risk_adjusted": risk_adjusted(trades), "accuracy": accuracy(trades),
        "by_strategy": [{"strategy": k, **_stats(v)} for k, v in sorted(by_strat.items(), key=lambda kv: -len(kv[1]))],
        "recent": trades[:25],
        "method": ("Backtest: the same engine re-run on past daily closes. Every 5 trading days the best 70%+ POP "
                   "low-risk setup per stock (theoretical Black-Scholes prices, modeled slippage & fees) is held "
                   "~30 days and settled at the real closing price. Hypothetical — not live trades."),
        "computed_at": datetime.now(timezone.utc).isoformat(),
    }


# ---------------------------------------------------------------- lessons
LEVELS: List[Dict[str, Any]] = [
    {
        "level": 1, "title": "Level 1 · Covered calls & cash-secured puts",
        "lessons": [
            {"title": "Selling options for income", "body": "When you sell an option you collect a premium up front. In exchange you take on an obligation: to sell shares (call) or buy shares (put) at the strike if assigned."},
            {"title": "Covered call", "body": "Own 100 shares and sell a call above the price. You keep the premium; if the stock rises past the strike, your shares are sold at the strike. Upside is capped, downside is the same as owning stock minus the premium."},
            {"title": "Cash-secured put", "body": "Set aside cash to buy 100 shares and sell a put below the price. If the stock stays above the strike you keep the premium; if it falls below, you buy the shares at the strike — a planned discount entry."},
        ],
        "quiz": [
            {"q": "In a covered call you…", "options": ["Own 100 shares and sell a call", "Buy a call and a put", "Sell a call without shares"], "answer": 0, "explain": "The shares 'cover' the call obligation."},
            {"q": "Cash for a cash-secured put on a $50 strike is about…", "options": ["$50", "$500", "$5,000"], "answer": 2, "explain": "1 contract = 100 shares × $50 strike = $5,000, minus premium received."},
            {"q": "The biggest risk of a cash-secured put is…", "options": ["The stock rises a lot", "The stock falls far below the strike", "Time passes"], "answer": 1, "explain": "You must buy at the strike even if the stock has dropped much lower."},
        ],
    },
    {
        "level": 2, "title": "Level 2 · Buying calls & puts",
        "lessons": [
            {"title": "Long call / long put", "body": "Buying an option costs a premium that is your maximum loss. A call profits if the stock rises above strike + premium; a put profits if it falls below strike − premium."},
            {"title": "Time decay (theta)", "body": "Bought options lose value every day as expiration approaches. You need the move to happen fast enough to beat decay — that is why most long options expire worthless."},
            {"title": "Implied volatility", "body": "High IV makes options expensive. Buying before earnings often loses money even when you are right on direction, because IV collapses after the event (IV crush)."},
        ],
        "quiz": [
            {"q": "Max loss on a bought call is…", "options": ["Unlimited", "The premium paid", "The strike price"], "answer": 1, "explain": "You can only lose what you paid."},
            {"q": "Theta hurts…", "options": ["Option buyers", "Option sellers", "Neither"], "answer": 0, "explain": "Time decay drains the value of options you own."},
            {"q": "After earnings, implied volatility usually…", "options": ["Rises", "Drops", "Stays the same"], "answer": 1, "explain": "Uncertainty is resolved, so IV collapses — the 'IV crush'."},
        ],
    },
    {
        "level": 3, "title": "Level 3 · Spreads & iron condors",
        "lessons": [
            {"title": "Credit spreads", "body": "Sell one option and buy a further out-of-the-money one in the same expiry. You collect a smaller premium, but the bought option caps your loss at width − credit."},
            {"title": "Iron condor", "body": "A bull put spread plus a bear call spread. It profits if the stock stays between the two short strikes. Defined risk on both sides, best in calm, range-bound markets."},
            {"title": "Managing spreads", "body": "Many traders take profit at 50% of max credit and cut losses at 1.5–2× the credit. Watch for early assignment on the short leg when it is deep in the money or near ex-dividend."},
        ],
        "quiz": [
            {"q": "Max loss on a $5-wide credit spread with $1.20 credit is…", "options": ["$120", "$380", "$500"], "answer": 1, "explain": "(5 − 1.20) × 100 = $380."},
            {"q": "An iron condor profits most when the stock…", "options": ["Moves sharply", "Stays between the short strikes", "Gaps after earnings"], "answer": 1, "explain": "It is a neutral, range-bound strategy."},
            {"q": "Why buy the further OTM leg in a credit spread?", "options": ["To cap the maximum loss", "To increase the credit", "To avoid fees"], "answer": 0, "explain": "The long leg defines and limits risk."},
        ],
    },
    {
        "level": 4, "title": "Full access · Naked selling",
        "lessons": [
            {"title": "Naked puts & calls", "body": "Selling an option without shares or a protective leg. A naked put can lose almost the full strike value; a naked call has unlimited loss because a stock can keep rising."},
            {"title": "Margin requirements", "body": "Reg T margin for naked options is roughly 20% of the stock price minus the out-of-the-money amount plus the premium. A sharp move raises the requirement and can trigger a margin call."},
            {"title": "Position sizing & tail risk", "body": "High-probability naked trades win often but can lose many months of gains in one gap. Keep size small, avoid earnings, and always have an exit plan."},
        ],
        "quiz": [
            {"q": "Maximum loss on a naked call is…", "options": ["The premium", "Limited to the strike", "Unlimited"], "answer": 2, "explain": "There is no ceiling on how high a stock can go."},
            {"q": "Naked options are allowed in…", "options": ["Cash and IRA accounts", "Margin accounts with full approval", "Any account"], "answer": 1, "explain": "They need margin and the highest approval level."},
            {"q": "A 90% POP naked trade means…", "options": ["You can't lose", "You win often but losses can be large", "Profit is guaranteed at 90%"], "answer": 1, "explain": "Probability doesn't limit the size of the losing trades."},
        ],
    },
]
LEVEL_BY_NUM = {l["level"]: l for l in LEVELS}


class QuizReq(BaseModel):
    answers: List[int]


def register(api_router, *, db, get_user: Callable, user_defaults: Callable, scan_for_user: Callable,
             send_push: Callable, universe: List[Dict], universe_index: Dict, logger, ticker_snapshot: Callable):

    # ------------------------------------------------ track record
    async def log_picks(results: List[Dict], profile: str):
        for r in results:
            strikes = "-".join(str(l["strike"]) for l in r["legs"])
            key = f"{r['ticker']}|{r['strategy']}|{r['expiration']}|{strikes}"
            doc = {
                "pick_id": f"pick_{uuid.uuid4().hex[:12]}", "key": key, "ticker": r["ticker"], "strategy": r["strategy"],
                "legs": [{k: l[k] for k in ("action", "type", "strike", "qty")} for l in r["legs"]],
                "premium_net": r["premium_net"], "fees": r["pricing"]["fees"], "entry_price": r["price"],
                "pop": r["pop"], "pop_calibrated": r.get("pop_calibrated"),
                "max_profit": r["max_profit"], "max_loss": r["max_loss"], "profile": profile,
                "expiration": r["expiration"], "dte": r["expiration_days"], "status": "open",
                "created_at": datetime.now(timezone.utc),
            }
            try:
                await db.picks.update_one({"key": key}, {"$setOnInsert": doc}, upsert=True)
            except Exception as ex:
                logger.warning(f"log pick failed: {ex}")

    async def settle_open_picks():
        today = date.today().isoformat()
        rows = await db.picks.find({"status": "open", "expiration": {"$lt": today}}, {"_id": 0}).to_list(500)
        if not rows:
            return 0
        n = 0
        async with httpx.AsyncClient() as client:
            for p in rows:
                candles = await get_candles(client, p["ticker"], 120)
                eligible = [c for c in candles if (_candle_date(c) or "9999") <= p["expiration"]]
                if not eligible or _candle_date(eligible[-1]) is None:
                    continue
                close = eligible[-1]["c"]
                pnl = settle_pnl(p["legs"], p["premium_net"], p["fees"], close)
                await db.picks.update_one({"key": p["key"]}, {"$set": {
                    "status": "settled", "exit_price": round(close, 2), "exit_date": _candle_date(eligible[-1]),
                    "pnl": pnl, "won": pnl > 0, "settled_at": datetime.now(timezone.utc)}})
                n += 1
        return n

    async def compute_backtest():
        series = {}
        async with httpx.AsyncClient() as client:
            for s in universe:
                c = await get_candles(client, s["ticker"], 250)
                if len(c) >= 50:
                    series[s["ticker"]] = {"candles": c, "info": s}
        if not series:
            _BACKTEST.update({"status": "pending"})
            return
        res = await asyncio.to_thread(run_backtest, series)
        _BACKTEST.clear()
        _BACKTEST.update(res)
        _BACKTEST["tickers"] = len(series)

    async def track_loop():
        await asyncio.sleep(90)  # let the candle cache warm up first
        while True:
            try:
                await settle_open_picks()
                build_calibration(await db.picks.find({"status": "settled"}, {"_id": 0, "pop": 1, "won": 1}).to_list(20000))
                await compute_backtest()
            except Exception as ex:
                logger.warning(f"track loop: {ex}")
            await asyncio.sleep(6 * 3600 if _BACKTEST.get("status") == "ready" and _BACKTEST.get("tickers", 0) >= 0.9 * len(universe) else 600)

    @api_router.get("/track-record")
    async def track_record(authorization: Optional[str] = Header(default=None)):
        await get_user(authorization)
        settled = await db.picks.find({"status": "settled"}, {"_id": 0, "key": 0}).sort("settled_at", -1).to_list(500)
        open_rows = await db.picks.find({"status": "open"}, {"_id": 0, "key": 0}).sort("created_at", -1).to_list(50)
        weekly = weekly_report(settled, await db.picks.find({"status": "open"}, {"_id": 0, "expiration": 1}).to_list(5000))
        for r in settled + open_rows:
            for k in ("created_at", "settled_at"):
                if isinstance(r.get(k), datetime):
                    r[k] = r[k].isoformat()
        open_count = await db.picks.count_documents({"status": "open"})
        return {
            "live": {"stats": _stats(settled), "buckets": _buckets(settled), "settled": settled[:30],
                     "risk_adjusted": risk_adjusted(settled), "accuracy": accuracy(settled),
                     "calibration": {"active": bool(_CALIB), "min_results_per_bucket": CAL_MIN_N,
                                     "buckets": [{"range": f"{b['lo']}–{min(b['hi'], 100)}%", "n": b["n"], "adjust_pts": round(b["rate"] - b["pred"], 1)}
                                                 for b in _CALIB.values()],
                                     "progress": [{"range": f"{lo}–{min(hi, 100)}%", "n": sum(1 for r in settled if lo <= r["pop"] < hi)}
                                                  for lo, hi in CAL_BUCKETS]},
                     "open": open_rows, "open_count": open_count, "weekly": weekly,
                     "method": "Every pick shown on Discover is logged with its exact strikes and premium, then settled at the real closing price on expiration day. Losses included."},
            "backtest": _BACKTEST,
        }

    # ------------------------------------------------ smart alerts
    async def smart_check_user(user: Dict, alert: Dict, force: bool = False) -> List[Dict]:
        uid = user["user_id"]
        start = datetime.now(NY).replace(hour=0, minute=0, second=0, microsecond=0).astimezone(timezone.utc)
        sent_today = await db.alert_events.count_documents({"user_id": uid, "kind": "smart_setup", "created_at": {"$gte": start}})
        if sent_today >= MAX_SMART_ALERTS_PER_DAY:
            return []
        profile = alert.get("note") or "low_low"
        out = await scan_for_user(user, profile)
        new = []
        since = datetime.now(timezone.utc) - timedelta(hours=24)
        for r in out.get("results", []):
            if sent_today + len(new) >= MAX_SMART_ALERTS_PER_DAY:
                break
            key = f"{r['ticker']}|{r['strategy']}|{r['expiration']}"
            if await db.alert_events.find_one({"user_id": uid, "key": key, "created_at": {"$gte": since}}):
                continue
            ev = {
                "event_id": f"evt_{uuid.uuid4().hex[:12]}", "user_id": uid, "key": key, "kind": "smart_setup",
                "ticker": r["ticker"], "strategy": r["strategy"], "pop": r["pop"], "roc_pct": r["roc_pct"],
                "expiration_days": r["expiration_days"],
                "title": f"New {r['pop']:.0f}% POP setup: {r['ticker']}",
                "message": f"{r['strategy']} · {r['expiration_days']}d · ROC {r['roc_pct'] if r['roc_pct'] is not None else '∞'}%",
                "created_at": datetime.now(timezone.utc), "read": False,
            }
            await db.alert_events.insert_one(ev)
            ev.pop("_id", None)
            new.append(ev)
            try:
                await send_push(recipients=[uid], data={"title": ev["title"], "message": ev["message"],
                                                        "action_url": f"/(tabs)/analyze?ticker={r['ticker']}"})
            except Exception as ex:
                logger.info(f"smart push skipped: {ex}")
        return new

    async def smart_loop():
        await asyncio.sleep(120)
        while True:
            try:
                if market_open_now():
                    alerts = await db.alerts.find({"kind": "smart_setup", "active": True}, {"_id": 0}).to_list(1000)
                    for a in alerts:
                        user = await db.users.find_one({"user_id": a["user_id"]}, {"_id": 0, "password": 0})
                        if user:
                            await smart_check_user(user, a)
            except Exception as ex:
                logger.warning(f"smart loop: {ex}")
            await asyncio.sleep(30 * 60)

    @api_router.get("/alerts/feed")
    async def alerts_feed(authorization: Optional[str] = Header(default=None)):
        user = await get_user(authorization)
        rows = await db.alert_events.find({"user_id": user["user_id"]}, {"_id": 0, "user_id": 0, "key": 0}).sort("created_at", -1).to_list(50)
        for r in rows:
            if isinstance(r.get("created_at"), datetime):
                r["created_at"] = r["created_at"].isoformat()
        return {"items": rows, "max_per_day": MAX_SMART_ALERTS_PER_DAY, "market_open": market_open_now()}

    @api_router.post("/alerts/smart/check")
    async def alerts_smart_check(authorization: Optional[str] = Header(default=None)):
        """Run the smart-setup check now (ignores market hours, still max 3/day)."""
        user = await get_user(authorization)
        a = await db.alerts.find_one({"user_id": user["user_id"], "kind": "smart_setup", "active": True}, {"_id": 0})
        if not a:
            raise HTTPException(status_code=400, detail="Turn on a '70%+ setups' alert first")
        new = await smart_check_user(user, a, force=True)
        for e in new:
            e.pop("user_id", None)
            e.pop("key", None)
            e["created_at"] = e["created_at"].isoformat()
        return {"new": new}

    # ------------------------------------------------ lessons
    @api_router.get("/learn/levels")
    async def learn_levels(authorization: Optional[str] = Header(default=None)):
        user = await get_user(authorization)
        lvl = user_defaults(user)["options_level"]
        prog = {p["level"]: p for p in await db.lesson_progress.find({"user_id": user["user_id"]}, {"_id": 0}).to_list(10)}
        out = []
        for L in LEVELS:
            p = prog.get(L["level"], {})
            out.append({
                "level": L["level"], "title": L["title"], "lesson_count": len(L["lessons"]),
                "unlocked_for_trading": L["level"] <= lvl, "passed": bool(p.get("passed")),
                "best_score": p.get("best_score", 0), "quiz_len": len(L["quiz"]),
            })
        return {"levels": out, "options_level": lvl,
                "note": "Lessons don't change your options level — that comes from your broker approval and questionnaire."}

    @api_router.get("/learn/levels/{level}")
    async def learn_level(level: int, authorization: Optional[str] = Header(default=None)):
        await get_user(authorization)
        L = LEVEL_BY_NUM.get(level)
        if not L:
            raise HTTPException(status_code=404, detail="Unknown level")
        return {"level": level, "title": L["title"], "lessons": L["lessons"],
                "quiz": [{"q": q["q"], "options": q["options"]} for q in L["quiz"]]}

    @api_router.post("/learn/levels/{level}/quiz")
    async def learn_quiz(level: int, req: QuizReq, authorization: Optional[str] = Header(default=None)):
        user = await get_user(authorization)
        L = LEVEL_BY_NUM.get(level)
        if not L:
            raise HTTPException(status_code=404, detail="Unknown level")
        if len(req.answers) != len(L["quiz"]):
            raise HTTPException(status_code=400, detail=f"Expected {len(L['quiz'])} answers")
        results = [{"correct": a == q["answer"], "answer": q["answer"], "explain": q["explain"]} for a, q in zip(req.answers, L["quiz"])]
        score = sum(1 for r in results if r["correct"])
        passed = score == len(L["quiz"])
        prev = await db.lesson_progress.find_one({"user_id": user["user_id"], "level": level}, {"_id": 0}) or {}
        await db.lesson_progress.update_one(
            {"user_id": user["user_id"], "level": level},
            {"$set": {"best_score": max(score, prev.get("best_score", 0)), "passed": passed or bool(prev.get("passed")),
                      "updated_at": datetime.now(timezone.utc)}},
            upsert=True,
        )
        return {"score": score, "total": len(L["quiz"]), "passed": passed, "results": results}

    return {"log_picks": log_picks, "track_loop": track_loop, "smart_loop": smart_loop, "calibrate": calibrate}
