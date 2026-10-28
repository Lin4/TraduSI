"""Deterministic options & trade-plan engine.

Code calculates every price, premium, probability and collateral number.
The AI layer only ranks/explains what this engine returns.

Liquidity (open interest, volume, bid-ask) is a MODEL ESTIMATE because free
data tiers do not provide real option chains. It is labelled as such.
"""
from __future__ import annotations
import math
from datetime import datetime, timedelta, timezone, date
from typing import Any, Dict, List, Optional, Tuple

from options_math import bs_greeks, norm_cdf

RISK_FREE = 0.045
FEE_PER_CONTRACT = 0.65
SLIPPAGE_FRACTION = 0.25  # fraction of the bid-ask spread paid vs mid on every leg
HIGH_LIQ = {"SPY", "AAPL", "MSFT", "NVDA", "TSLA", "AMZN", "META", "GOOGL", "AMD", "QQQ", "IWM", "NFLX", "AVGO", "PLTR", "BAC", "INTC", "MU"}
ACCOUNT_TYPES = ("cash", "ira", "reg_t", "portfolio_margin")

# level = broker options-approval level needed (1 covered/CSP, 2 long options, 3 spreads, 4 naked)
STRATEGY_META: Dict[str, Dict[str, Any]] = {
    "Cash Secured Put":    {"bias": ["bullish", "neutral"], "naked": False, "credit": True, "level": 1, "profiles": ["low_low"]},
    "Covered Call":        {"bias": ["bullish", "neutral"], "naked": False, "credit": True, "level": 1, "profiles": ["low_low"]},
    "Bull Put Spread":     {"bias": ["bullish"], "naked": False, "credit": True, "level": 3, "profiles": ["low_low", "low_high"]},
    "Bear Call Spread":    {"bias": ["bearish"], "naked": False, "credit": True, "level": 3, "profiles": ["low_low", "low_high"]},
    "Iron Condor":         {"bias": ["neutral"], "naked": False, "credit": True, "level": 3, "profiles": ["low_low", "low_high"]},
    "Bull Call Spread":    {"bias": ["bullish"], "naked": False, "credit": False, "level": 3, "profiles": ["low_high"]},
    "Bear Put Spread":     {"bias": ["bearish"], "naked": False, "credit": False, "level": 3, "profiles": ["low_high"]},
    "Long Call Butterfly": {"bias": ["neutral"], "naked": False, "credit": False, "level": 3, "profiles": ["low_high"]},
    "Long Call":           {"bias": ["bullish"], "naked": False, "credit": False, "level": 2, "profiles": ["high_high"]},
    "Long Put":            {"bias": ["bearish"], "naked": False, "credit": False, "level": 2, "profiles": ["high_high"]},
    "Long Straddle":       {"bias": ["neutral"], "naked": False, "credit": False, "level": 2, "profiles": ["high_high"]},
    "Long Strangle":       {"bias": ["neutral"], "naked": False, "credit": False, "level": 2, "profiles": ["high_high"]},
    "Sell Put":            {"bias": ["bullish", "neutral"], "naked": True, "credit": True, "level": 4, "profiles": ["high_high"]},
    "Sell Call":           {"bias": ["bearish", "neutral"], "naked": True, "credit": True, "level": 4, "profiles": ["high_high"]},
    "Short Strangle":      {"bias": ["neutral"], "naked": True, "credit": True, "level": 4, "profiles": ["high_high"]},
}
for _m in STRATEGY_META.values():
    _m["profile"] = _m["profiles"][0]
STRATEGIES = list(STRATEGY_META.keys())
ASSIGNMENT_STRATS = {"Cash Secured Put", "Covered Call", "Sell Put"}  # sized by collateral vs account
MIN_POP_FLOOR = 70.0  # Discover never shows setups below this probability of profit
CREDIT_VARIANTS = (1.0, 1.35, 1.7)  # short-strike distance multipliers (further OTM = higher POP)
LEVEL_NAMES = {1: "Level 1 · covered calls & cash-secured puts", 2: "Level 2 · + long options",
               3: "Level 3 · + spreads & iron condors", 4: "Full access · + naked selling"}


def user_options_level(q: Dict[str, Any]) -> int:
    """Approval level from questionnaire; experience can only lower it."""
    lvl = {"Not approved": 1, "Level 1-2": 1, "Level 3+": 3, "Full access": 4}.get((q or {}).get("options_level"), 1)
    cap = {"None": 1, "Beginner": 1, "Intermediate": 3, "Advanced": 4}.get((q or {}).get("experience"), 4)
    return min(lvl, cap)


PROFILES: Dict[str, Dict[str, Any]] = {
    "low_low": {"label": "Low risk · Low reward", "min_pop": 70, "max_loss_pct": 5.0, "min_roc": 1.0,
                "allow_undefined": False, "structures": "Covered calls, cash-secured puts, credit spreads, iron condors"},
    "low_high": {"label": "Low risk · Higher reward", "min_pop": 70, "max_loss_pct": 3.0, "min_roc": 15.0,
                 "allow_undefined": False, "structures": "Defined-risk credit spreads & iron condors aiming for higher return on capital"},
    "high_high": {"label": "High risk · High reward", "min_pop": 70, "max_loss_pct": 10.0, "min_roc": 0.0,
                  "allow_undefined": True, "structures": "Naked sell puts / calls, short strangles (large or undefined loss)"},
}

EXP_DAYS = {"daily": 1, "day": 1, "week": 7, "month": 30, "3months": 90, "custom": 14}


# ---------------------------------------------------------------- volatility
def _log_returns(closes: List[float]) -> List[float]:
    return [math.log(closes[i] / closes[i - 1]) for i in range(1, len(closes)) if closes[i - 1] > 0 and closes[i] > 0]


def hist_vol(closes: List[float], n: int) -> Optional[float]:
    r = _log_returns(closes[-(n + 1):])
    if len(r) < max(5, n // 2):
        return None
    m = sum(r) / len(r)
    var = sum((x - m) ** 2 for x in r) / max(len(r) - 1, 1)
    return math.sqrt(var) * math.sqrt(252)


def volatility_profile(candles: List[Dict]) -> Dict[str, Any]:
    closes = [c["c"] for c in candles or []]
    hv20 = hist_vol(closes, 20)
    hv60 = hist_vol(closes, 60) or hv20
    if hv20 is None:
        hv20 = hv60 = 0.30
    # Rolling HV20 series -> rank/percentile proxy
    series = []
    for end in range(21, len(closes) + 1):
        v = hist_vol(closes[:end], 20)
        if v:
            series.append(v)
    if len(series) >= 5:
        lo, hi = min(series), max(series)
        rank = (hv20 - lo) / (hi - lo) * 100 if hi > lo else 50.0
        pct = sum(1 for v in series if v <= hv20) / len(series) * 100
    else:
        rank, pct = 50.0, 50.0
    # IV estimate = blended HV + typical variance-risk premium (10%)
    iv = min(max((0.6 * hv20 + 0.4 * hv60) * 1.10, 0.12), 1.50)
    return {
        "iv": round(iv, 4),
        "hv20": round(hv20, 4),
        "hv60": round(hv60, 4),
        "iv_rank": round(rank, 1),
        "iv_percentile": round(pct, 1),
        "iv_vs_hv": round(iv / hv20, 2) if hv20 else None,
        "method": "Model estimate: IV = blended 20/60-day historical vol + 10% premium; IV rank uses rolling HV history",
        "estimated": True,
    }


def atr(candles: List[Dict], n: int = 14) -> Optional[float]:
    if not candles or len(candles) < 2:
        return None
    trs = []
    for i in range(1, len(candles)):
        h, l, pc = candles[i]["h"], candles[i]["l"], candles[i - 1]["c"]
        trs.append(max(h - l, abs(h - pc), abs(l - pc)))
    trs = trs[-n:]
    return sum(trs) / len(trs) if trs else None


# ---------------------------------------------------------------- legs
def strike_inc(S: float) -> float:
    return 0.5 if S < 25 else 1.0 if S < 200 else 2.5 if S < 500 else 5.0


def _rk(x: float, inc: float) -> float:
    return round(max(inc, round(x / inc) * inc), 2)


def build_legs(name: str, S: float, iv: float, dte: int, exp_date: str, scale: float = 1.0) -> List[Dict]:
    inc = strike_inc(S)
    em0 = max(S * iv * math.sqrt(max(dte, 1) / 365), inc)
    w = max(inc, _rk(em0 * 0.5, inc))
    em = em0 * scale  # scale pushes short strikes further OTM
    atm = _rk(S, inc)

    def L(action, typ, strike, qty=1):
        return {"action": action, "type": typ, "strike": round(strike, 2), "exp": exp_date, "qty": qty}

    if name in ("Cash Secured Put", "Sell Put"):
        return [L("Sell", "Put", min(atm - inc, _rk(S - 0.75 * em, inc)))]
    if name == "Sell Call":
        return [L("Sell", "Call", max(atm + inc, _rk(S + 0.75 * em, inc)))]
    if name == "Covered Call":
        return [L("Buy", "Stock", round(S, 2)), L("Sell", "Call", max(atm + inc, _rk(S + 0.75 * em, inc)))]
    if name == "Bull Put Spread":
        k = min(atm - inc, _rk(S - 0.5 * em, inc))
        return [L("Sell", "Put", k), L("Buy", "Put", _rk(k - w, inc))]
    if name == "Bear Call Spread":
        k = max(atm + inc, _rk(S + 0.5 * em, inc))
        return [L("Sell", "Call", k), L("Buy", "Call", k + w)]
    if name == "Iron Condor":
        ps, cs = min(atm - inc, _rk(S - 0.75 * em, inc)), max(atm + inc, _rk(S + 0.75 * em, inc))
        return [L("Sell", "Put", ps), L("Buy", "Put", _rk(ps - w, inc)), L("Sell", "Call", cs), L("Buy", "Call", cs + w)]
    if name == "Bull Call Spread":
        return [L("Buy", "Call", atm), L("Sell", "Call", max(atm + inc, _rk(S + em, inc)))]
    if name == "Bear Put Spread":
        return [L("Buy", "Put", atm), L("Sell", "Put", min(atm - inc, _rk(S - em, inc)))]
    if name == "Long Call Butterfly":
        return [L("Buy", "Call", _rk(atm - w, inc)), L("Sell", "Call", atm, 2), L("Buy", "Call", atm + w)]
    if name == "Long Call":
        return [L("Buy", "Call", _rk(S + 0.25 * em, inc))]
    if name == "Long Put":
        return [L("Buy", "Put", _rk(S - 0.25 * em, inc))]
    if name == "Long Straddle":
        return [L("Buy", "Call", atm), L("Buy", "Put", atm)]
    if name == "Long Strangle":
        return [L("Buy", "Call", max(atm + inc, _rk(S + 0.5 * em, inc))), L("Buy", "Put", min(atm - inc, _rk(S - 0.5 * em, inc)))]
    if name == "Short Strangle":
        return [L("Sell", "Put", min(atm - inc, _rk(S - em, inc))), L("Sell", "Call", max(atm + inc, _rk(S + em, inc)))]
    raise ValueError(f"Unknown strategy {name}")


def _sign(l: Dict) -> int:
    return 1 if l["action"].lower() == "buy" else -1


def _is_opt(l: Dict) -> bool:
    return l["type"].lower() in ("call", "put")


# ---------------------------------------------------------------- liquidity + pricing
def leg_liquidity(ticker: str, S: float, K: float, iv: float, dte: int, theo: float) -> Dict[str, Any]:
    high = ticker in HIGH_LIQ
    T = max(dte, 1) / 365
    m = abs(math.log(K / S)) / max(iv * math.sqrt(T), 0.03)  # std-devs out of the money
    base_oi = 8000 if high else 1500
    oi = int(max(10, base_oi * math.exp(-0.6 * m * m) * (1.0 if dte <= 60 else 0.6)))
    spread = max(0.01 if high else 0.05, theo * (0.03 if high else 0.07) * (1 + 0.5 * m))
    return {"open_interest": oi, "volume": int(oi * 0.18), "bid_ask": round(spread, 2),
            "spread_pct": round(spread / theo * 100, 1) if theo > 0.005 else 100.0}


def _side(chain: Dict[str, Any], l: Dict) -> Dict[float, Dict]:
    return chain["calls"] if l["type"].lower() == "call" else chain["puts"]


def snap_legs(legs: List[Dict], chain: Dict[str, Any], S: float, exp_date: str) -> List[Dict]:
    """Move model strikes onto real listed strikes (with a quote); keep spread wings from collapsing."""
    out, taken = [], {}
    order = sorted(range(len(legs)), key=lambda i: abs(float(legs[i]["strike"]) - S))
    snapped: Dict[int, Dict] = {}
    for i in order:
        l = legs[i]
        if not _is_opt(l):
            snapped[i] = l
            continue
        side = _side(chain, l)
        ks = sorted(k for k, o in side.items() if (o.get("ask") or 0) > 0) or sorted(side)
        orig = float(l["strike"])
        j = min(range(len(ks)), key=lambda n: abs(ks[n] - orig))
        key = l["type"].lower()
        prev = taken.get((key, ks[j]))
        if prev is not None and prev != orig:  # different model strike collapsed onto the same listed strike
            step = 1 if orig > prev else -1
            j = min(max(j + step, 0), len(ks) - 1)
        taken[(key, ks[j])] = orig
        snapped[i] = {**l, "strike": ks[j], "exp": exp_date}
    for i in range(len(legs)):
        out.append(snapped[i])
    return out


def _live_leg(l: Dict, chain: Dict[str, Any], S: float, T: float, iv: float) -> Optional[Dict[str, Any]]:
    o = _side(chain, l).get(float(l["strike"]))
    if not o:
        return None
    bid, ask = float(o.get("bid") or 0), float(o.get("ask") or 0)
    if ask <= 0 or ask < bid:
        return None
    g = o.get("greeks") or {}
    leg_iv = g.get("mid_iv") or g.get("smv_vol") or iv
    if g.get("delta") is None:
        g = {**bs_greeks(S, float(l["strike"]), T, leg_iv, r=RISK_FREE, call=l["type"].lower() == "call"), "mid_iv": leg_iv}
    mid = (bid + ask) / 2
    spread = ask - bid
    return {"mid": round(mid, 2), "bid": bid, "ask": ask, "iv": round(leg_iv, 4), "symbol": o.get("symbol"),
            "delta": g.get("delta") or 0.0, "gamma": g.get("gamma") or 0.0, "theta": g.get("theta") or 0.0, "vega": g.get("vega") or 0.0,
            "liquidity": {"open_interest": int(o.get("open_interest") or 0), "volume": int(o.get("volume") or 0),
                          "bid_ask": round(spread, 2), "spread_pct": round(spread / mid * 100, 1) if mid > 0.005 else 100.0,
                          "estimated": False}}


def price_legs(ticker: str, legs: List[Dict], S: float, iv: float, dte: int,
               chain: Optional[Dict[str, Any]] = None) -> Tuple[List[Dict], Dict[str, Any]]:
    T = max(dte, 1) / 365
    out = []
    net_mid = net_fill = 0.0
    contracts = live = 0
    for l in legs:
        s, q = _sign(l), l.get("qty", 1)
        if not _is_opt(l):
            out.append({**l, "theo_price": round(S, 2), "mid": round(S, 2), "fill": round(S, 2),
                        "delta": round(s * q * 1.0, 3), "gamma": 0.0, "theta": 0.0, "vega": 0.0})
            continue
        lv = _live_leg(l, chain, S, T, iv) if chain else None
        if lv:
            live += 1
            mid, liq, gk = lv["mid"], lv["liquidity"], lv
            extra = {"bid": lv["bid"], "ask": lv["ask"], "iv": lv["iv"], "option_symbol": lv["symbol"], "live": True}
        else:
            gk = bs_greeks(S, float(l["strike"]), T, iv, r=RISK_FREE, call=l["type"].lower() == "call")
            mid = gk["price"]
            liq = {**leg_liquidity(ticker, S, float(l["strike"]), iv, dte, mid), "estimated": True}
            extra = {"live": False}
        fill = max(0.01, mid + s * SLIPPAGE_FRACTION * liq["bid_ask"])
        net_mid += -s * q * mid
        net_fill += -s * q * fill
        contracts += q
        out.append({**l, "theo_price": mid, "mid": mid, "fill": round(fill, 2),
                    "delta": round(gk["delta"] * s * q, 3), "gamma": round(gk["gamma"] * s * q, 4),
                    "theta": round(gk["theta"] * s * q, 3), "vega": round(gk["vega"] * s * q, 3),
                    "liquidity": liq, **extra})
    fees = round(contracts * FEE_PER_CONTRACT, 2)
    src = "live bid/ask mid" if live and live == contracts_legs(legs) else "theoretical mid"
    pricing = {
        "net_mid": round(net_mid, 2), "net_fill": round(net_fill, 2),
        "slippage_cost": round((net_mid - net_fill) * 100, 2), "fees": fees, "contracts": contracts,
        "live": bool(live) and live == contracts_legs(legs),
        "note": f"{src.capitalize()} with {int(SLIPPAGE_FRACTION * 100)}% of the bid-ask spread as slippage, ${FEE_PER_CONTRACT}/contract fees",
    }
    return out, pricing


def contracts_legs(legs: List[Dict]) -> int:
    return sum(1 for l in legs if _is_opt(l))


def aggregate_liquidity(legs: List[Dict], premium_net: float) -> Dict[str, Any]:
    opts = [l for l in legs if _is_opt(l)]
    if not opts:
        return {}
    min_oi = min(l["liquidity"]["open_interest"] for l in opts)
    min_vol = min(l["liquidity"]["volume"] for l in opts)
    spread_total = sum(l["liquidity"]["bid_ask"] * l.get("qty", 1) for l in opts)
    spread_pct = spread_total / abs(premium_net) * 100 if abs(premium_net) > 0.005 else 100.0
    grade = "High" if min_oi >= 1000 and spread_pct <= 8 else "Medium" if min_oi >= 200 and spread_pct <= 20 else "Low"
    est = any(l["liquidity"].get("estimated", True) for l in opts)
    return {"min_open_interest": min_oi, "min_volume": min_vol, "spread_total": round(spread_total, 2),
            "spread_pct_of_premium": round(spread_pct, 1), "grade": grade, "estimated": est,
            "note": "Model estimate (live chain unavailable)" if est else "Real open interest, volume & bid-ask from the live chain"}


# ---------------------------------------------------------------- payoff + probability
def payoff_exp(ST: float, legs: List[Dict], premium_net: float) -> float:
    v = premium_net
    for l in legs:
        s, q, K = _sign(l), l.get("qty", 1), float(l["strike"])
        t = l["type"].lower()
        if t == "stock":
            v += s * q * (ST - K)
        elif t == "call":
            v += s * q * max(ST - K, 0.0)
        else:
            v += s * q * max(K - ST, 0.0)
    return v * 100


def payoff_stats(legs: List[Dict], S: float, premium_net: float, fees: float) -> Dict[str, Any]:
    hi = S * 3
    grid = sorted({round(hi * i / 900, 4) for i in range(0, 901)} | {float(l["strike"]) for l in legs})
    vals = [payoff_exp(x, legs, premium_net) for x in grid]
    slope = payoff_exp(hi, legs, premium_net) - payoff_exp(hi * 0.99, legs, premium_net)
    unlimited_profit, unlimited_loss = slope > 1e-6, slope < -1e-6
    max_p, min_p = max(vals), min(vals)
    bes = []
    for i in range(1, len(grid)):
        a, b = vals[i - 1], vals[i]
        if (a < 0 <= b) or (a >= 0 > b):
            x = grid[i - 1] + (grid[i] - grid[i - 1]) * (0 - a) / ((b - a) or 1)
            if not bes or abs(bes[-1] - x) > 0.05:
                bes.append(round(x, 2))
    return {
        "max_profit": None if unlimited_profit else round(max_p - fees, 2),
        "max_loss": None if unlimited_loss else round(min(min_p - fees, 0), 2),
        "breakevens": bes, "unlimited_profit": unlimited_profit, "unlimited_loss": unlimited_loss,
    }


def _prob_grid(S: float, sigma: float, dte: int, drift: float):
    T = max(dte, 1) / 365
    sd = sigma * math.sqrt(T)
    mu = (drift - 0.5 * sigma * sigma) * T
    zs = [-6 + i * 0.02 for i in range(601)]
    pts = [S * math.exp(mu + z * sd) for z in zs]
    cdf = [norm_cdf(z) for z in zs]
    return pts, cdf


def probability_and_ev(legs: List[Dict], S: float, premium_net: float, fees: float, iv: float, hv: float, dte: int) -> Dict[str, Any]:
    pts, cdf = _prob_grid(S, iv, dte, RISK_FREE)
    pop = 0.0
    for i in range(1, len(pts)):
        mid = (pts[i] + pts[i - 1]) / 2
        if payoff_exp(mid, legs, premium_net) - fees > 0:
            pop += cdf[i] - cdf[i - 1]
    # Expected value under the realized (historical) vol distribution -> "edge" vs implied pricing
    pts2, cdf2 = _prob_grid(S, max(hv, 0.05), dte, RISK_FREE)
    ev = 0.0
    for i in range(1, len(pts2)):
        mid = (pts2[i] + pts2[i - 1]) / 2
        ev += (payoff_exp(mid, legs, premium_net) - fees) * (cdf2[i] - cdf2[i - 1])
    return {"pop": round(pop * 100, 1), "expected_value": round(ev, 2),
            "pop_method": "Lognormal distribution from implied volatility (risk-neutral), net of fees",
            "ev_method": "Expected P&L under the historical-volatility distribution"}


def iv_at_strike(chain: Optional[Dict[str, Any]], K: float, S: float) -> Optional[float]:
    """Smile-interpolated implied vol at strike K from the OTM side of the live chain (puts below spot, calls above)."""
    if not chain:
        return None
    side = chain["puts"] if K < S else chain["calls"]
    pts = sorted((k, (o.get("greeks") or {}).get("mid_iv") or (o.get("greeks") or {}).get("smv_vol")) for k, o in side.items())
    pts = [(k, v) for k, v in pts if v and 0.01 < v < 5 and (side[k].get("bid") or 0) > 0]
    if not pts:
        return None
    if K <= pts[0][0]:
        return pts[0][1]
    if K >= pts[-1][0]:
        return pts[-1][1]
    for (k0, v0), (k1, v1) in zip(pts, pts[1:]):
        if k0 <= K <= k1:
            return v0 + (v1 - v0) * (K - k0) / ((k1 - k0) or 1)
    return None


def prob_itm(S: float, K: float, iv: float, dte: int, call: bool) -> float:
    T = max(dte, 1) / 365
    d2 = (math.log(S / K) + (RISK_FREE - 0.5 * iv * iv) * T) / (iv * math.sqrt(T))
    return norm_cdf(d2) if call else norm_cdf(-d2)


def scenario_grid(legs: List[Dict], S: float, iv: float, dte: int, fees: float) -> List[Dict]:
    entry = sum(_sign(l) * l.get("qty", 1) * (l["fill"] if _is_opt(l) else float(l["strike"])) for l in legs)
    out = []
    for d in (0, round(dte * 0.5), dte):
        T = max(dte - d, 0.001) / 365
        row = {"days_elapsed": d, "pnl": {}}
        for mv in (-0.10, -0.05, -0.02, 0, 0.02, 0.05, 0.10):
            Sn = S * (1 + mv)
            val = 0.0
            for l in legs:
                q, s = l.get("qty", 1), _sign(l)
                if _is_opt(l):
                    val += s * q * bs_greeks(Sn, float(l["strike"]), T, iv, r=RISK_FREE, call=l["type"].lower() == "call")["price"]
                else:
                    val += s * q * Sn
            row["pnl"][f"{int(mv * 100):+d}%"] = round((val - entry) * 100 - fees, 2)
        out.append(row)
    return out


# ---------------------------------------------------------------- collateral
def collateral_by_account(name: str, legs: List[Dict], S: float, premium_net: float, max_loss: Optional[float],
                          max_profit: Optional[float], dte: int) -> Dict[str, Dict[str, Any]]:
    credit = premium_net * 100
    ml = -max_loss if max_loss is not None else None
    shorts = [l for l in legs if _is_opt(l) and _sign(l) < 0]

    def naked_put(l):
        K = float(l["strike"])
        return max(0.20 * S - max(0.0, S - K) + l["fill"], 0.10 * K + l["fill"]) * 100

    def naked_call(l):
        K = float(l["strike"])
        return max(0.20 * S - max(0.0, K - S) + l["fill"], 0.10 * S + l["fill"]) * 100

    stress = -min(payoff_exp(S * (0.85 + 0.01 * i), legs, premium_net) for i in range(31))
    res: Dict[str, Optional[float]] = {}
    if name == "Cash Secured Put":
        K = float(shorts[0]["strike"])
        res["cash"] = res["ira"] = K * 100 - credit
        res["reg_t"] = naked_put(shorts[0])
    elif name == "Sell Put":
        res["cash"] = res["ira"] = None
        res["reg_t"] = naked_put(shorts[0])
    elif name == "Sell Call":
        res["cash"] = res["ira"] = None
        res["reg_t"] = naked_call(shorts[0])
    elif name == "Covered Call":
        res["cash"] = res["ira"] = S * 100 - credit
        res["reg_t"] = 0.5 * S * 100 - credit
    elif name == "Short Strangle":
        res["cash"] = res["ira"] = None
        p = next(l for l in shorts if l["type"] == "Put")
        c = next(l for l in shorts if l["type"] == "Call")
        res["reg_t"] = max(naked_put(p) + c["fill"] * 100, naked_call(c) + p["fill"] * 100)
    else:
        res["cash"] = res["ira"] = res["reg_t"] = ml
    res["portfolio_margin"] = max(stress, -credit if credit < 0 else 0.0, 1.0)
    if name == "Covered Call":
        res["portfolio_margin"] = max(stress, 0.15 * S * 100)

    out = {}
    for acct in ACCOUNT_TYPES:
        c = res.get(acct)
        if c is None or c <= 0:
            out[acct] = {"collateral": None, "allowed": False, "roc_pct": None, "annualized_pct": None,
                         "reason": "Naked short options are not permitted in cash/IRA accounts"}
            continue
        roc = (max_profit / c * 100) if max_profit is not None else None
        out[acct] = {"collateral": round(c, 2), "allowed": True,
                     "roc_pct": round(roc, 2) if roc is not None else None,
                     "annualized_pct": round(roc * 365 / max(dte, 1), 1) if roc is not None else None}
    return out


# ---------------------------------------------------------------- events
def events_and_assignment(name: str, legs: List[Dict], S: float, iv: float, dte: int, exp_date: str,
                          earnings_date: Optional[str], dividend_yield: Optional[float]) -> Dict[str, Any]:
    today = date.today().isoformat()
    in_window = bool(earnings_date and today <= earnings_date <= exp_date)
    pays_div = bool(dividend_yield and dividend_yield > 0)
    shorts = [l for l in legs if _is_opt(l) and _sign(l) < 0]
    short_itm = [prob_itm(S, float(l["strike"]), iv, dte, l["type"] == "Call") for l in shorts]
    worst = max(short_itm) if short_itm else 0.0
    assign = "High" if worst > 0.5 else "Moderate" if worst > 0.3 else "Low" if shorts else "None"
    pin = dte <= 7 and any(abs(float(l["strike"]) - S) / S < 0.01 for l in shorts)
    has_stock = any(l["type"] == "Stock" for l in legs)
    notes = []
    if in_window:
        notes.append(f"Earnings on {earnings_date} fall inside this expiration window — expect an IV crush and a gap move.")
    if pays_div and any(l["type"] == "Call" for l in shorts):
        notes.append("Stock pays a dividend: short calls carry early-assignment risk right before the ex-dividend date (check the date with your broker).")
    if pin:
        notes.append("Pin risk: a short strike sits within 1% of the price with ≤7 days left.")
    for l in shorts:
        if l["type"] == "Put":
            notes.append(f"If assigned on the ${l['strike']} put you buy {100 * l.get('qty', 1)} shares (${float(l['strike']) * 100 * l.get('qty', 1):,.0f} cash needed).")
        elif not has_stock and not any(b["type"] == "Call" and _sign(b) > 0 for b in legs):
            notes.append(f"If assigned on the ${l['strike']} call without owning shares you become short 100 shares.")
    return {"earnings_date": earnings_date, "earnings_in_window": in_window, "pays_dividend": pays_div,
            "dividend_yield": dividend_yield, "assignment_risk": assign,
            "short_leg_itm_prob": round(worst * 100, 1), "pin_risk": pin, "notes": notes}


# ---------------------------------------------------------------- full idea
def build_idea(ticker: str, info: Dict[str, Any], name: str, S: float, vol: Dict[str, Any], dte: int,
               account_type: str = "reg_t", earnings_date: Optional[str] = None,
               dividend_yield: Optional[float] = None, scale: float = 1.0,
               chain: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    if chain:
        dte, exp_date = chain["dte"], chain["expiration"]
        if chain.get("atm_iv"):
            vol = {**vol, "iv": chain["atm_iv"], "iv_vs_hv": round(chain["atm_iv"] / vol["hv20"], 2) if vol.get("hv20") else None,
                   "method": f"Live at-the-money implied vol from {chain['source']} (ORATS); IV rank uses rolling HV history",
                   "estimated": False}
    else:
        exp_date = (datetime.now(timezone.utc) + timedelta(days=dte)).strftime("%Y-%m-%d")
    iv = vol["iv"]
    hv = 0.5 * vol["hv20"] + 0.5 * (vol.get("hv60") or vol["hv20"])  # realized vol for EV: blend avoids a quiet/noisy 20-day window
    legs = build_legs(name, S, iv, dte, exp_date, scale)
    if chain:
        legs = snap_legs(legs, chain, S, exp_date)
    legs, pricing = price_legs(ticker, legs, S, iv, dte, chain)
    premium_net = pricing["net_fill"]
    fees = pricing["fees"]
    stats = payoff_stats(legs, S, premium_net, fees)
    # POP with the volatility the market prices at the breakevens (skew-aware) instead of one ATM number
    be_ivs = [v for v in (iv_at_strike(chain, b, S) for b in stats["breakevens"]) if v] if chain else []
    pop_iv = sum(be_ivs) / len(be_ivs) if be_ivs else iv
    prob = probability_and_ev(legs, S, premium_net, fees, pop_iv, hv, dte)
    if be_ivs:
        prob["pop_method"] = "Lognormal distribution using the live implied vol at the breakeven strikes (skew-aware), net of fees"
    coll = collateral_by_account(name, legs, S, premium_net, stats["max_loss"], stats["max_profit"], dte)
    liq = aggregate_liquidity(legs, premium_net)
    events = events_and_assignment(name, legs, S, iv, dte, exp_date, earnings_date, dividend_yield)
    sel = coll.get(account_type) or coll["reg_t"]
    net_greeks = {k: round(sum(l.get(k, 0) for l in legs), 3) for k in ("delta", "gamma", "theta", "vega")}
    ev_roc = (prob["expected_value"] / sel["collateral"] * 100) if sel.get("collateral") else None

    idea = {
        "ticker": ticker, "name": info.get("name", ticker), "sector": info.get("sector", "Unknown"),
        "price": round(S, 2), "strategy": name, "strategy_bias": STRATEGY_META[name]["bias"],
        "profile": STRATEGY_META[name]["profile"], "options_level_required": STRATEGY_META[name]["level"],
        "legs": legs, "premium": round(abs(premium_net), 2), "premium_net": premium_net,
        "premium_type": "credit" if premium_net > 0 else "debit",
        "expiration": exp_date, "expiration_days": dte,
        "pop": prob["pop"], "pop_method": prob["pop_method"],
        "expected_value": prob["expected_value"], "ev_method": prob["ev_method"],
        "max_profit": stats["max_profit"], "max_loss": stats["max_loss"], "breakevens": stats["breakevens"],
        "unlimited_profit": stats["unlimited_profit"], "unlimited_loss": stats["unlimited_loss"],
        "pricing": pricing, "liquidity": liq, "volatility": vol, "events": events,
        "account_type": account_type, "collateral_by_account": coll,
        "collateral": sel.get("collateral"), "roc_pct": sel.get("roc_pct"), "annualized_pct": sel.get("annualized_pct"),
        "hypothetical_annualized": True,
        "annualized_note": "Annualized return assumes the same trade can be repeated every cycle — hypothetical.",
        # legacy fields used by existing UI
        "collateral_margin": coll["reg_t"].get("collateral"),
        "annual_pct_no_margin": coll["cash"].get("annualized_pct") if coll["cash"]["allowed"] else coll["reg_t"].get("annualized_pct"),
        "annual_pct_margin": coll["reg_t"].get("annualized_pct"),
        "greeks": net_greeks, "iv_assumed": iv, "pop_iv": round(pop_iv, 4), "scale": scale,
        "ev_roc_pct": round(ev_roc, 2) if ev_roc is not None else None,
        "scenario_matrix": scenario_grid(legs, S, iv, dte, fees),
        "live_quotes": pricing["live"],
        "quote_source": (chain or {}).get("source") if pricing["live"] else "Black-Scholes model",
        "quotes_as_of": (chain or {}).get("as_of") if pricing["live"] else None,
        "assumptions": {"iv_assumed_pct": round(iv * 100, 1), "risk_free_rate_pct": RISK_FREE * 100,
                        "model": f"Live {chain['source']} quotes; probabilities via lognormal IV model" if pricing["live"] else "Black-Scholes European",
                        "slippage": pricing["note"],
                        "pricing_note": "Real bid/ask from the listed chain." if pricing["live"] else "Theoretical mid prices. Real option quotes may differ."},
    }
    idea["pillars"] = market_pillars(idea)
    apply_fit(idea, None, None, None)
    idea["why"], idea["risks"] = explain_deterministic(idea)
    return idea


# ---------------------------------------------------------------- OptiScore (0-100)
OPTISCORE_WEIGHTS = {"expected_return": 0.35, "risk": 0.25, "premium_quality": 0.20, "user_fit": 0.20}


def _clip(x: float, lo: float = 0.0, hi: float = 100.0) -> float:
    return max(lo, min(hi, x))


def market_pillars(i: Dict[str, Any]) -> Dict[str, float]:
    """Expected return, risk and premium quality — each 0-100, independent of the user."""
    dte = max(i["expiration_days"], 1)
    ev_pct = i.get("ev_roc_pct") or 0.0
    er = _clip(50 + ev_pct * 4 * (30 / dte) ** 0.25)  # EV per $ at risk (+12.5% -> 100), gently normalised across horizons

    if i["max_loss"] is None:
        rr_score = 20.0
    else:
        gain = i["max_profit"] if i["max_profit"] is not None else abs(i["max_loss"]) * 2
        rr = abs(i["max_loss"]) / max(gain, 1.0)
        rr_score = 100.0 if rr <= 1 else _clip(100 - 40 * math.log(rr) / math.log(3))
    pop_score = _clip((i["pop"] - 50) * 2)
    risk = 0.5 * rr_score + 0.5 * pop_score
    ev = i["events"]
    risk -= 15 if ev.get("earnings_in_window") else 0
    risk -= 10 if ev.get("assignment_risk") == "High" else 0
    risk -= 10 if ev.get("pin_risk") else 0

    vol = i["volatility"]
    ratio = (i["iv_assumed"] / vol["hv20"]) if vol.get("hv20") else 1.0
    vrp = _clip((ratio - 0.8) / 0.6 * 100) if i["premium_type"] == "credit" else _clip((1.3 - ratio) / 0.5 * 100)
    liq = i["liquidity"] or {}
    spread_s = _clip(100 - (liq.get("spread_pct_of_premium") or 100) * 4)
    oi = liq.get("min_open_interest") or 0
    oi_s = _clip(math.log10(max(oi, 1)) / 3 * 100)  # 1000+ OI -> 100
    liq_s = 0.6 * spread_s + 0.4 * oi_s
    if liq.get("estimated", True):
        liq_s = min(liq_s, 60.0)
    pq = 0.5 * vrp + 0.5 * liq_s
    return {"expected_return": round(er, 1), "risk": round(_clip(risk), 1), "premium_quality": round(pq, 1),
            "detail": {"ev_pct_of_risk": round(ev_pct, 2), "er_model": round(er, 1), "reward_risk_score": round(rr_score, 1),
                       "pop_score": round(pop_score, 1), "iv_hv_ratio": round(ratio, 2), "vrp_score": round(vrp, 1),
                       "liquidity_score": round(liq_s, 1), "spread_pct": liq.get("spread_pct_of_premium"), "min_oi": oi,
                       "liq_estimated": bool(liq.get("estimated", True))}}


def score_drivers(i: Dict[str, Any]) -> Dict[str, List[Dict[str, Any]]]:
    """What moves each OptiScore pillar up or down: points vs a neutral 50. A pillar's factors add up to its score."""
    p = i.get("pillars") or {}
    d = p.get("detail") or {}
    f = lambda label, pts, note: {"label": label, "pts": round(pts, 1), "note": note}

    er = d.get("er_model", p.get("expected_return", 50.0))
    exp_rows = [f("Expected value per $ at risk", er - 50,
                  f"The model expects {d.get('ev_pct_of_risk', 0):+.1f}% of the money at risk per trade, after fees")]
    if d.get("history_score") is not None:
        exp_rows.append(f("This setup on the stock's own history", 0.4 * (d["history_score"] - er),
                          "The same plan backtested on this stock's past prices (40% weight)"))

    ev = i.get("events") or {}
    rr_s, pop_s = d.get("reward_risk_score", 50.0), d.get("pop_score", 50.0)
    if i.get("max_loss") is None:
        rr_note = "Loss isn't capped, so this scores low"
    else:
        gain = i["max_profit"] if i.get("max_profit") is not None else abs(i["max_loss"]) * 2
        rr_note = f"Risk ${abs(i['max_loss']):,.0f} to make ${gain:,.0f}"
    risk_rows = [f("Reward vs risk", 0.5 * (rr_s - 50), rr_note),
                 f("Chance of profit", 0.5 * (pop_s - 50), f"Probability of profit {i.get('pop')}% (50% scores zero, 100% scores full)")]
    raw = 0.5 * rr_s + 0.5 * pop_s
    for on, pts, label, note in ((ev.get("earnings_in_window"), -15, "Earnings before expiration", "A report inside the trade can gap the stock"),
                                 (ev.get("assignment_risk") == "High", -10, "High assignment risk", "A short strike is likely to finish in the money"),
                                 (ev.get("pin_risk"), -10, "Pin risk", "A short strike sits within 1% of the price near expiration")):
        if on:
            risk_rows.append(f(label, pts, note))
            raw += pts
    if abs(p.get("risk", raw) - raw) >= 0.05:
        risk_rows.append(f("Kept within 0-100", p.get("risk", raw) - raw, "Pillar scores stop at 0 and 100"))

    ratio = d.get("iv_hv_ratio")
    credit = i.get("premium_type") == "credit"
    liq_note = (f"Bid-ask spread {d.get('spread_pct')}% of the premium · open interest {d.get('min_oi') or 0:,}"
                if d.get("spread_pct") is not None else f"Open interest {d.get('min_oi') or 0:,}")
    if d.get("liq_estimated"):
        liq_note += " · estimated, so capped at 60"
    prem_rows = [f("Option price vs real movement", 0.5 * (d.get("vrp_score", 50.0) - 50),
                   f"Options price in {ratio}x the movement the stock really shows; "
                   + ("selling rich premium scores higher" if credit else "buying cheap options scores higher")),
                 f("Liquidity", 0.5 * (d.get("liquidity_score", 50.0) - 50), liq_note)]

    fd = d.get("fit")
    if not fd:
        fit_rows = [f("Neutral", 0.0, "No profile or account size used for this idea")]
    else:
        loss_note = (f"Max loss is {fd['loss_pct']}% of your account (your limit {fd['loss_limit']}%)" if fd.get("loss_pct") is not None
                     else "Loss isn't capped or assignment can exceed the plan")
        fit_rows = [f("Matches your risk profile" if fd["profile"] >= 100 else "Outside your risk profile", (fd["profile"] - 50) / 3,
                      "Strategy is one your chosen profile uses" if fd["profile"] >= 100 else "Strategy belongs to a different risk profile"),
                    f("Capital used", (fd["capital"] - 50) / 3, f"Ties up {fd['capital_pct']}% of your account (5% or less scores full)"),
                    f("Max loss vs your limit", (fd["loss"] - 50) / 3, loss_note)]
    return {"expected_return": exp_rows, "risk": risk_rows, "premium_quality": prem_rows, "user_fit": fit_rows}


def apply_history(i: Dict[str, Any]) -> None:
    """Blend the own-history backtest into the expected-return pillar (≥10 trades) and recompute OptiScore."""
    bt = ((i.get("validation") or {}).get("backtest") or {})
    h = (bt.get("managed") or bt.get("hold_to_expiry") or {})
    if (h.get("trades") or 0) < 10:
        return
    pf = h.get("profit_factor")
    hist = 100.0 if pf is None and h["avg_pnl"] > 0 else _clip(((pf or 0) - 0.5) * 100)
    p = i["pillars"]
    p["expected_return"] = round(0.6 * p["expected_return"] + 0.4 * hist, 1)
    p.setdefault("detail", {})["history_score"] = round(hist, 1)
    total = sum(p[k] * w for k, w in OPTISCORE_WEIGHTS.items())
    i["optiscore"] = int(round(total))
    i["optiscore_grade"] = "Excellent" if total >= 80 else "Strong" if total >= 65 else "Fair" if total >= 50 else "Weak"
    i["score"] = round(total, 2)
    i["drivers"] = score_drivers(i)


def apply_fit(i: Dict[str, Any], profile: Optional[str], account_size: Optional[float], filters: Optional[Dict[str, Any]]) -> None:
    """User-fit pillar + final OptiScore. Without user context fit is neutral (50)."""
    reasons = []
    fit_detail = None
    if not profile or not account_size:
        fit = 50.0
    else:
        prof_s = 100.0 if profile in STRATEGY_META[i["strategy"]]["profiles"] else 60.0
        if prof_s < 100:
            reasons.append("Strategy sits outside your chosen risk profile")
        cap = i.get("collateral") or abs(i["max_loss"] or 0) or i["premium"] * 100
        u = cap / max(account_size, 1) * 100
        cap_s = 100.0 if u <= 5 else _clip(100 - (u - 5) * 2)
        if u > 25:
            reasons.append(f"Uses {u:.0f}% of your account as collateral")
        lim = (filters or {}).get("max_loss_pct") or PROFILES.get(profile, PROFILES["low_low"])["max_loss_pct"]
        lp = None
        if i["max_loss"] is None or i["strategy"] in ASSIGNMENT_STRATS:
            loss_s = 40.0 if i["max_loss"] is None else 70.0
        else:
            lp = abs(i["max_loss"]) / max(account_size, 1) * 100
            loss_s = 100.0 if lp <= lim * 0.5 else _clip(100 - (lp / lim - 0.5) * 80)
        fit = (prof_s + cap_s + loss_s) / 3
        fit_detail = {"profile": prof_s, "capital": round(cap_s, 1), "loss": round(loss_s, 1), "capital_pct": round(u, 1),
                      "loss_pct": round(lp, 1) if lp is not None else None, "loss_limit": lim}
    p = {**i["pillars"], "user_fit": round(fit, 1)}
    p["detail"] = {**(p.get("detail") or {}), "fit": fit_detail}
    total = sum(p[k] * w for k, w in OPTISCORE_WEIGHTS.items())
    i["pillars"] = p
    i["optiscore"] = int(round(total))
    i["optiscore_grade"] = "Excellent" if total >= 80 else "Strong" if total >= 65 else "Fair" if total >= 50 else "Weak"
    i["fit_reasons"] = reasons
    i["score"] = round(total, 2)
    i["drivers"] = score_drivers(i)
    i["score_weights"] = OPTISCORE_WEIGHTS


# ---------------------------------------------------------------- management plan
RISK_PCT_BY_PROFILE = {"low_low": 1.0, "low_high": 2.0, "high_high": 2.0}


def management_plan(i: Dict[str, Any], account_size: float, risk_pct: Optional[float] = None, profile: str = "low_low") -> Dict[str, Any]:
    """Entry limit, take-profit, stop, invalidation level, time exit and risk-budget sizing for one idea."""
    risk_pct = risk_pct or RISK_PCT_BY_PROFILE.get(profile, 1.0)
    credit = i["premium_type"] == "credit"
    mid = abs(i["pricing"]["net_mid"])
    worst = abs(i["pricing"]["net_fill"])
    prem = i["premium"]
    fees_rt = i["pricing"]["fees"] * 2
    S, dte = i["price"], max(i["expiration_days"], 1)
    em = S * i["iv_assumed"] * math.sqrt(dte / 365)
    exp = date.fromisoformat(i["expiration"])
    shorts = [l for l in i["legs"] if _is_opt(l) and _sign(l) < 0]
    longs = [l for l in i["legs"] if _is_opt(l) and _sign(l) > 0]
    ml = abs(i["max_loss"]) if i["max_loss"] is not None else None

    if credit:
        tp_val, tp_gain = prem * 0.5, prem * 0.5 * 100
        stop_loss = min(prem * 2 * 100, ml) if ml else prem * 2 * 100
        stop_val = prem + stop_loss / 100
        tp_text = f"Buy back at ${tp_val:.2f} (keep 50% of the credit, ≈ +${tp_gain - fees_rt:,.0f})"
        stop_text = f"Buy back if the price reaches ${stop_val:.2f} (loss ≈ −${stop_loss + fees_rt:,.0f}, 2× credit)"
        entry_text = f"Sell for ${mid:.2f} credit or better; don't accept less than ${worst:.2f}"
        put_k = max((float(l["strike"]) for l in shorts if l["type"] == "Put"), default=None)
        call_k = min((float(l["strike"]) for l in shorts if l["type"] == "Call"), default=None)
        inv = []
        if put_k:
            inv.append(f"closes below the ${put_k:g} short put")
        if call_k:
            inv.append(f"closes above the ${call_k:g} short call")
        inv_text = "Exit if the stock " + " or ".join(inv) if inv else "Exit if the stock breaks the breakeven"
        inv_levels = {"below": put_k, "above": call_k}
        left = 21 if dte >= 40 else 7 if dte >= 14 else 1
        exit_day = exp - timedelta(days=left)
        time_text = (f"Close by {exit_day.isoformat()} ({left} days before expiration) — gamma risk rises after that"
                     if left > 1 else f"Close by {exit_day.isoformat()} — don't hold short options into expiration day")
    else:
        if i["max_profit"] is not None:
            tp_gain = min(prem * 100, i["max_profit"] * 0.5)
        else:
            tp_gain = prem * 100
        tp_val = prem + tp_gain / 100
        stop_loss = prem * 0.5 * 100
        stop_val = prem * 0.5
        tp_text = f"Sell at ${tp_val:.2f} (≈ +${tp_gain - fees_rt:,.0f})"
        stop_text = f"Sell if the price falls to ${stop_val:.2f} (lose half the debit, ≈ −${stop_loss + fees_rt:,.0f})"
        entry_text = f"Pay ${mid:.2f} or less; don't pay more than ${worst:.2f}"
        bias = STRATEGY_META[i["strategy"]]["bias"][0]
        if bias == "bullish":
            lvl = round(S - 0.5 * em, 2)
            inv_text, inv_levels = f"Exit if the stock closes below ${lvl:g} (half an expected move down)", {"below": lvl, "above": None}
        elif bias == "bearish":
            lvl = round(S + 0.5 * em, 2)
            inv_text, inv_levels = f"Exit if the stock closes above ${lvl:g} (half an expected move up)", {"below": None, "above": lvl}
        else:
            ks = sorted(float(l["strike"]) for l in longs) or [S]
            inv_text = (f"Exit if the stock leaves ${ks[0]:g}–${ks[-1]:g}" if "Butterfly" in i["strategy"]
                        else f"Exit if the stock hasn't moved ±${0.5 * em:.2f} by half-time")
            inv_levels = {"below": ks[0] if "Butterfly" in i["strategy"] else None, "above": ks[-1] if "Butterfly" in i["strategy"] else None}
        exit_day = date.today() + timedelta(days=max(1, dte // 2))
        time_text = f"If the target isn't hit by {exit_day.isoformat()} (half the time), close — time decay accelerates"

    budget = account_size * risk_pct / 100
    per_contract = stop_loss + fees_rt
    coll = i.get("collateral") or (ml or prem * 100)
    by_risk = int(budget // per_contract) if per_contract > 0 else 0
    by_capital = int((account_size * 0.5) // coll) if coll else by_risk
    contracts = max(0, min(by_risk, by_capital))
    notes = []
    if contracts == 0:
        notes.append(f"One contract risks ${per_contract:,.0f} at the stop — more than your {risk_pct}% budget (${budget:,.0f}). Skip or reduce size elsewhere.")
    if i["max_loss"] is None or i["strategy"] in ASSIGNMENT_STRATS:
        notes.append("Gaps or assignment can blow through the stop — the true worst case is larger than the planned loss.")
    if i["events"].get("earnings_in_window"):
        notes.append("Earnings fall before expiration — plan to exit before the report or size down.")
    entry_conditions = [entry_text, f"Only enter while the stock is within ±1% of ${S:,.2f} (re-price otherwise)"]
    if credit and i["volatility"].get("iv_rank", 0) < 30:
        entry_conditions.append("IV rank is below 30 — premium is thin; waiting for higher IV improves the edge")
    return {
        "entry": {"limit": round(mid, 2), "worst_acceptable": round(worst, 2), "conditions": entry_conditions},
        "take_profit": {"option_price": round(tp_val, 2), "gain": round(tp_gain - fees_rt, 2), "text": tp_text},
        "stop": {"option_price": round(stop_val, 2), "loss": round(stop_loss + fees_rt, 2), "text": stop_text},
        "invalidation": {"text": inv_text, "levels": inv_levels},
        "time_exit": {"date": exit_day.isoformat(), "text": time_text},
        "sizing": {"risk_pct": risk_pct, "risk_budget": round(budget, 2), "planned_loss_per_contract": round(per_contract, 2),
                   "contracts": contracts, "capital_used": round(contracts * coll, 2),
                   "planned_loss_total": round(contracts * per_contract, 2), "account_size": account_size},
        "notes": notes,
        "rules": {"credit": credit, "tp_gain": tp_gain, "stop_loss": stop_loss,
                  "time_exit_days_left": (21 if dte >= 40 else 7 if dte >= 14 else 1) if credit else max(1, dte - dte // 2)},
    }


def explain_deterministic(i: Dict[str, Any]) -> Tuple[List[str], List[str]]:
    why, risks = [], []
    why.append(f"Probability of profit {i['pop']}% (model), {i['premium_type']} of ${i['premium']:.2f}/share.")
    if i.get("roc_pct") is not None:
        why.append(f"Return on capital {i['roc_pct']}% per trade on ${i['collateral']:,.0f} collateral ({i['account_type'].replace('_', ' ').upper()}).")
    v = i["volatility"]
    if i["premium_type"] == "credit" and v["iv_rank"] >= 50:
        why.append(f"IV rank {v['iv_rank']:.0f} is elevated — option sellers collect richer premium.")
    elif i["premium_type"] == "debit" and v["iv_rank"] <= 40:
        why.append(f"IV rank {v['iv_rank']:.0f} is low — options are relatively cheap to buy.")
    if i["liquidity"].get("grade") == "High":
        why.append("High estimated liquidity — tight spreads and deep open interest.")
    if i["expected_value"] > 0:
        why.append(f"Positive expected value (${i['expected_value']:.0f}) when priced against realized volatility.")
    if i["max_loss"] is None:
        risks.append("Undefined (unlimited) loss — a large move can exceed your account risk.")
    else:
        risks.append(f"Max loss ${abs(i['max_loss']):,.0f} if the stock moves against you through expiration.")
    if i["liquidity"].get("grade") == "Low":
        risks.append("Low estimated liquidity — fills may be far from mid.")
    risks.extend(i["events"]["notes"][:3])
    if i["unlimited_profit"]:
        why.append("Unlimited upside if the move is large enough.")
    return why, risks


# ---------------------------------------------------------------- filters
def default_filters(profile: str) -> Dict[str, Any]:
    p = PROFILES.get(profile, PROFILES["low_low"])
    return {"min_pop": p["min_pop"], "max_loss_pct": p["max_loss_pct"], "min_roc": p["min_roc"],
            "min_oi": 100, "max_spread_pct": 25.0, "min_iv_rank": 0.0, "exclude_earnings": False}


def passes(idea: Dict[str, Any], f: Dict[str, Any], profile: str, account_size: float, max_level: int = 4) -> List[str]:
    """Return a list of failure reasons (empty list = passes)."""
    fails = []
    if STRATEGY_META[idea["strategy"]]["level"] > max_level:
        fails.append("options_level")
    p = PROFILES.get(profile, PROFILES["low_low"])
    sel = idea["collateral_by_account"].get(idea["account_type"], {})
    if not sel.get("allowed"):
        fails.append("account_type")
    if idea["strategy"] in ASSIGNMENT_STRATS:
        # Stock-backed / assignment trades: max loss = stock to $0, so test affordability instead
        if (sel.get("collateral") or 0) > account_size:
            fails.append("capital")
    elif idea["max_loss"] is None:
        if not p["allow_undefined"]:
            fails.append("undefined_risk")
    elif abs(idea["max_loss"]) / max(account_size, 1) * 100 > f["max_loss_pct"]:
        fails.append("max_loss")
    if idea["pop"] < f["min_pop"]:
        fails.append("pop")
    if idea.get("roc_pct") is not None and idea["roc_pct"] < f["min_roc"]:
        fails.append("roc")
    liq = idea["liquidity"]
    if liq and (liq["min_open_interest"] < f["min_oi"] or liq["spread_pct_of_premium"] > f["max_spread_pct"]):
        fails.append("liquidity")
    if idea["volatility"]["iv_rank"] < f["min_iv_rank"]:
        fails.append("iv_rank")
    if f.get("exclude_earnings") and idea["events"]["earnings_in_window"]:
        fails.append("earnings")
    return fails


def candidate_strategies(profile: str, bias: str, max_level: int = 4) -> List[str]:
    out = []
    for n, m in STRATEGY_META.items():
        if profile != "any" and profile not in m["profiles"]:
            continue
        if m["level"] > max_level:
            continue
        if bias not in ("any", "", None) and bias not in m["bias"]:
            continue
        out.append(n)
    return out


def compact(i: Dict[str, Any], fails: Optional[List[str]] = None) -> Dict[str, Any]:
    return {"strategy": i["strategy"], "pop": i["pop"], "roc_pct": i["roc_pct"], "max_profit": i["max_profit"],
            "max_loss": i["max_loss"], "premium_net": i["premium_net"], "score": i["score"], "optiscore": i.get("optiscore"),
            "liquidity_grade": i["liquidity"].get("grade"), "passes": not fails, "failed": fails or []}


# ---------------------------------------------------------------- stock trade plan
def trade_plan(candles: List[Dict], price: float, support: float, resistance: float, trend: str, rsi_val: Optional[float],
               purpose: str, account_size: float, risk_pct: float, min_rr: float) -> Dict[str, Any]:
    a = atr(candles) or price * 0.02
    mult = 0.5 if purpose == "day" else 1.5
    direction = "short" if trend == "Downtrend" and (rsi_val or 50) > 30 else "long"
    entry = price
    logic = [f"ATR(14) = ${a:.2f} — average daily range used to size stops."]
    if direction == "long":
        struct = support - 0.25 * a
        if 0 < support < entry and 0.5 * a <= entry - struct <= 2.5 * a:
            stop, how = struct, f"Stop just below support ${support:.2f} (support − 0.25×ATR)."
        else:
            stop, how = entry - mult * a, f"Stop = entry − {mult}×ATR (support too far/close for a structural stop)."
        risk = entry - stop
        if resistance > entry and (resistance - 0.1 * a - entry) / risk >= min_rr:
            target, thow = resistance - 0.1 * a, f"Target just under resistance ${resistance:.2f}; meets min {min_rr}:1 reward/risk."
        else:
            target = entry + min_rr * risk
            thow = f"Target = entry + {min_rr}×risk" + (" — sits above resistance, lower odds." if resistance > entry and target > resistance else ".")
    else:
        struct = resistance + 0.25 * a
        if resistance > entry and 0.5 * a <= struct - entry <= 2.5 * a:
            stop, how = struct, f"Stop just above resistance ${resistance:.2f} (resistance + 0.25×ATR)."
        else:
            stop, how = entry + mult * a, f"Stop = entry + {mult}×ATR."
        risk = stop - entry
        if 0 < support < entry and (entry - support - 0.1 * a) / risk >= min_rr:
            target, thow = support + 0.1 * a, f"Cover target just above support ${support:.2f}; meets min {min_rr}:1."
        else:
            target = max(entry - min_rr * risk, 0.01)
            thow = f"Cover target = entry − {min_rr}×risk."
        logic.append(f"Trend is {trend} — showing the short-side view.")
    logic += [how, thow]
    risk = max(risk, 0.01)
    rr = abs(target - entry) / risk
    budget = account_size * risk_pct / 100
    shares = int(budget // risk)
    capped = False
    if shares * entry > account_size:
        shares, capped = int(account_size // entry), True
    hi5 = max((c["h"] for c in candles[-5:]), default=price)
    lo5 = min((c["l"] for c in candles[-5:]), default=price)
    if direction == "long":
        if support > 0 and 0 <= entry - support <= a:
            trig = {"type": "pullback", "price": round(support + 0.25 * a, 2),
                    "text": f"Buy near support: a bullish daily close between ${support:.2f} and ${support + 0.5 * a:.2f}"}
        else:
            trig = {"type": "breakout", "price": round(hi5 + 0.1 * a, 2),
                    "text": f"Buy on a break above the 5-day high: trade through ${hi5 + 0.1 * a:.2f}"}
        inv = {"price": round(stop, 2), "text": f"Setup is invalid on a close below ${stop:.2f}" + (" or below the 50-day trend line" if purpose != "day" else "")}
    else:
        if resistance > entry and 0 <= resistance - entry <= a:
            trig = {"type": "rejection", "price": round(resistance - 0.25 * a, 2),
                    "text": f"Short near resistance: a bearish daily close between ${resistance - 0.5 * a:.2f} and ${resistance:.2f}"}
        else:
            trig = {"type": "breakdown", "price": round(lo5 - 0.1 * a, 2),
                    "text": f"Short on a break below the 5-day low: trade through ${lo5 - 0.1 * a:.2f}"}
        inv = {"price": round(stop, 2), "text": f"Setup is invalid on a close above ${stop:.2f}"}
    time_stop = ("Exit by the close — no overnight holds" if purpose == "day"
                 else "If neither target nor stop is hit within 10 trading days, exit — the thesis has stalled")
    logic.append(f"Position size = ${budget:,.0f} risk budget ({risk_pct}% of ${account_size:,.0f}) ÷ ${risk:.2f} risk/share = {shares} shares"
                 + (" (capped by account size)." if capped else "."))
    return {
        "direction": direction, "entry": round(entry, 2), "stop": round(stop, 2), "target": round(target, 2),
        "atr": round(a, 2), "risk_per_share": round(risk, 2), "reward_risk": round(rr, 2), "min_rr": min_rr,
        "shares": shares, "position_value": round(shares * entry, 2), "max_loss_dollars": round(shares * risk, 2),
        "potential_gain_dollars": round(shares * abs(target - entry), 2), "risk_pct": risk_pct,
        "account_size": account_size, "capped_by_buying_power": capped, "logic": logic,
        "entry_trigger": trig, "invalidation": inv, "time_stop": time_stop,
    }


def price_scenarios(price: float, hv: float, horizon_days: int, plan: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
    sd = max(hv, 0.05) * math.sqrt(horizon_days / 252)
    p_tail = 1 - norm_cdf(0.5)
    rows = []
    for name, z, prob in (("Bull", 1.0, p_tail), ("Base", 0.0, 1 - 2 * p_tail), ("Bear", -1.0, p_tail)):
        px = price * math.exp(z * sd)
        row = {"name": name, "price": round(px, 2), "move_pct": round((px / price - 1) * 100, 1), "probability_pct": round(prob * 100, 1)}
        if plan and plan.get("shares"):
            lo, hi = sorted((plan["stop"], plan["target"]))
            exit_px = min(max(px, lo), hi)
            sgn = 1 if plan["direction"] == "long" else -1
            row["plan_pnl"] = round(sgn * (exit_px - plan["entry"]) * plan["shares"], 2)
        rows.append(row)
    return rows


# ---------------------------------------------------------------- valuation (DCF)
def dcf_valuation(price: float, eps: Optional[float], growth: Dict[str, float], discount_pct: float,
                  terminal_pe: float, weights: Dict[str, float], years: int = 5) -> Optional[Dict[str, Any]]:
    if not eps or eps <= 0:
        return None
    d = discount_pct / 100
    out = []
    for name in ("bull", "base", "bear"):
        g = growth[name] / 100
        pv = sum(eps * (1 + g) ** t / (1 + d) ** t for t in range(1, years + 1))
        pv += eps * (1 + g) ** years * terminal_pe / (1 + d) ** years
        out.append({"name": name.capitalize(), "growth_pct": growth[name], "value": round(pv, 2),
                    "upside_pct": round((pv / price - 1) * 100, 1), "weight_pct": weights[name]})
    tw = sum(weights.values()) or 1
    weighted = sum(s["value"] * s["weight_pct"] for s in out) / tw
    bear = out[2]["value"]
    bull = out[0]["value"]
    return {
        "scenarios": out, "weighted_value": round(weighted, 2),
        "weighted_upside_pct": round((weighted / price - 1) * 100, 1),
        "buy_zone_below": round(min(bear, weighted * 0.85), 2),
        "sell_zone_above": round(max(bull, weighted * 1.15), 2),
        "assumptions": {"eps_ttm": round(eps, 2), "discount_rate_pct": discount_pct, "terminal_pe": terminal_pe, "years": years},
        "method": "EPS-based DCF: 5 years of earnings discounted + terminal value at a P/E multiple",
    }


def default_dcf_inputs(metrics: Dict[str, Any]) -> Dict[str, Any]:
    g = metrics.get("revenue_growth_ttm")
    base = round(min(max(g if g is not None else 8.0, -5.0), 25.0), 1)
    pe = metrics.get("pe_ttm")
    tpe = round(min(max((pe or 22) * 0.8, 10), 30), 1)
    return {"growth": {"bull": round(base + 7, 1), "base": base, "bear": round(max(base - 8, -5), 1)},
            "discount_pct": 9.0, "terminal_pe": tpe, "weights": {"bull": 25, "base": 50, "bear": 25}}


# ---------------------------------------------------------------- OptiIQ Value
MRP = 0.06            # market risk premium over the risk-free rate (CAPM)
DEBT_SPREAD = 0.01    # pre-tax cost of debt = risk-free rate + spread
TAX_RATE = 0.21
BETA_CHECK = (0.75, 1.0, 1.25)
TERMINAL_GROWTH = 0.035   # stable perpetual growth after year 10
BASE_FADE = 0.20          # share of the gap to terminal growth / stable margin closed each year
SCENARIOS = {"bear": (-0.08, 0.015), "bull": (0.05, -0.005)}  # (Year-1 growth, WACC) adjustments
# Financials-sector names whose cash flows work like any other business (payments, exchanges & data,
# insurance brokers, traditional asset managers): cash-flow DCF, not the bank model.
ASSET_LIGHT_FINANCIALS = {
    "V", "MA", "PYPL", "FISV", "FI", "FIS", "GPN", "JKHY", "CPAY", "XYZ",
    "SPGI", "MCO", "MSCI", "FDS", "ICE", "CME", "NDAQ", "CBOE",
    "AON", "AJG", "BRO", "MRSH", "MMC", "WTW", "BLK", "TROW", "BEN", "IVZ",
}


def _median(xs: List[float]) -> Optional[float]:
    xs = sorted(xs)
    n = len(xs)
    if not n:
        return None
    return xs[n // 2] if n % 2 else (xs[n // 2 - 1] + xs[n // 2]) / 2


def _clamp(x: float, lo: float, hi: float) -> float:
    return min(max(x, lo), hi)


def _bank_model(sector: str, ticker: str, fcf: Optional[float], ni: float) -> bool:
    """Banks, insurers and brokers: operating cash flow mixes in deposits, loans and float, so value them on book value."""
    if ticker in ASSET_LIGHT_FINANCIALS:
        return False
    s = (sector or "").lower()
    if sector == "Financials" or "bank" in s or "insurance" in s:  # exact GICS sector for S&P 500 names
        return True
    if "financ" in s or "capital markets" in s:  # other financials: cash-flow model only when cash flow tracks earnings
        return not (fcf and ni > 0 and 0.6 <= fcf / ni <= 1.6)
    return False


def _ttm(rows: List[Dict[str, Any]], key: str) -> Optional[float]:
    """Sum of the last 4 quarters, only when they are 4 consecutive quarters that all report the item."""
    last = rows[-4:]
    vals = [r.get(key) for r in last]
    if len(vals) < 4 or any(v is None for v in vals):
        return None
    idx = [(r.get("fiscal_year") or 0) * 4 + (r.get("fiscal_quarter") or 0) for r in last]
    if all(idx) and idx != list(range(idx[0], idx[0] + 4)):
        return None
    return sum(vals)


def _consensus_growth(rows: List[Dict[str, Any]], estimates: Optional[List[Dict[str, Any]]]) -> tuple:
    """Analyst consensus revenue for the coming quarters vs the same fiscal quarters a year earlier (SEC filings).
    Same quarters on both sides, so seasonal swings (a strong holiday quarter, a weak winter one) cancel out."""
    by_q = {(r.get("fiscal_year"), r.get("fiscal_quarter")): r.get("revenue") for r in rows}
    est = ya = 0.0
    used = []
    for e in estimates or []:
        prev = by_q.get((e.get("year", 0) - 1, e.get("quarter")))
        if e.get("revenue_estimate") and prev and prev > 0:
            est += e["revenue_estimate"]
            ya += prev
            used.append(f"Q{e['quarter']} FY{str(e['year'])[-2:]}")
    return (_clamp(est / ya - 1, -0.5, 1.5) if ya else None), used


def _latest_quarter_yoy(rows: List[Dict[str, Any]], metrics: Dict[str, Any]) -> Optional[float]:
    """Latest reported quarter vs the same quarter a year earlier (SEC filings, else the provider's figure)."""
    if rows:
        last = rows[-1]
        prev = next((r.get("revenue") for r in rows if r.get("fiscal_year") == (last.get("fiscal_year") or 0) - 1
                     and r.get("fiscal_quarter") == last.get("fiscal_quarter")), None)
        if last.get("revenue") and prev and prev > 0:
            return _clamp(last["revenue"] / prev - 1, -0.5, 1.5)
    q = metrics.get("revenue_growth_q_yoy")
    return _clamp(q / 100, -0.5, 1.5) if q is not None else None


def optiiq_value(price: float, metrics: Dict[str, Any], financials: List[Dict[str, Any]], sector: str = "", ticker: str = "",
                 estimates: Optional[List[Dict[str, Any]]] = None, capex_history: Optional[List[Dict[str, Any]]] = None) -> Dict[str, Any]:
    """Intrinsic value per share: company-specific, revenue-driven 10-year DCF (the user's DCF template).
    1. Revenue (TTM). Year-1 growth = average of analyst consensus for the coming quarters vs the same quarters a year ago
       and the latest reported quarter vs a year ago (without consensus: TTM growth and the latest quarter vs a year ago).
       Same-quarter comparisons only, so seasonality doesn't skew it. -15% to +80%.
    2. Growth fades toward 3.5% terminal growth: g_t = 3.5% + (g1 - 3.5%) x (1 - fade)^(t-1); fade = 20% (template),
       faster for very high growth (up to 45%).
    3. EBIT margin before stock-based pay (paid in shares, not cash -- the same basis as reported free cash flow) moves from
       today's level toward a stable margin (halfway to the 5-year average, shifted by the same add-back, and at least 60%
       of today's) at the same fade. A negative last-12-month margin with a positive 5-year average (a one-off charge)
       starts halfway between the two.
    4. FCFF = EBIT x (1 - 21% tax) + D&A - capex - change in working capital (receivables + inventory - payables -
       deferred revenue, as a share of the revenue increase). Capex moves from today's share of revenue toward the company's
       own long-run level (median of up to 10 fiscal years of 10-K filings) at the same fade; with under 3 years of history,
       capex above 1.1x D&A (a build-out) converges toward it.
    5. Discount at WACC (CAPM cost of equity, after-tax cost of debt, market-cap/debt weights), end-of-year.
       Terminal value = year-10 FCFF x (1 + 3.5%) / (WACC - 3.5%).
    6. Enterprise value + cash & short-term investments - debt = equity value; / shares = value per share.
       Bear/bull: Year-1 growth -8/+5 points and WACC +1.5/-0.5 points.
    Banks/insurers/brokers and regulated utilities: excess-return model, book value x (ROE - g) / (cost of equity - g).
    Values more than 3x or under 1/4 of the price are flagged confidence="low"."""
    mc = metrics.get("market_cap")
    if not price or not mc:
        return {"available": False, "reason": "Market data unavailable"}
    if (metrics.get("eps_ttm") or 0) > price:  # P/E below 1 means per-share data doesn't match this share price
        return {"available": False, "reason": "Company data looks inconsistent, so no value is shown"}
    shares = mc / price
    rows = financials or []
    q = rows[-4:]
    fcfs = [x["free_cash_flow"] for x in q if x.get("free_cash_flow") is not None]
    fcf = sum(fcfs) * 4 / len(fcfs) if fcfs else None
    if (metrics.get("pfcf_ttm") or 0) > 0:  # standardized TTM free cash flow (catches capex filed under industry-specific lines)
        fcf = mc / metrics["pfcf_ttm"]
    nis = [x["net_income"] for x in q if x.get("net_income") is not None]
    ni = sum(nis) if len(nis) == 4 else (metrics.get("eps_ttm") or 0) * shares

    beta_raw = metrics.get("beta")
    beta = round(_clamp(0.67 * (beta_raw if beta_raw else 1.0) + 0.33, 0.8, 1.5), 2)  # Blume-adjusted (like Bloomberg), 0.8-1.5
    ke = RISK_FREE + beta * MRP
    discount = {"risk_free": RISK_FREE, "beta_raw": round(beta_raw, 2) if beta_raw else None, "beta": beta, "mrp": MRP,
                "cost_of_equity": round(ke, 4)}

    def done(v: Optional[float], details: Dict[str, Any]) -> Dict[str, Any]:
        if not v or v <= 0:
            return {"available": False, "reason": "Not enough positive earnings or cash flow"}
        if v > 10 * price:  # e.g. share-class mix-ups (BRK.B priced as B, EPS of A) or a broken market cap
            return {"available": False, "reason": "Company data looks inconsistent, so no value is shown"}
        out = {"available": True, "value": round(v, 2), "price": round(price, 2), "upside_pct": round((v / price - 1) * 100, 1), **details}
        if v > 3 * price or v < price / 4:  # far from what the market pays: usually one-off growth or cash flow in the inputs
            out["confidence"] = "low"
            out["confidence_note"] = ("This value is far from the market price, which usually means one-off growth, cash flow or "
                                      "debt in the inputs. Treat it with caution.")
        return out

    def check(fn) -> List[Dict[str, Any]]:
        out = []
        for b in BETA_CHECK:
            v = fn(RISK_FREE + b * MRP)
            out.append({"beta": b, "value": round(v, 2) if v and v > 0 else None,
                        "upside_pct": round((v / price - 1) * 100, 1) if v and v > 0 else None})
        return out

    utility = (sector or "").lower() in ("utilities", "utility")
    if utility or _bank_model(sector, ticker, fcf, ni):
        bv = metrics.get("book_value_per_share_q")
        roe = (metrics.get("roe_ttm") or 0) / 100
        if not bv or roe <= 0:
            return done(None, {})
        roe_used, g = _clamp(roe, 0.05, 0.25), 0.03
        er = lambda k: bv * (roe_used - g) / (max(k, 0.08) - g)
        who = "Regulated utilities" if utility else "Banks, insurers and brokers"
        return done(er(ke), {
            "model": "excess_return",
            "method": f"{who} are valued on book value: book value x (ROE - growth) / (cost of equity - growth).",
            "book_value_ps": round(bv, 2), "roe": round(roe, 4), "roe_used": round(roe_used, 4), "growth_lt": g,
            "discount": {**discount, "cost_of_equity": round(max(ke, 0.08), 4)}, "beta_check": check(er),
        })

    # latest filing that reports each item (the newest 10-Q often comes without a balance sheet)
    cb = next((r for r in reversed(rows) if r.get("cash") is not None), {})
    db = next((r for r in reversed(rows) if r.get("total_debt") is not None), {})
    cash = cb.get("cash_and_investments") if cb.get("cash_and_investments") is not None else cb.get("cash")
    cash_src = f"SEC filing, {cb.get('label') or 'latest'}"
    if cash is None:
        cash = (metrics.get("cash_per_share_q") or 0) * shares
        cash_src = "cash per share x shares"
    debt = db.get("total_debt")
    debt_src = f"SEC filing, {db.get('label') or 'latest'}"
    if debt is None:
        de, bvps = metrics.get("debt_to_equity_q"), metrics.get("book_value_per_share_q")
        debt = de * bvps * shares if de and bvps and bvps > 0 else 0.0
        debt_src = "debt-to-equity x book value"

    # 1. revenue (TTM)
    rev = _ttm(rows, "revenue")
    rev_src = "SEC filings, last 4 quarters"
    if not rev and metrics.get("revenue_ps_ttm"):
        rev, rev_src = metrics["revenue_ps_ttm"] * shares, "revenue per share (TTM) x shares"
    if not rev or rev <= 0:
        return done(None, {})

    # 2. Year-1 revenue growth: analyst consensus for the coming quarters vs the same quarters a year ago (or the last
    #    12 months' growth without consensus), averaged with the latest reported quarter vs a year ago
    c_yoy, fwd_quarters = _consensus_growth(rows, estimates)
    ttm_g = metrics.get("revenue_growth_ttm")
    gin = [("Consensus, coming quarters vs a year ago", c_yoy) if c_yoy is not None else
           ("Last 12 months vs the 12 before", ttm_g / 100 if ttm_g is not None else None),
           ("Latest quarter vs a year ago", _latest_quarter_yoy(rows, metrics))]
    gin = [(k, v) for k, v in gin if v is not None]
    if gin:
        g1 = sum(v for _, v in gin) / len(gin)
    else:
        hist = [metrics.get(k) for k in ("revenue_growth_3y", "revenue_growth_5y") if metrics.get(k) is not None]
        g1 = _median(hist) / 100 if hist else 0.05
        gin = [("Revenue growth, 3-5 year average", g1)] if hist else []
    g1 = _clamp(g1, -0.15, 0.8)
    # fast growth fades faster: a 20% yearly fade (the template default), up to 45% for very high growth
    fade = round(_clamp(BASE_FADE + max(0.0, g1 - 0.15) * 0.5, BASE_FADE, 0.45), 3)

    # 3. reinvestment: D&A, capex (heavy build-outs converge toward maintenance levels) and working capital
    oi = _ttm(rows, "operating_income")
    m_rep = metrics["operating_margin_ttm"] / 100 if metrics.get("operating_margin_ttm") is not None else (oi / rev if oi is not None else None)
    da = _ttm(rows, "dep_amort")
    da_pct = da / rev if da is not None else None
    if metrics.get("ebitda_ps_ttm") and metrics.get("revenue_ps_ttm") and m_rep is not None:  # EBITDA - EBIT catches amortization a filing tag misses
        da_alt = metrics["ebitda_ps_ttm"] / metrics["revenue_ps_ttm"] - m_rep
        da_pct = max(da_pct or 0.0, da_alt) if da_alt > 0 else da_pct
    da_pct = _clamp(da_pct if da_pct is not None else 0.04, 0.0, 0.25)
    cx_pct, cx_src = None, "SEC filings, last 4 quarters"
    if (metrics.get("pcf_ttm") or 0) > 0 and (metrics.get("pfcf_ttm") or 0) > 0:  # standardized TTM (catches industry-specific capex lines)
        cx_pct, cx_src = (mc / metrics["pcf_ttm"] - mc / metrics["pfcf_ttm"]) / rev, "TTM, standardized from SEC filings"
    if cx_pct is None or cx_pct < 0:
        cx = _ttm(rows, "capex")
        cx_pct, cx_src = (cx / rev, "SEC filings, last 4 quarters") if cx is not None else (0.06, "template default")
    cx_pct = _clamp(cx_pct, 0.0, 0.6)
    cx_hist = [{"year": h["year"], "pct": h["capex"] / h["revenue"]} for h in (capex_history or [])
               if h.get("revenue") and h["revenue"] > 0 and h.get("capex") is not None][-10:]
    if len(cx_hist) >= 3:  # the company's own long-run capex level (cycles and build-outs included)
        cx_target = _clamp(_median([h["pct"] for h in cx_hist]), 0.0, 0.6)
        cx_rule = f"Moves toward its own {len(cx_hist)}-year median ({cx_hist[0]['year']}-{cx_hist[-1]['year']} 10-K filings)"
    else:
        cx_target = min(cx_pct, 1.1 * da_pct) if da_pct > 0 else cx_pct
        cx_rule = "Under 3 years of filings: a build-out above 1.1x D&A eases toward it"
    wc = next((r for r in reversed(rows) if r.get("receivables") is not None or r.get("inventory") is not None), None)
    if wc:  # trade working capital: receivables + inventory - payables - prepaid subscriptions (deferred revenue)
        nwc = (wc.get("receivables") or 0.0) + (wc.get("inventory") or 0.0) - (wc.get("payables") or 0.0) - (wc.get("deferred_revenue") or 0.0)
        nwc_pct = _clamp(nwc / rev, 0.0, 0.3)
    else:
        nwc_pct = 0.03

    # 4. operating (EBIT) margin before stock-based pay (paid in shares, not cash -- the same basis as reported free cash flow),
    #    moving from today's level toward a stable margin halfway to its 5-year average (shifted by the same add-back)
    m_hist = metrics.get("operating_margin_5y") if metrics.get("operating_margin_5y") is not None else metrics.get("operating_margin_annual")
    m_hist = m_hist / 100 if m_hist is not None else None
    sbc = _ttm(rows, "sbc")
    sbc_pct = _clamp(sbc / rev, 0.0, 0.4) if sbc is not None and sbc > 0 else 0.0
    m0 = m_rep + sbc_pct if m_rep is not None else None
    if m_hist is not None:
        m_hist += sbc_pct
    if m0 is not None and m0 <= 0 and m_hist is not None and m_hist > 0:  # a one-off charge (e.g. impairment) in the last 12 months
        m0 = (m0 + m_hist) / 2
    if m0 is None or m0 <= 0:
        return {"available": False, "reason": "Operating margin isn't positive yet, so a cash-flow DCF isn't meaningful"}
    m_stable = _clamp(max((m0 + m_hist) / 2, 0.6 * m0) if m_hist is not None else m0, 0.01, 0.6)

    # 5. discount rate: WACC from CAPM cost of equity and after-tax cost of debt
    wd = debt / (debt + mc) if debt > 0 else 0.0
    kd = RISK_FREE + DEBT_SPREAD

    def wacc_for(k: float) -> float:
        return max(k * (1 - wd) + kd * (1 - TAX_RATE) * wd, TERMINAL_GROWTH + 0.035, 0.07)

    def model(g_start: float, w: float) -> Dict[str, Any]:
        years, pv_sum, prev, m, cxp = [], 0.0, rev, m0, cx_pct
        for t in range(1, 11):
            g = TERMINAL_GROWTH + (g_start - TERMINAL_GROWTH) * (1 - fade) ** (t - 1)
            r = prev * (1 + g)
            if t > 1:
                m += (m_stable - m) * fade
                cxp += (cx_target - cxp) * fade
            ebit = r * m
            fcff = ebit * (1 - TAX_RATE) + r * da_pct - r * cxp - (r - prev) * nwc_pct
            pv = fcff / (1 + w) ** t
            pv_sum += pv
            years.append({"t": t, "growth": g, "revenue": r, "margin": m, "ebit": ebit, "fcff": fcff, "pv": pv})
            prev = r
        tv = years[-1]["fcff"] * (1 + TERMINAL_GROWTH) / (w - TERMINAL_GROWTH)
        pv_tv = tv / (1 + w) ** 10
        return {"years": years, "pv_sum": pv_sum, "tv": tv, "pv_tv": pv_tv, "ev": pv_sum + pv_tv,
                "per_share": (pv_sum + pv_tv + cash - debt) / shares}

    w_raw = ke * (1 - wd) + kd * (1 - TAX_RATE) * wd
    w = wacc_for(ke)
    d = model(g1, w)
    scen = {}
    for name, (dg, dw) in SCENARIOS.items():
        ws = max(w + dw, TERMINAL_GROWTH + 0.035, 0.07)  # same floors as the base case
        v = model(g1 + dg, ws)["per_share"]
        scen[name] = {"growth_year1": round(g1 + dg, 4), "wacc": round(ws, 4),
                      "value": round(v, 2) if v > 0 else None, "upside_pct": round((v / price - 1) * 100, 1) if v > 0 else None}
    scen["base"] = {"growth_year1": round(g1, 4), "wacc": round(w, 4), "value": round(d["per_share"], 2),
                    "upside_pct": round((d["per_share"] / price - 1) * 100, 1)}
    y0 = int(str(rows[-1].get("end_date") or "")[:4] or 0) if rows else 0
    y0 = y0 or datetime.now(timezone.utc).year - 1
    return done(d["per_share"], {
        "model": "dcf",
        "method": ("10-year revenue-driven DCF: revenue growth starts from analyst consensus and recent growth, then fades toward "
                   f"{TERMINAL_GROWTH * 100:.1f}%; operating margin moves toward a stable level; free cash flow to the firm = "
                   "after-tax EBIT + D&A - capex - working capital; discounted at WACC (CAPM) with a terminal value, plus cash minus debt, "
                   "divided by shares."),
        "revenue_ttm": round(rev), "revenue_source": rev_src,
        "growth": {"year1": round(g1, 4), "terminal": TERMINAL_GROWTH, "fade": fade, "consensus_quarters": fwd_quarters,
                   "inputs": [{"label": k, "pct": round(v * 100, 1)} for k, v in gin]},
        "margin": {"initial": round(m0, 4), "stable": round(m_stable, 4), "reported": round(m_rep, 4) if m_rep is not None else None,
                   "stock_pay_addback": round(sbc_pct, 4), "history_5y": round(m_hist, 4) if m_hist is not None else None},
        "reinvestment": {"tax_rate": TAX_RATE, "da_pct": round(da_pct, 4), "capex_pct": round(cx_pct, 4), "capex_target_pct": round(cx_target, 4),
                         "capex_source": cx_src, "capex_rule": cx_rule,
                         "capex_history": [{"year": h["year"], "pct": round(h["pct"], 4)} for h in cx_hist],
                         "nwc_pct_of_revenue_change": round(nwc_pct, 4)},
        "discount": {**discount, "cost_of_debt": round(kd, 4), "tax_rate": TAX_RATE, "cost_of_debt_after_tax": round(kd * (1 - TAX_RATE), 4),
                     "weight_equity": round(1 - wd, 4), "weight_debt": round(wd, 4), "wacc": round(w, 4),
                     "wacc_floored": w > w_raw + 1e-9, "wacc_formula": round(w_raw, 4)},
        "years": [{"year": y0 + y["t"], "t": y["t"], "growth": round(y["growth"], 4), "revenue": round(y["revenue"]),
                   "ebit_margin": round(y["margin"], 4), "fcff": round(y["fcff"]), "pv": round(y["pv"])} for y in d["years"]],
        "pv_cash_flows": round(d["pv_sum"]), "terminal_value": round(d["tv"]), "pv_terminal": round(d["pv_tv"]),
        "terminal_share_pct": round(d["pv_tv"] / d["ev"] * 100, 1) if d["ev"] > 0 else None,
        "value_of_operations": round(d["ev"]), "cash": round(cash), "cash_source": cash_src, "debt": round(debt), "debt_source": debt_src,
        "equity_value": round(d["ev"] + cash - debt), "shares": round(shares), "market_cap": round(mc),
        "scenarios": scen,
        "beta_check": check(lambda k: model(g1, wacc_for(k))["per_share"]),
    })
