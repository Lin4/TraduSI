"""Real-time market data layer.

Finnhub-first with Polygon fallback for candles, Alpha Vantage as last-resort.
In-memory TTL cache to respect free-tier rate limits.
"""
from __future__ import annotations
import os
import time
import asyncio
import logging
import math
from typing import Any, Dict, List, Optional
import httpx

import tradier
logger = logging.getLogger("optiscreen.market")

FINNHUB_KEY = os.environ.get("FINNHUB_API_KEY", "")
POLYGON_KEY = os.environ.get("POLYGON_API_KEY", "")
AV_KEY = os.environ.get("ALPHAVANTAGE_API_KEY", "")

_cache: Dict[str, tuple[float, Any]] = {}

def _cache_get(key: str, ttl: float):
    v = _cache.get(key)
    if not v: return None
    t, data = v
    if time.time() - t > ttl: return None
    return data

def _cache_set(key: str, data: Any):
    _cache[key] = (time.time(), data)

def _stale(key: str):
    """Last cached value regardless of age (used when a provider is rate-limited or down)."""
    v = _cache.get(key)
    return v[1] if v else None


# Free-tier request budgets per minute. Over budget -> the call is skipped and callers fall back to cached data.
_RATE = {"api.polygon.io": 5, "finnhub.io": 55, "alphavantage.co": 5}
_calls: Dict[str, List[float]] = {}
CALL_COUNTS: Dict[str, int] = {}


def _host(url: str) -> Optional[str]:
    return next((h for h in _RATE if h in url), None)


def _slot(url: str) -> bool:
    h = _host(url)
    if not h:
        return True
    now = time.time()
    q = [t for t in _calls.get(h, []) if now - t < 61]
    _calls[h] = q
    if len(q) >= _RATE[h]:
        return False
    q.append(now)
    CALL_COUNTS[h] = CALL_COUNTS.get(h, 0) + 1
    return True


def recent_calls(host: str) -> int:
    """Calls made to `host` in the current rate window (background jobs use this to leave room for users)."""
    now = time.time()
    return sum(1 for t in _calls.get(host, []) if now - t < 61)


async def _get(client: httpx.AsyncClient, url: str, params: dict | None = None) -> Optional[dict]:
    if not _slot(url):
        return None
    try:
        r = await client.get(url, params=params, timeout=10.0)
        if r.status_code != 200:
            if r.status_code == 429 and _host(url):  # provider says slow down -> spend the rest of this minute's budget
                _calls[_host(url)] = [time.time()] * _RATE[_host(url)]
            logger.warning(f"GET {url} -> {r.status_code} {r.text[:120]}")
            return None
        return r.json()
    except Exception as e:
        logger.warning(f"GET {url} failed: {e}")
        return None


# =========== TICKER UNIVERSE ===========
UNIVERSE = [
    {"ticker": "AAPL", "name": "Apple Inc.", "sector": "Tech"},
    {"ticker": "MSFT", "name": "Microsoft Corp.", "sector": "Tech"},
    {"ticker": "NVDA", "name": "NVIDIA Corp.", "sector": "Tech"},
    {"ticker": "TSLA", "name": "Tesla Inc.", "sector": "Consumer Discretionary"},
    {"ticker": "AMZN", "name": "Amazon.com Inc.", "sector": "Consumer Discretionary"},
    {"ticker": "META", "name": "Meta Platforms", "sector": "Tech"},
    {"ticker": "GOOGL", "name": "Alphabet Inc.", "sector": "Tech"},
    {"ticker": "JPM", "name": "JPMorgan Chase", "sector": "Financials"},
    {"ticker": "XOM", "name": "Exxon Mobil", "sector": "Energy"},
    {"ticker": "PFE", "name": "Pfizer Inc.", "sector": "Healthcare"},
    {"ticker": "DIS", "name": "Walt Disney", "sector": "Consumer Discretionary"},
    {"ticker": "AMD", "name": "Advanced Micro Devices", "sector": "Tech"},
    {"ticker": "SPY", "name": "S&P 500 ETF", "sector": "Index"},
    {"ticker": "COST", "name": "Costco Wholesale", "sector": "Consumer Staples"},
    {"ticker": "BA", "name": "Boeing Co.", "sector": "Industrials"},
    {"ticker": "QQQ", "name": "Nasdaq-100 ETF", "sector": "Index"},
    {"ticker": "IWM", "name": "Russell 2000 ETF", "sector": "Index"},
    {"ticker": "NFLX", "name": "Netflix Inc.", "sector": "Consumer Discretionary"},
    {"ticker": "AVGO", "name": "Broadcom Inc.", "sector": "Tech"},
    {"ticker": "CRM", "name": "Salesforce Inc.", "sector": "Tech"},
    {"ticker": "ORCL", "name": "Oracle Corp.", "sector": "Tech"},
    {"ticker": "INTC", "name": "Intel Corp.", "sector": "Tech"},
    {"ticker": "MU", "name": "Micron Technology", "sector": "Tech"},
    {"ticker": "PLTR", "name": "Palantir Technologies", "sector": "Tech"},
    {"ticker": "UBER", "name": "Uber Technologies", "sector": "Industrials"},
    {"ticker": "BAC", "name": "Bank of America", "sector": "Financials"},
    {"ticker": "WFC", "name": "Wells Fargo", "sector": "Financials"},
    {"ticker": "GS", "name": "Goldman Sachs", "sector": "Financials"},
    {"ticker": "V", "name": "Visa Inc.", "sector": "Financials"},
    {"ticker": "KO", "name": "Coca-Cola Co.", "sector": "Consumer Staples"},
    {"ticker": "PEP", "name": "PepsiCo Inc.", "sector": "Consumer Staples"},
    {"ticker": "WMT", "name": "Walmart Inc.", "sector": "Consumer Staples"},
    {"ticker": "HD", "name": "Home Depot", "sector": "Consumer Discretionary"},
    {"ticker": "MCD", "name": "McDonald's Corp.", "sector": "Consumer Discretionary"},
    {"ticker": "NKE", "name": "Nike Inc.", "sector": "Consumer Discretionary"},
    {"ticker": "CVX", "name": "Chevron Corp.", "sector": "Energy"},
    {"ticker": "UNH", "name": "UnitedHealth Group", "sector": "Healthcare"},
    {"ticker": "LLY", "name": "Eli Lilly", "sector": "Healthcare"},
    {"ticker": "MRK", "name": "Merck & Co.", "sector": "Healthcare"},
    {"ticker": "CAT", "name": "Caterpillar Inc.", "sector": "Industrials"},
]
UNIVERSE_INDEX = {s["ticker"]: s for s in UNIVERSE}


# =========== QUOTE ===========
async def get_quote(client: httpx.AsyncClient, ticker: str) -> Optional[Dict[str, float]]:
    """Return {price, change, change_pct, high, low, prev_close, open} or None."""
    key = f"q:{ticker}"
    hit = _cache_get(key, 30.0)
    if hit is not None: return hit
    data = await _get(client, "https://finnhub.io/api/v1/quote", {"symbol": ticker, "token": FINNHUB_KEY})
    if data and (data.get("c") or 0) > 0:
        q = {
            "price": float(data["c"]),
            "change": float(data.get("d") or 0),
            "change_pct": float(data.get("dp") or 0),
            "high": float(data.get("h") or 0),
            "low": float(data.get("l") or 0),
            "open": float(data.get("o") or 0),
            "prev_close": float(data.get("pc") or 0),
        }
        _cache_set(key, q)
        return q
    stale = _cache_get(key, 900.0)  # rate-limited / upstream error -> last good quote (<15 min)
    if stale is not None:
        return stale
    q = await tradier.quote_detail(client, ticker)
    if q:
        _cache_set(key, q)
    return q


# =========== CANDLES ===========
CANDLE_STORE = None  # Mongo collection (set by server.py) so daily bars survive restarts
CANDLE_DAYS = 250


async def get_candles(client: httpx.AsyncClient, ticker: str, days: int = 30) -> List[Dict[str, float]]:
    """Daily {o,h,l,c,v,t} candles. One 250-day series per ticker (sliced for shorter requests), refreshed every 6h
    and persisted in Mongo. Polygon first, Alpha Vantage fallback, last good series when providers are rate-limited."""
    n = max(days, CANDLE_DAYS)
    key = f"c:{ticker}:{n}"
    hit = _cache_get(key, 21600.0)
    if hit is not None:
        return hit[-days:]
    stale = _stale(key)
    if stale is None and CANDLE_STORE is not None:
        doc = await CANDLE_STORE.find_one({"_id": key})
        if doc and doc.get("candles"):
            _cache[key] = (doc["ts"], doc["candles"])
            if time.time() - doc["ts"] < 21600.0:
                return doc["candles"][-days:]
            stale = doc["candles"]
    candles = await _fetch_candles(client, ticker, n)
    if candles:
        _cache_set(key, candles)
        if CANDLE_STORE is not None:
            try:
                await CANDLE_STORE.update_one({"_id": key}, {"$set": {"ts": time.time(), "candles": candles}}, upsert=True)
            except Exception as ex:
                logger.warning(f"candle store {ticker}: {ex}")
        return candles[-days:]
    return (stale or [])[-days:]


async def _fetch_candles(client: httpx.AsyncClient, ticker: str, days: int) -> List[Dict[str, float]]:
    # Polygon aggs (free tier gives 2-year history delayed)
    import datetime as dt
    end = dt.date.today()
    start = end - dt.timedelta(days=max(int(days * 1.5) + 10, 60))
    pdata = await _get(
        client,
        f"https://api.polygon.io/v2/aggs/ticker/{ticker}/range/1/day/{start.isoformat()}/{end.isoformat()}",
        {"adjusted": "true", "sort": "asc", "limit": 1000, "apiKey": POLYGON_KEY},
    )
    if pdata and pdata.get("results"):
        candles = [
            {"o": float(x["o"]), "h": float(x["h"]), "l": float(x["l"]), "c": float(x["c"]), "v": float(x.get("v", 0)), "t": int(x["t"])}
            for x in pdata["results"]
        ][-days:]
        if candles:
            return candles
    if pdata is None and len(_calls.get("api.polygon.io", [])) >= _RATE["api.polygon.io"]:
        return []  # Polygon budget used up this minute -> don't burn the tiny Alpha Vantage quota

    # Alpha Vantage daily fallback (rate-limited but okay)
    adata = await _get(
        client, "https://www.alphavantage.co/query",
        {"function": "TIME_SERIES_DAILY", "symbol": ticker, "outputsize": "compact", "apikey": AV_KEY},
    )
    series = (adata or {}).get("Time Series (Daily)")
    if series:
        rows = sorted(series.items())[-days:]
        candles = [{
            "o": float(v["1. open"]),
            "h": float(v["2. high"]),
            "l": float(v["3. low"]),
            "c": float(v["4. close"]),
            "v": float(v["5. volume"]),
        } for _, v in rows]
        if candles:
            return candles

    return []


# =========== PROFILE / FINANCIALS ===========
async def get_profile(client: httpx.AsyncClient, ticker: str) -> Dict[str, Any]:
    key = f"p:{ticker}"
    hit = _cache_get(key, 86400.0)
    if hit is not None: return hit
    data = await _get(client, "https://finnhub.io/api/v1/stock/profile2", {"symbol": ticker, "token": FINNHUB_KEY})
    if data is None and _stale(key) is not None:
        return _stale(key)
    data = data or {}
    prof = {
        "name": data.get("name") or UNIVERSE_INDEX.get(ticker, {}).get("name") or ticker,
        "sector": data.get("finnhubIndustry") or UNIVERSE_INDEX.get(ticker, {}).get("sector") or "Unknown",
        "market_cap_bn": round((data.get("marketCapitalization") or 0) / 1000, 2),
        "logo": data.get("logo"),
        "country": data.get("country"),
        "exchange": data.get("exchange"),
        "ipo": data.get("ipo"),
    }
    _cache_set(key, prof)
    return prof


async def get_metrics(client: httpx.AsyncClient, ticker: str) -> Dict[str, Any]:
    key = f"m:{ticker}"
    hit = _cache_get(key, 3600.0)
    if hit is not None: return hit
    data = await _get(client, "https://finnhub.io/api/v1/stock/metric", {"symbol": ticker, "metric": "all", "token": FINNHUB_KEY})
    if data is None:  # rate-limited / down: last good metrics, and don't cache an empty result
        return _stale(key) or {}
    m = data.get("metric") or {}
    result = {
        "pe_ttm": m.get("peBasicExclExtraTTM") or m.get("peNormalizedAnnual"),
        "ps_ttm": m.get("psTTM"),
        "eps_ttm": m.get("epsBasicExclExtraItemsTTM") or m.get("epsNormalizedAnnual"),
        "52w_high": m.get("52WeekHigh"),
        "52w_low": m.get("52WeekLow"),
        "beta": m.get("beta"),
        "dividend_yield": m.get("dividendYieldIndicatedAnnual"),
        "revenue_growth_ttm": m.get("revenueGrowthTTMYoy"),
        "net_profit_margin": m.get("netProfitMarginTTM"),
        "roe_ttm": m.get("roeTTM"),
        "debt_to_equity": m.get("totalDebt/totalEquityAnnual"),
        # valuation measures (Finnhub reports market cap / EV in $ millions)
        "market_cap": m["marketCapitalization"] * 1e6 if m.get("marketCapitalization") else None,
        "enterprise_value": m["enterpriseValue"] * 1e6 if m.get("enterpriseValue") else None,
        "trailing_pe": m.get("peTTM") or m.get("peBasicExclExtraTTM"),
        "forward_pe": m.get("forwardPE"),
        "peg_ratio": m.get("forwardPEG") or m.get("pegTTM"),
        "price_to_sales": m.get("psTTM"),
        "price_to_book": m.get("pbQuarterly") or m.get("pb"),
        "ev_to_revenue": m.get("evRevenueTTM"),
        "ev_to_ebitda": m.get("evEbitdaTTM"),
        "cash_per_share_q": m.get("cashPerSharePerShareQuarterly"),
        "book_value_per_share_q": m.get("bookValuePerShareQuarterly"),
        "debt_to_equity_q": m.get("totalDebt/totalEquityQuarterly"),
        "revenue_growth_5y": m.get("revenueGrowth5Y"),
        "eps_growth_5y": m.get("epsGrowth5Y"),
        "eps_growth_ttm": m.get("epsGrowthTTMYoy"),
    }
    _cache_set(key, result)
    return result


_FIN_CONCEPTS = {
    "revenue": ["us-gaap_RevenuesNetOfInterestExpense",  # banks' total net revenue (non-banks don't report it)
                "us-gaap_Revenues", "us-gaap_RevenueFromContractWithCustomerExcludingAssessedTax",
                "us-gaap_SalesRevenueNet", "us-gaap_RevenueFromContractWithCustomerIncludingAssessedTax"],
    "net_income": ["us-gaap_NetIncomeLoss", "us-gaap_ProfitLoss"],
    "operating_cash_flow": ["us-gaap_NetCashProvidedByUsedInOperatingActivities",
                            "us-gaap_NetCashProvidedByUsedInOperatingActivitiesContinuingOperations"],
    "capex": ["us-gaap_PaymentsToAcquirePropertyPlantAndEquipment", "us-gaap_PaymentsToAcquireProductiveAssets"],
    "cash": ["us-gaap_CashAndCashEquivalentsAtCarryingValue",
             "us-gaap_CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents"],
    "total_liabilities": ["us-gaap_Liabilities"],
    "equity": ["us-gaap_StockholdersEquity",
               "us-gaap_StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest"],
    "debt_long": ["us-gaap_LongTermDebtNoncurrent", "us-gaap_LongTermDebt", "us-gaap_LongTermDebtAndCapitalLeaseObligations"],
    "debt_current": ["us-gaap_LongTermDebtCurrent", "us-gaap_DebtCurrent"],
    "debt_short": ["us-gaap_CommercialPaper", "us-gaap_ShortTermBorrowings"],
}
_FLOW_KEYS = ("revenue", "net_income", "operating_cash_flow", "capex")


def _pick(items: Dict[str, float], names: List[str]) -> Optional[float]:
    for n in names:
        if items.get(n) is not None:
            return float(items[n])
    return None


async def get_quarterly_financials(client: httpx.AsyncClient, ticker: str, n: int = 3) -> List[Dict[str, Any]]:
    """Last n fiscal quarters from SEC filings (Finnhub as-reported). 10-Q flow items are
    year-to-date, so each quarter = YTD(q) - YTD(q-1); Q4 = annual 10-K - Q3 YTD."""
    key = f"fin:{ticker}:{n}"
    hit = _cache_get(key, 43200.0)
    if hit is not None:
        return hit
    data = await _get(client, "https://finnhub.io/api/v1/stock/financials-reported",
                      {"symbol": ticker, "freq": "quarterly", "token": FINNHUB_KEY})
    if data is None:
        return _stale(key) or []
    annual = await _get(client, "https://finnhub.io/api/v1/stock/financials-reported",
                        {"symbol": ticker, "freq": "annual", "token": FINNHUB_KEY}) or {}
    rows: Dict[tuple, Dict[str, Any]] = {}
    for rep, is_annual in [(r, False) for r in data.get("data") or []] + [(r, True) for r in (annual.get("data") or [])[:2]]:
        q = 4 if is_annual else int(rep.get("quarter") or 0)
        if not q:
            continue
        items: Dict[str, float] = {}
        for sec in ("ic", "cf", "bs"):
            for it in (rep.get("report") or {}).get(sec) or []:
                if isinstance(it.get("value"), (int, float)):
                    items.setdefault(it["concept"], it["value"])
        vals = {k: _pick(items, v) for k, v in _FIN_CONCEPTS.items()}
        if vals["revenue"] is None and items.get("us-gaap_InterestIncomeExpenseNet") is not None and items.get("us-gaap_NoninterestIncome") is not None:
            vals["revenue"] = float(items["us-gaap_InterestIncomeExpenseNet"]) + float(items["us-gaap_NoninterestIncome"])  # bank net revenue
        rows[(int(rep["year"]), q)] = {"end_date": (rep.get("endDate") or "")[:10], "ytd": vals}
    out = []
    for (y, q) in sorted(rows, reverse=True):
        cur = rows[(y, q)]
        prev = rows.get((y, q - 1)) if q > 1 else None
        if q > 1 and not prev:
            continue  # can't de-cumulate without the prior quarter
        row: Dict[str, Any] = {"label": f"Q{q} FY{str(y)[-2:]}", "fiscal_year": y, "fiscal_quarter": q, "end_date": cur["end_date"]}
        for k in _FLOW_KEYS:
            a = cur["ytd"].get(k)
            b = prev["ytd"].get(k) if prev else 0.0
            row[k] = (a - b) if a is not None and b is not None else None
        for k in ("cash", "total_liabilities", "equity"):
            row[k] = cur["ytd"].get(k)
        parts = [cur["ytd"].get(k) for k in ("debt_long", "debt_current", "debt_short")]
        row["total_debt"] = sum(p for p in parts if p is not None) if any(p is not None for p in parts) else None
        row["debt_to_equity"] = round(row["total_debt"] / row["equity"], 2) if row["total_debt"] is not None and row["equity"] else None
        ocf, capex = row["operating_cash_flow"], row["capex"]
        row["free_cash_flow"] = (ocf - (capex or 0)) if ocf is not None else None
        row["net_margin_pct"] = round(row["net_income"] / row["revenue"] * 100, 1) if row["revenue"] and row["net_income"] is not None else None
        out.append(row)
        if len(out) >= n + 1:
            break
    out.reverse()  # oldest -> newest for charts
    for i, r in enumerate(out):  # quarter-over-quarter growth
        p = out[i - 1] if i else None
        for k in ("revenue", "net_income"):
            r[f"{k}_growth_pct"] = round((r[k] / p[k] - 1) * 100, 1) if p and r.get(k) is not None and p.get(k) else None
    out = out[-n:]
    _cache_set(key, out)
    return out


async def get_earnings(client: httpx.AsyncClient, ticker: str) -> Dict[str, Any]:
    key = f"e:{ticker}"
    hit = _cache_get(key, 3600.0)
    if hit is not None: return hit
    import datetime as dt
    today = dt.date.today()
    end = today + dt.timedelta(days=120)
    data = await _get(client, "https://finnhub.io/api/v1/calendar/earnings", {
        "symbol": ticker, "from": today.isoformat(), "to": end.isoformat(), "token": FINNHUB_KEY,
    })
    if data is None:
        return _stale(key) or {"date": None, "eps_estimate": None, "eps_actual": None, "revenue_estimate": None}
    rows = data.get("earningsCalendar") or []
    if not rows:
        past = today - dt.timedelta(days=120)
        data2 = await _get(client, "https://finnhub.io/api/v1/calendar/earnings", {
            "symbol": ticker, "from": past.isoformat(), "to": today.isoformat(), "token": FINNHUB_KEY,
        }) or {}
        rows = data2.get("earningsCalendar") or []
    row = rows[0] if rows else {}
    result = {
        "date": row.get("date"),
        "eps_estimate": row.get("epsEstimate"),
        "eps_actual": row.get("epsActual"),
        "revenue_estimate": row.get("revenueEstimate"),
    }
    _cache_set(key, result)
    return result


async def get_peers(client: httpx.AsyncClient, ticker: str) -> List[str]:
    key = f"pr:{ticker}"
    hit = _cache_get(key, 86400.0)
    if hit is not None: return hit
    data = await _get(client, "https://finnhub.io/api/v1/stock/peers", {"symbol": ticker, "token": FINNHUB_KEY})
    if data is None:
        return _stale(key) or []
    peers = [p for p in data if p and p != ticker][:5]
    _cache_set(key, peers)
    return peers


async def get_recommendations(client: httpx.AsyncClient, ticker: str) -> Dict[str, int]:
    key = f"r:{ticker}"
    hit = _cache_get(key, 86400.0)
    if hit is not None: return hit
    data = await _get(client, "https://finnhub.io/api/v1/stock/recommendation", {"symbol": ticker, "token": FINNHUB_KEY})
    if data is None and _stale(key) is not None:
        return _stale(key)
    data = data or []
    row = (data or [{}])[0]
    result = {
        "buy": int(row.get("strongBuy", 0) + row.get("buy", 0)),
        "hold": int(row.get("hold", 0)),
        "sell": int(row.get("sell", 0) + row.get("strongSell", 0)),
        "period": row.get("period"),
    }
    _cache_set(key, result)
    return result


async def get_price_target(client: httpx.AsyncClient, ticker: str) -> Optional[float]:
    key = f"pt:{ticker}"
    hit = _cache_get(key, 86400.0)
    if hit is not None: return hit
    data = await _get(client, "https://finnhub.io/api/v1/stock/price-target", {"symbol": ticker, "token": FINNHUB_KEY}) or {}
    pt = data.get("targetMean") or data.get("targetMedian")
    if pt:
        _cache_set(key, float(pt))
        return float(pt)
    return None


async def get_news_sentiment(client: httpx.AsyncClient, ticker: str) -> Optional[Dict[str, float]]:
    key = f"ns:{ticker}"
    hit = _cache_get(key, 3600.0)
    if hit is not None: return hit
    data = await _get(client, "https://finnhub.io/api/v1/news-sentiment", {"symbol": ticker, "token": FINNHUB_KEY}) or {}
    s = data.get("sentiment") or {}
    if s:
        res = {"bullish": float(s.get("bullishPercent") or 0), "bearish": float(s.get("bearishPercent") or 0)}
        _cache_set(key, res)
        return res
    return None


# =========== TECHNICAL CALCS ===========
def sma(values: List[float], n: int) -> Optional[float]:
    if len(values) < n: return None
    return round(sum(values[-n:]) / n, 2)


def rsi(values: List[float], period: int = 14) -> Optional[float]:
    if len(values) < period + 1: return None
    gains, losses = 0.0, 0.0
    for i in range(-period, 0):
        diff = values[i] - values[i - 1]
        if diff > 0: gains += diff
        else: losses -= diff
    avg_gain = gains / period
    avg_loss = losses / period
    if avg_loss == 0: return 100.0
    rs = avg_gain / avg_loss
    return round(100 - (100 / (1 + rs)), 1)


def support_resistance(candles: List[Dict]) -> tuple[float, float]:
    if not candles: return 0.0, 0.0
    lows = [c["l"] for c in candles[-30:]]
    highs = [c["h"] for c in candles[-30:]]
    return round(min(lows), 2), round(max(highs), 2)


def detect_candle_patterns(candles: List[Dict]) -> List[str]:
    if len(candles) < 3: return []
    out = []
    c2, c1, c0 = candles[-3], candles[-2], candles[-1]
    # Hammer: small body, long lower wick
    body = abs(c0["c"] - c0["o"])
    lower_wick = min(c0["o"], c0["c"]) - c0["l"]
    upper_wick = c0["h"] - max(c0["o"], c0["c"])
    rng = c0["h"] - c0["l"] or 1
    if lower_wick > 2 * body and upper_wick < body and body / rng > 0.1:
        out.append("Hammer")
    # Bullish engulfing
    if c1["c"] < c1["o"] and c0["c"] > c0["o"] and c0["c"] > c1["o"] and c0["o"] < c1["c"]:
        out.append("Bullish Engulfing")
    # Bearish engulfing
    if c1["c"] > c1["o"] and c0["c"] < c0["o"] and c0["c"] < c1["o"] and c0["o"] > c1["c"]:
        out.append("Bearish Engulfing")
    # Three white soldiers
    if all(x["c"] > x["o"] for x in (c2, c1, c0)) and c0["c"] > c1["c"] > c2["c"]:
        out.append("Three White Soldiers")
    return out[:3] or ["Doji"]


def detect_chart_patterns(candles: List[Dict]) -> List[str]:
    if len(candles) < 20: return []
    closes = [c["c"] for c in candles]
    sma20 = sma(closes, 20)
    sma50 = sma(closes, min(50, len(closes)))
    out = []
    if sma20 and sma50:
        if sma20 > sma50 * 1.01: out.append("Golden Cross")
        elif sma20 < sma50 * 0.99: out.append("Death Cross")
    # Double bottom (two troughs in last 20 candles)
    lows = [c["l"] for c in candles[-20:]]
    mn = min(lows)
    close_to_min = [i for i, l in enumerate(lows) if abs(l - mn) / mn < 0.02]
    if len(close_to_min) >= 2 and (close_to_min[-1] - close_to_min[0]) >= 5:
        out.append("Double Bottom")
    # Uptrend / Downtrend
    if sma20 and candles[-1]["c"] > sma20 and sma20 > candles[-20]["c"]:
        out.append("Uptrend")
    return out[:3] or ["Consolidation"]


# =========== HIGH-LEVEL: full stock bundle ===========
async def fetch_stock_bundle(ticker: str) -> Dict[str, Any]:
    """Fetch everything we need for a ticker in parallel."""
    async with httpx.AsyncClient() as client:
        results = await asyncio.gather(
            get_quote(client, ticker),
            get_candles(client, ticker, 60),
            get_profile(client, ticker),
            get_metrics(client, ticker),
            get_earnings(client, ticker),
            get_peers(client, ticker),
            get_recommendations(client, ticker),
            get_price_target(client, ticker),
            get_news_sentiment(client, ticker),
            return_exceptions=True,
        )
    quote, candles, profile, metrics, earnings, peers, recs, pt, sentiment = results
    # Normalize exceptions
    def ok(x): return x if not isinstance(x, Exception) else None
    quote = ok(quote); candles = ok(candles) or []; profile = ok(profile) or {}
    metrics = ok(metrics) or {}; earnings = ok(earnings) or {}; peers = ok(peers) or []
    recs = ok(recs) or {}; pt = ok(pt); sentiment = ok(sentiment)

    closes = [c["c"] for c in candles]
    sma_20 = sma(closes, 20)
    sma_50 = sma(closes, 50)
    rsi_14 = rsi(closes)
    sup, res = support_resistance(candles)
    cp = detect_candle_patterns(candles)
    chartp = detect_chart_patterns(candles)
    trend = "Uptrend" if sma_20 and sma_50 and sma_20 > sma_50 else ("Downtrend" if sma_20 and sma_50 and sma_20 < sma_50 else "Sideways")

    return {
        "ticker": ticker,
        "name": profile.get("name") or ticker,
        "sector": profile.get("sector"),
        "profile": profile,
        "quote": quote,
        "price": quote["price"] if quote else None,
        "candles": candles,
        "sma_20": sma_20, "sma_50": sma_50, "rsi": rsi_14,
        "support": sup, "resistance": res,
        "candlestick_patterns": cp,
        "chart_patterns": chartp,
        "trend": trend,
        "metrics": metrics,
        "earnings": earnings,
        "peers": peers,
        "analyst_ratings": {k: v for k, v in recs.items() if k in ("buy", "hold", "sell")},
        "price_target": pt,
        "news_sentiment": sentiment,
    }
