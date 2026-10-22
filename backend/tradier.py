"""Tradier market data: live option expirations + chains (bid/ask, OI, volume, ORATS Greeks/IV).

Token stays server-side. Without a token (or on any upstream error) callers get None and the
engine falls back to its Black-Scholes model, clearly labelled as an estimate.
"""
from __future__ import annotations
import asyncio
import logging
import os
import time
from datetime import date, datetime, timezone
from typing import Any, Dict, List, Optional

import httpx

logger = logging.getLogger(__name__)

ENV = os.environ.get("TRADIER_ENV", "production")
TOKEN = os.environ.get("TRADIER_PRODUCTION_TOKEN") if ENV == "production" else os.environ.get("TRADIER_SANDBOX_TOKEN")
BASE = "https://api.tradier.com/v1" if ENV == "production" else "https://sandbox.tradier.com/v1"
DELAYED = ENV != "production"

_cache: Dict[str, Any] = {}
_sem = asyncio.Semaphore(6)  # stay well under Tradier's 120 req/min


def _cget(k: str, ttl: float):
    v = _cache.get(k)
    return v[1] if v and time.time() - v[0] < ttl else None


async def _get(client: httpx.AsyncClient, path: str, params: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    if not TOKEN:
        return None
    async with _sem:
        try:
            r = await client.get(BASE + path, params=params, timeout=10.0,
                                 headers={"Authorization": f"Bearer {TOKEN}", "Accept": "application/json"})
            if r.status_code != 200:
                logger.warning(f"tradier {path} {params.get('symbol')} -> {r.status_code}")
                return None
            return r.json()
        except (httpx.HTTPError, ValueError) as ex:
            logger.warning(f"tradier {path} failed: {ex}")
            return None


def _as_list(v) -> List:
    return v if isinstance(v, list) else [v] if v else []


async def quote_detail(client: httpx.AsyncClient, symbol: str) -> Optional[Dict[str, float]]:
    """One quote in the same shape as market.get_quote (used when Finnhub's per-minute budget is spent)."""
    d = await _get(client, "/markets/quotes", {"symbols": symbol})
    q = next(iter(_as_list(((d or {}).get("quotes") or {}).get("quote"))), None)
    p = q and (q.get("last") or q.get("prevclose"))
    if not p:
        return None
    f = lambda k: float(q.get(k) or 0)
    return {"price": float(p), "change": f("change"), "change_pct": f("change_percentage"), "high": f("high") or float(p),
            "low": f("low") or float(p), "open": f("open") or float(p), "prev_close": f("prevclose")}


async def quotes(client: httpx.AsyncClient, symbols: List[str]) -> Dict[str, float]:
    """Last trade price for many symbols, batched 150 per request. Missing/failed symbols are simply absent."""
    out: Dict[str, float] = {}
    for i in range(0, len(symbols), 150):
        d = await _get(client, "/markets/quotes", {"symbols": ",".join(symbols[i:i + 150])})
        for q in _as_list(((d or {}).get("quotes") or {}).get("quote")):
            p = q.get("last") or q.get("prevclose")
            if q.get("symbol") and p:
                out[q["symbol"]] = float(p)
    return out


async def expirations(client: httpx.AsyncClient, symbol: str) -> List[str]:
    k = f"exp:{symbol}"
    hit = _cget(k, 6 * 3600)
    if hit is not None:
        return hit
    data = await _get(client, "/markets/options/expirations", {"symbol": symbol, "includeAllRoots": "false"})
    dates = _as_list(((data or {}).get("expirations") or {}).get("date"))
    if dates:
        _cache[k] = (time.time(), dates)
    return dates


async def live_chain(client: httpx.AsyncClient, symbol: str, target_dte: int, spot: float) -> Optional[Dict[str, Any]]:
    """Real chain for the listed expiration closest to target_dte (at least 1 day out)."""
    dates = await expirations(client, symbol)
    today = date.today()
    cands = [(d, (date.fromisoformat(d) - today).days) for d in dates]
    cands = [c for c in cands if c[1] >= 1]
    if not cands:
        return None
    exp, _ = min(cands, key=lambda c: (abs(c[1] - target_dte), c[1]))
    return await chain_for(client, symbol, exp, spot)


async def chain_for(client: httpx.AsyncClient, symbol: str, exp: str, spot: float) -> Optional[Dict[str, Any]]:
    """Normalized chain for one listed expiration (cached 60s)."""
    dte = max((date.fromisoformat(exp) - date.today()).days, 0)
    k = f"chain:{symbol}:{exp}"
    hit = _cget(k, 60)
    if hit is not None:
        return hit
    data = await _get(client, "/markets/options/chains", {"symbol": symbol, "expiration": exp, "greeks": "true"})
    opts = _as_list(((data or {}).get("options") or {}).get("option"))
    if not opts:
        return None
    calls, puts = {}, {}
    for o in opts:
        if o.get("strike") is None or o.get("root_symbol", symbol) != symbol:
            continue
        (calls if o.get("option_type") == "call" else puts)[float(o["strike"])] = o
    if not calls or not puts:
        return None

    def iv_of(o):
        g = o.get("greeks") or {}
        return g.get("mid_iv") or g.get("smv_vol")

    atm = [iv_of(side[min(side, key=lambda s: abs(s - spot))]) for side in (calls, puts)]
    atm = [v for v in atm if v and 0.01 < v < 5]
    out = {
        "expiration": exp, "dte": dte, "calls": calls, "puts": puts,
        "atm_iv": round(sum(atm) / len(atm), 4) if atm else None,
        "source": "Tradier" + (" (sandbox, delayed)" if DELAYED else ""), "delayed": DELAYED,
        "as_of": datetime.now(timezone.utc).isoformat(),
    }
    _cache[k] = (time.time(), out)
    return out
