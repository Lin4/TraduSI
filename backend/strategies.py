"""Saved strategies (live P&L marks), profit-target / stop-loss alerts, and admin plan switching."""
from __future__ import annotations
import asyncio
import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Any, Callable, Dict, List, Literal, Optional

import httpx
from fastapi import Header, HTTPException
from pydantic import BaseModel, Field, field_validator

import tradier
from chain import LegIn, _tk, _exp, analyze_position, prepare_legs
from engine import RISK_FREE, FEE_PER_CONTRACT
from options_math import bs_greeks

PLANS = ("free", "simple", "advance", "expert")


class Threshold(BaseModel):
    mode: Literal["usd", "pct"]
    value: float = Field(gt=0, le=1e7)


class Invalidation(BaseModel):
    below: Optional[float] = Field(default=None, gt=0, le=1e6, allow_inf_nan=False)
    above: Optional[float] = Field(default=None, gt=0, le=1e6, allow_inf_nan=False)


class SaveStrategyReq(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    ticker: str = Field(min_length=1, max_length=10)
    expiration: str
    legs: List[LegIn] = Field(min_length=1, max_length=8)
    target: Optional[Threshold] = None
    stop: Optional[Threshold] = None
    strategy_type: Optional[str] = Field(default=None, max_length=40)  # template name when built from one
    # one-tap trade plan: the plan's time exit and the stock levels that invalidate it also alert
    time_exit: Optional[str] = None
    invalidation: Optional[Invalidation] = None
    source: Optional[Literal["trade_plan", "chain"]] = None

    @field_validator("time_exit")
    @classmethod
    def _date(cls, v: Optional[str]) -> Optional[str]:
        if v is not None:
            date.fromisoformat(v)
        return v


class UpdateStrategyReq(BaseModel):
    target: Optional[Threshold] = None
    stop: Optional[Threshold] = None


class ArchiveReq(BaseModel):
    archived: bool = True


class RollReq(BaseModel):
    expiration: str
    confirm: bool = False


class AdminPlanReq(BaseModel):
    plan: Literal["free", "simple", "advance", "expert"]


def threshold_usd(t: Optional[Dict], base: Optional[float]) -> Optional[float]:
    """Threshold in dollars; pct is relative to max profit (target) or max risk (stop)."""
    if not t:
        return None
    return round(t["value"], 2) if t["mode"] == "usd" else round(abs(base or 0) * t["value"] / 100, 2) or None


def classify(legs: List[Dict]) -> str:
    """Name a position from its leg structure (used for History insights)."""
    opts = [l for l in legs if l["type"] != "Stock"]
    stock = len(opts) != len(legs)
    exps = {l["expiration"] for l in opts}
    if stock:
        return "Covered Call" if len(opts) == 1 and opts[0]["type"] == "Call" and opts[0]["action"] == "Sell" else "Stock + Options"
    if len(opts) == 1:
        o = opts[0]
        if o["action"] == "Sell" and o["type"] == "Put":
            return "Cash Secured Put"
        return f"{'Long' if o['action'] == 'Buy' else 'Short'} {o['type']}"
    if len(opts) == 2:
        a, b = opts
        if a["type"] == b["type"] and a["action"] != b["action"]:
            if len(exps) == 2:
                return f"{'Calendar' if a['strike'] == b['strike'] else 'Diagonal'} {a['type']} Spread"
            buy = a if a["action"] == "Buy" else b
            sell = b if buy is a else a
            if a["type"] == "Call":
                return "Bull Call Spread" if buy["strike"] < sell["strike"] else "Bear Call Spread"
            return "Bear Put Spread" if buy["strike"] > sell["strike"] else "Bull Put Spread"
        if a["type"] != b["type"] and a["action"] == b["action"]:
            kind = "Straddle" if a["strike"] == b["strike"] else "Strangle"
            return f"{'Long' if a['action'] == 'Buy' else 'Short'} {kind}"
    types = [l["type"] for l in opts]
    if len(opts) == 4 and types.count("Call") == 2 and len(exps) == 1:
        shorts = {l["strike"] for l in opts if l["action"] == "Sell"}
        return "Iron Butterfly" if len(shorts) == 1 else "Iron Condor"
    if len(set(types)) == 1 and sum(l["qty"] for l in opts) == 4 and len(opts) == 3:
        return f"Long {types[0]} Butterfly"
    return "Custom"


def trade_stats(rows: List[Dict]) -> Dict[str, Any]:
    pnl = [r.get("final_pnl") or 0 for r in rows]
    wins = [p for p in pnl if p > 0]
    losses = [p for p in pnl if p <= 0]
    best = max(rows, key=lambda r: r.get("final_pnl") or 0)
    worst = min(rows, key=lambda r: r.get("final_pnl") or 0)
    pick = lambda r: {"strategy_id": r["strategy_id"], "name": r["name"], "ticker": r["ticker"], "pnl": r.get("final_pnl")}
    return {"count": len(rows), "wins": len(wins), "win_rate": round(len(wins) / len(rows) * 100, 1),
            "avg_pnl": round(sum(pnl) / len(pnl), 2), "avg_win": round(sum(wins) / len(wins), 2) if wins else None,
            "avg_loss": round(sum(losses) / len(losses), 2) if losses else None, "total": round(sum(pnl), 2),
            "best": pick(best), "worst": pick(worst)}


def history_insights(closed: List[Dict]) -> Optional[Dict[str, Any]]:
    if not closed:
        return None
    groups: Dict[str, List[Dict]] = {}
    for r in closed:
        groups.setdefault(r["strategy_type"], []).append(r)
    by_type = [{"type": t, **trade_stats(rs)} for t, rs in groups.items()]
    by_type.sort(key=lambda x: (-x["count"], -x["total"]))
    return {"overall": trade_stats(closed), "by_type": by_type}


def _iso(d: Dict) -> Dict:
    for k, v in list(d.items()):
        if isinstance(v, datetime):
            d[k] = v.isoformat()
    return d


def register(api_router, *, db, get_user: Callable, get_quote: Callable, send_push: Callable, logger, market_open_now: Callable):

    async def mark(client, s: Dict) -> Dict[str, Any]:
        """Live mark: each leg at its chain mid (intrinsic if expired, model if unquoted)."""
        q = await get_quote(client, s["ticker"])
        S = float((q or {}).get("price") or 0)
        if not S:
            return {"error": "No live quote"}
        today = date.today()
        chains: Dict[str, Any] = {}
        value, live = 0.0, True
        for l in s["legs"]:
            sg, qty = (1 if l["action"] == "Buy" else -1), l["qty"]
            if l["type"] == "Stock":
                value += sg * qty * S
                continue
            left = (date.fromisoformat(l["expiration"]) - today).days
            K = l["strike"]
            if left < 0:
                px = max(S - K, 0) if l["type"] == "Call" else max(K - S, 0)
            else:
                if l["expiration"] not in chains:
                    chains[l["expiration"]] = await tradier.chain_for(client, s["ticker"], l["expiration"], S)
                c = chains[l["expiration"]]
                o = ((c or {}).get("calls" if l["type"] == "Call" else "puts") or {}).get(float(K)) or {}
                bid, ask = o.get("bid") or 0, o.get("ask") or 0
                if ask > 0:
                    px = (bid + ask) / 2
                else:
                    live = False
                    px = bs_greeks(S, K, max(left, 0.5) / 365, l.get("iv") or 0.3, r=RISK_FREE, call=l["type"] == "Call")["price"]
            value += sg * qty * px
        pnl = round((value - s["entry_value"]) * 100 - s["fees"] + (s.get("realized_pnl") or 0), 2)
        tgt = threshold_usd(s.get("target"), s.get("max_profit") if s.get("max_profit") is not None else s["cost_basis"])
        stp = threshold_usd(s.get("stop"), s.get("max_loss") if s.get("max_loss") is not None else s["cost_basis"])
        risk = abs(s["max_loss"]) if s.get("max_loss") else abs(s["cost_basis"]) or None
        return {"price": round(S, 2), "pnl": pnl, "pnl_pct": round(pnl / risk * 100, 1) if risk else None,
                "market_value": round(value * 100, 2), "live": live, "target_usd": tgt, "stop_usd": stp,
                "as_of": datetime.now(timezone.utc).isoformat()}

    async def record(s: Dict, m: Dict) -> None:
        """One P&L point per calendar day (last mark of the day wins)."""
        if "pnl" in m:
            day = date.today().isoformat()
            s.setdefault("history", {})[day] = m["pnl"]
            await db.strategies.update_one({"strategy_id": s["strategy_id"]}, {"$set": {f"history.{day}": m["pnl"]}})

    async def own(sid: str, user: Dict) -> Dict:
        s = await db.strategies.find_one({"strategy_id": sid, "user_id": user["user_id"]}, {"_id": 0})
        if not s:
            raise HTTPException(status_code=404, detail="Strategy not found")
        return s

    def fill(o: Dict, buy: bool) -> Optional[float]:
        """Realistic fill: buying pays the ask, selling receives the bid."""
        px = o.get("ask") if buy else o.get("bid")
        return float(px) if px and px > 0 else None

    async def close_px(client, tk: str, l: Dict, S: float, chains: Dict) -> Dict[str, Any]:
        """Price to exit one leg: Buy legs sell at bid, Sell legs buy back at ask; intrinsic if expired."""
        if l["type"] == "Stock":
            return {"px": S, "fee": 0.0, "live": True}
        left = (date.fromisoformat(l["expiration"]) - date.today()).days
        K = l["strike"]
        if left < 0:
            return {"px": max(S - K, 0) if l["type"] == "Call" else max(K - S, 0), "fee": 0.0, "live": True}
        if l["expiration"] not in chains:
            chains[l["expiration"]] = await tradier.chain_for(client, tk, l["expiration"], S)
        o = ((chains[l["expiration"]] or {}).get("calls" if l["type"] == "Call" else "puts") or {}).get(float(K)) or {}
        px = fill(o, buy=l["action"] == "Sell")
        live = px is not None
        if px is None:
            px = bs_greeks(S, K, max(left, 0.5) / 365, l.get("iv") or 0.3, r=RISK_FREE, call=l["type"] == "Call")["price"]
        return {"px": round(px, 2), "fee": round(l["qty"] * FEE_PER_CONTRACT, 2), "live": live}

    async def check_hits(s: Dict, m: Dict) -> List[Dict]:
        if "pnl" not in m or s.get("status") != "open":
            return []
        fired = s.get("fired") or {}
        hits = []
        if m["target_usd"] and m["pnl"] >= m["target_usd"] and not fired.get("target"):
            hits.append(("target", f"🎯 Profit target hit: {s['name']}", f"{s['ticker']} P&L +${m['pnl']:,.0f} (target ${m['target_usd']:,.0f})"))
        if m["stop_usd"] and m["pnl"] <= -m["stop_usd"] and not fired.get("stop"):
            hits.append(("stop", f"🛑 Stop loss hit: {s['name']}", f"{s['ticker']} P&L -${abs(m['pnl']):,.0f} (stop -${m['stop_usd']:,.0f})"))
        pnl_txt = f"P&L {'+' if m['pnl'] >= 0 else '-'}${abs(m['pnl']):,.0f}"
        if s.get("time_exit") and date.today().isoformat() >= s["time_exit"] and not fired.get("time"):
            hits.append(("time", f"⏰ Time to close: {s['name']}", f"Your plan exits {s['ticker']} by {s['time_exit']} · {pnl_txt}"))
        inv, px = s.get("invalidation") or {}, m.get("price")
        if px and not fired.get("invalid"):
            if inv.get("below") and px <= inv["below"]:
                hits.append(("invalid", f"⚠️ Plan invalidated: {s['name']}", f"{s['ticker']} at ${px:,.2f}, below ${inv['below']:,.2f} · {pnl_txt}"))
            elif inv.get("above") and px >= inv["above"]:
                hits.append(("invalid", f"⚠️ Plan invalidated: {s['name']}", f"{s['ticker']} at ${px:,.2f}, above ${inv['above']:,.2f} · {pnl_txt}"))
        out = []
        for kind, title, msg in hits:
            ev = {"event_id": f"evt_{uuid.uuid4().hex[:12]}", "user_id": s["user_id"], "key": f"{s['strategy_id']}|{kind}",
                  "kind": f"strategy_{kind}", "ticker": s["ticker"], "strategy_id": s["strategy_id"], "strategy": s["name"],
                  "pnl": m["pnl"], "title": title, "message": msg, "created_at": datetime.now(timezone.utc), "read": False}
            await db.alert_events.insert_one(ev)
            await db.strategies.update_one({"strategy_id": s["strategy_id"]}, {"$set": {f"fired.{kind}": True}})
            s.setdefault("fired", {})[kind] = True
            ev.pop("_id", None)
            out.append(ev)
            try:
                await send_push(recipients=[s["user_id"]], data={"title": title, "message": msg, "action_url": "/(tabs)/portfolio"})
            except Exception as ex:
                logger.info(f"strategy push skipped: {ex}")
        return out

    async def strategy_loop():
        await asyncio.sleep(150)
        while True:
            try:
                if market_open_now():
                    rows = await db.strategies.find({"status": "open", "$or": [{k: {"$ne": None}} for k in ("target", "stop", "time_exit", "invalidation")]},
                                                    {"_id": 0}).to_list(2000)
                    async with httpx.AsyncClient() as client:
                        for s in rows:
                            m = await mark(client, s)
                            await db.strategies.update_one({"strategy_id": s["strategy_id"]}, {"$set": {"last_mark": m}})
                            await record(s, m)
                            await check_hits(s, m)
            except Exception as ex:
                logger.warning(f"strategy loop: {ex}")
            await asyncio.sleep(5 * 60)

    # ------------------------------------------------ strategies
    @api_router.post("/strategies")
    async def save_strategy(req: SaveStrategyReq, authorization: Optional[str] = Header(default=None)):
        user = await get_user(authorization)
        tk = _tk(req.ticker)
        if all(l.type == "Stock" for l in req.legs):
            raise HTTPException(status_code=400, detail="Add at least one option leg")
        async with httpx.AsyncClient() as client:
            q = await get_quote(client, tk)
            S = float((q or {}).get("price") or 0)
            if not S:
                raise HTTPException(status_code=404, detail=f"No live quote found for {tk}")
            legs = await prepare_legs(client, tk, [l.model_dump() for l in req.legs], req.expiration, S)
        a = analyze_position([dict(l) for l in legs], S)
        doc = {
            "strategy_id": f"strat_{uuid.uuid4().hex[:12]}", "user_id": user["user_id"], "name": req.name.strip(), "ticker": tk,
            "legs": [{k: l[k] for k in ("action", "type", "strike", "qty", "price", "iv", "expiration")} for l in legs],
            "entry_value": sum((1 if l["action"] == "Buy" else -1) * l["qty"] * l["price"] for l in legs),
            "entry_underlying": round(S, 2), "cost_basis": a["cost_basis"], "net_premium": a["net_premium"],
            "premium_type": a["premium_type"], "fees": a["fees"], "max_profit": a["max_profit"], "max_loss": a["max_loss"],
            "pop": a["pop"], "breakevens": a["breakevens"], "multi_expiry": a["multi_expiry"],
            "expiration": min(l["expiration"] for l in legs if l["type"] != "Stock"),
            "target": req.target.model_dump() if req.target else None, "stop": req.stop.model_dump() if req.stop else None,
            "strategy_type": req.strategy_type or classify([l.model_dump() for l in req.legs]),
            "time_exit": req.time_exit, "invalidation": req.invalidation.model_dump() if req.invalidation else None, "source": req.source,
            "fired": {}, "status": "open", "realized_pnl": 0.0, "rolls": [], "history": {},
            "created_at": datetime.now(timezone.utc),
        }
        await db.strategies.insert_one(doc)
        doc.pop("_id", None)
        return _iso(doc)

    @api_router.get("/strategies")
    async def list_strategies(authorization: Optional[str] = Header(default=None)):
        user = await get_user(authorization)
        rows = await db.strategies.find({"user_id": user["user_id"]}, {"_id": 0}).sort("created_at", -1).to_list(200)
        open_rows = [r for r in rows if r.get("status") == "open"]
        closed = sorted([r for r in rows if r.get("status") == "closed"], key=lambda r: r.get("closed_at") or r["created_at"], reverse=True)
        async with httpx.AsyncClient() as client:
            marks = await asyncio.gather(*[mark(client, s) for s in open_rows], return_exceptions=True)
        new_events = []
        for s, m in zip(open_rows, marks):
            s["mark"] = m if isinstance(m, dict) else {"error": "Mark unavailable"}
            await record(s, s["mark"])
            new_events += await check_hits(s, s["mark"])
        for s in rows:
            s["history"] = [{"date": d, "pnl": v} for d, v in sorted((s.get("history") or {}).items())]
            s["strategy_type"] = s.get("strategy_type") or classify(s["legs"])
            _iso(s)
        active = [r for r in closed if not r.get("archived")]
        return {"items": open_rows, "closed": active[:100], "archived": [r for r in closed if r.get("archived")][:100],
                "total_pnl": round(sum(s["mark"].get("pnl", 0) for s in open_rows), 2),
                "realized_total": round(sum(s.get("final_pnl") or 0 for s in closed), 2),
                "insights": history_insights(closed), "new_alerts": len(new_events)}

    @api_router.post("/strategies/{sid}/archive")
    async def archive_strategy(sid: str, req: ArchiveReq, authorization: Optional[str] = Header(default=None)):
        user = await get_user(authorization)
        s = await own(sid, user)
        if s.get("status") != "closed":
            raise HTTPException(status_code=400, detail="Only closed trades can be archived")
        await db.strategies.update_one({"strategy_id": sid}, {"$set": {"archived": req.archived}})
        return {"ok": True, "archived": req.archived}

    @api_router.post("/strategies/{sid}/close")
    async def close_strategy(sid: str, authorization: Optional[str] = Header(default=None)):
        user = await get_user(authorization)
        s = await own(sid, user)
        if s.get("status") != "open":
            raise HTTPException(status_code=400, detail="Strategy already closed")
        async with httpx.AsyncClient() as client:
            q = await get_quote(client, s["ticker"])
            S = float((q or {}).get("price") or 0)
            if not S:
                raise HTTPException(status_code=404, detail="No live quote")
            chains: Dict[str, Any] = {}
            exits = [await close_px(client, s["ticker"], l, S, chains) for l in s["legs"]]
        exit_value = sum((1 if l["action"] == "Buy" else -1) * l["qty"] * e["px"] for l, e in zip(s["legs"], exits))
        exit_fees = round(sum(e["fee"] for e in exits), 2)
        final = round((exit_value - s["entry_value"]) * 100 - s["fees"] - exit_fees + (s.get("realized_pnl") or 0), 2)
        day = date.today().isoformat()
        upd = {"status": "closed", "closed_at": datetime.now(timezone.utc), "final_pnl": final, "exit_underlying": round(S, 2),
               "exit_fees": exit_fees, "exit_live": all(e["live"] for e in exits),
               "exit_legs": [{**{k: l[k] for k in ("action", "type", "strike", "qty", "expiration")}, "exit_price": e["px"]}
                             for l, e in zip(s["legs"], exits)],
               f"history.{day}": final}
        await db.strategies.update_one({"strategy_id": sid}, {"$set": upd})
        return {"ok": True, "final_pnl": final, "exit_fees": exit_fees, "exit_live": upd["exit_live"], "exit_legs": upd["exit_legs"]}

    @api_router.post("/strategies/{sid}/roll")
    async def roll_strategy(sid: str, req: RollReq, authorization: Optional[str] = Header(default=None)):
        """Roll the soonest-expiring option legs to a later listed expiration at live fills. confirm=false -> preview."""
        user = await get_user(authorization)
        s = await own(sid, user)
        if s.get("status") != "open":
            raise HTTPException(status_code=400, detail="Only open strategies can be rolled")
        new_d = _exp(req.expiration)
        opts = [l for l in s["legs"] if l["type"] != "Stock"]
        near = min(l["expiration"] for l in opts)
        if new_d <= date.fromisoformat(near):
            raise HTTPException(status_code=400, detail="Pick an expiration later than the current one")
        async with httpx.AsyncClient() as client:
            q = await get_quote(client, s["ticker"])
            S = float((q or {}).get("price") or 0)
            if not S:
                raise HTTPException(status_code=404, detail="No live quote")
            if req.expiration not in await tradier.expirations(client, s["ticker"]):
                raise HTTPException(status_code=400, detail="Expiration is not listed")
            nc = await tradier.chain_for(client, s["ticker"], req.expiration, S)
            if not nc:
                raise HTTPException(status_code=502, detail="Live chain unavailable for that expiration")
            chains: Dict[str, Any] = {}
            out_legs, in_legs = [], []
            for l in s["legs"]:
                if l["type"] == "Stock" or l["expiration"] != near:
                    continue
                e = await close_px(client, s["ticker"], l, S, chains)
                side = nc["calls"] if l["type"] == "Call" else nc["puts"]
                ks = [k for k, o in side.items() if fill(o, buy=l["action"] == "Buy")]
                if not ks:
                    raise HTTPException(status_code=502, detail=f"No quotes for {l['type']}s on {req.expiration}")
                k = min(ks, key=lambda x: abs(x - l["strike"]))
                o = side[k]
                g = o.get("greeks") or {}
                out_legs.append({**l, "exit_price": e["px"], "exit_fee": e["fee"], "live": e["live"]})
                in_legs.append({"action": l["action"], "type": l["type"], "strike": k, "qty": l["qty"], "expiration": req.expiration,
                                "price": round(fill(o, buy=l["action"] == "Buy"), 2), "iv": g.get("mid_iv") or g.get("smv_vol") or l.get("iv")})
        sg = lambda l: (1 if l["action"] == "Buy" else -1) * l["qty"]
        close_cash = sum(sg(l) * l["exit_price"] for l in out_legs) * 100     # + received when closing longs
        open_cash = -sum(sg(l) * l["price"] for l in in_legs) * 100           # + received when opening shorts
        fees = round(sum(l["exit_fee"] for l in out_legs) + sum(l["qty"] for l in in_legs) * FEE_PER_CONTRACT, 2)
        realized = round(close_cash - sum(sg(l) * l["price"] for l in out_legs) * 100 - fees, 2)
        preview = {"from": near, "to": req.expiration, "closing": [{k: l[k] for k in ("action", "type", "strike", "qty", "expiration", "price", "exit_price")} for l in out_legs],
                   "opening": in_legs, "net": round(close_cash + open_cash, 2), "net_type": "credit" if close_cash + open_cash >= 0 else "debit",
                   "fees": fees, "realized_pnl": realized, "live": all(l["live"] for l in out_legs)}
        if not req.confirm:
            return {"preview": preview}
        keep = [l for l in s["legs"] if l["type"] == "Stock" or l["expiration"] != near]
        legs = keep + in_legs
        prepared = [{**l, "dte": max((date.fromisoformat(l["expiration"]) - date.today()).days, 0), "iv": l.get("iv") or 0.3} for l in legs]
        a = analyze_position([dict(l) for l in prepared], S)
        entry_value = sum(sg(l) * l["price"] for l in legs)
        upd = {"legs": legs, "entry_value": entry_value, "realized_pnl": round((s.get("realized_pnl") or 0) + realized, 2),
               "max_profit": a["max_profit"], "max_loss": a["max_loss"], "breakevens": a["breakevens"], "pop": a["pop"],
               "multi_expiry": a["multi_expiry"], "cost_basis": a["cost_basis"],
               "expiration": min(l["expiration"] for l in legs if l["type"] != "Stock"), "fired": {}}
        await db.strategies.update_one({"strategy_id": sid}, {"$set": upd, "$push": {"rolls": {**preview, "at": datetime.now(timezone.utc)}}})
        return {"ok": True, "preview": preview}

    @api_router.patch("/strategies/{sid}")
    async def update_strategy(sid: str, req: UpdateStrategyReq, authorization: Optional[str] = Header(default=None)):
        user = await get_user(authorization)
        r = await db.strategies.update_one(
            {"strategy_id": sid, "user_id": user["user_id"]},
            {"$set": {"target": req.target.model_dump() if req.target else None,
                      "stop": req.stop.model_dump() if req.stop else None, "fired": {}}})
        if not r.matched_count:
            raise HTTPException(status_code=404, detail="Strategy not found")
        return {"ok": True}

    @api_router.delete("/strategies/{sid}")
    async def delete_strategy(sid: str, authorization: Optional[str] = Header(default=None)):
        user = await get_user(authorization)
        r = await db.strategies.delete_one({"strategy_id": sid, "user_id": user["user_id"]})
        if not r.deleted_count:
            raise HTTPException(status_code=404, detail="Strategy not found")
        return {"ok": True}

    # ------------------------------------------------ admin
    async def require_admin(authorization: Optional[str]) -> Dict:
        user = await get_user(authorization)
        raw = await db.users.find_one({"user_id": user["user_id"]}, {"_id": 0, "is_admin": 1})
        if not (raw or {}).get("is_admin"):
            raise HTTPException(status_code=403, detail="Admin only")
        return user

    @api_router.get("/admin/users")
    async def admin_users(q: str = "", authorization: Optional[str] = Header(default=None)):
        await require_admin(authorization)
        import re as _re
        filt = {"$or": [{"email": {"$regex": _re.escape(q.strip()), "$options": "i"}},
                        {"name": {"$regex": _re.escape(q.strip()), "$options": "i"}}]} if q.strip() else {}
        rows = await db.users.find(filt, {"_id": 0, "user_id": 1, "email": 1, "name": 1, "plan": 1, "plan_source": 1,
                                          "plan_expires_at": 1, "created_at": 1, "is_admin": 1}).sort("created_at", -1).to_list(200)
        import billing
        for r in rows:
            r["tier"] = billing.compute_access(r)["tier"]
            _iso(r)
        return {"items": rows}

    @api_router.get("/admin/stats")
    async def admin_stats(authorization: Optional[str] = Header(default=None)):
        await require_admin(authorization)
        import billing
        now = datetime.now(timezone.utc)
        users = await db.users.find({}, {"_id": 0, "plan": 1, "plan_expires_at": 1, "created_at": 1, "last_active_at": 1}).to_list(100000)
        tiers: Dict[str, int] = {"trial": 0, "simple": 0, "advance": 0, "expert": 0, "expired": 0}
        def aware(d):
            return d.replace(tzinfo=timezone.utc) if isinstance(d, datetime) and d.tzinfo is None else d
        signups = {"24h": 0, "7d": 0, "30d": 0}
        active = {"24h": 0, "7d": 0, "30d": 0}
        spans = {"24h": 1, "7d": 7, "30d": 30}
        daily: Dict[str, int] = {}
        for u in users:
            t = billing.compute_access(u)["tier"]
            tiers[t] = tiers.get(t, 0) + 1
            c, la = aware(u.get("created_at")), aware(u.get("last_active_at"))
            for k, d in spans.items():
                if c and now - c <= timedelta(days=d):
                    signups[k] += 1
                if la and now - la <= timedelta(days=d):
                    active[k] += 1
            if c and now - c <= timedelta(days=14):
                day = c.date().isoformat()
                daily[day] = daily.get(day, 0) + 1
        days = [(now - timedelta(days=i)).date().isoformat() for i in range(13, -1, -1)]
        paid = tiers["simple"] + tiers["advance"] + tiers["expert"]
        mrr = sum(tiers[p] * billing.PLAN_PRICES[p] for p in ("simple", "advance", "expert"))
        return {"total_users": len(users), "tiers": tiers, "paid": paid, "mrr": round(mrr, 2), "signups": signups,
                "active": active, "signups_daily": [{"date": d, "count": daily.get(d, 0)} for d in days],
                "open_strategies": await db.strategies.count_documents({"status": "open"})}

    @api_router.get("/admin/users/{uid}")
    async def admin_user_detail(uid: str, authorization: Optional[str] = Header(default=None)):
        await require_admin(authorization)
        import billing
        u = await db.users.find_one({"user_id": uid}, {"_id": 0, "password": 0})
        if not u:
            raise HTTPException(status_code=404, detail="User not found")
        acc = billing.compute_access(u)
        now = datetime.now(timezone.utc)
        days = [(now - timedelta(days=i)).strftime("%Y-%m-%d") for i in range(13, -1, -1)]
        usage = {r["day"]: r.get("scans", 0) for r in await db.usage.find({"user_id": uid, "day": {"$gte": days[0]}}, {"_id": 0}).to_list(60)}
        strats = await db.strategies.find({"user_id": uid}, {"_id": 0, "history": 0, "legs": 0, "rolls": 0, "exit_legs": 0}) \
            .sort("created_at", -1).to_list(200)
        closed = [s for s in strats if s.get("status") == "closed"]
        events = await db.alert_events.find({"user_id": uid}, {"_id": 0, "user_id": 0, "key": 0}).sort("created_at", -1).to_list(5)
        plan_hist = await db.plan_events.find({"user_id": uid}, {"_id": 0, "user_id": 0}).sort("at", -1).to_list(100)
        plan_hist.append({"plan": "signed up", "source": "registration (7-day trial starts)", "by": None, "at": u.get("created_at")})
        pays = await db.payment_transactions.find({"user_id": uid, "status": "paid"}, {"_id": 0, "plan": 1, "amount": 1, "paid_at": 1}).to_list(50)
        pays += [{"plan": p.get("plan"), "amount": p.get("amount"), "paid_at": p.get("created_at"), "source": "paypal"}
                 for p in await db.payments.find({"user_id": uid}, {"_id": 0}).to_list(50)]
        for x in strats + events + plan_hist + pays:
            _iso(x)
        q = u.get("questionnaire") or {}
        return {
            "user": _iso({k: u.get(k) for k in ("user_id", "email", "name", "created_at", "last_active_at", "is_admin",
                                                "plan", "plan_source", "plan_expires_at", "questionnaire_complete", "consent_signed")}),
            "access": {"tier": acc["tier"], "trial_ends_at": acc["trial_ends_at"], "renews_at": acc["renews_at"]},
            "profile": {k: q.get(k) for k in ("experience", "risk_tolerance", "capital", "options_level", "account_type")},
            "activity": {"scans_14d": sum(usage.values()), "scans_today": usage.get(days[-1], 0),
                         "usage_daily": [{"date": d, "scans": usage.get(d, 0)} for d in days],
                         "alerts": await db.alerts.count_documents({"user_id": uid}),
                         "alert_events": await db.alert_events.count_documents({"user_id": uid}),
                         "watchlist": await db.watchlist.count_documents({"user_id": uid}), "recent_events": events},
            "strategies": {"open": [s for s in strats if s.get("status") == "open"][:20], "closed": closed[:20],
                           "open_count": sum(1 for s in strats if s.get("status") == "open"), "closed_count": len(closed),
                           "realized_total": round(sum(s.get("final_pnl") or 0 for s in closed), 2)},
            "plan_history": plan_hist, "payments": sorted(pays, key=lambda p: str(p.get("paid_at") or ""), reverse=True),
        }

    @api_router.post("/admin/users/{uid}/plan")
    async def admin_set_plan(uid: str, req: AdminPlanReq, authorization: Optional[str] = Header(default=None)):
        admin = await require_admin(authorization)
        upd = {"plan": req.plan, "plan_source": "admin", "plan_expires_at": None} if req.plan != "free" else \
              {"plan": "free", "plan_source": None, "plan_expires_at": None}
        r = await db.users.update_one({"user_id": uid}, {"$set": upd})
        if not r.matched_count:
            raise HTTPException(status_code=404, detail="User not found")
        import billing
        await billing.log_plan_event(db, uid, req.plan, "admin", by=admin["email"])
        logger.info(f"admin {admin['email']} set {uid} plan={req.plan}")
        return {"ok": True, "plan": req.plan}

    return {"loop": strategy_loop}
