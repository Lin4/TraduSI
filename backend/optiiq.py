"""OptiIQ Value: the plain average of 9 intrinsic-value methods (modelled on StockOracle's OracleValue chart).

Cash-flow methods (beta-table discount rate 5-9%, the Value Momentum Investing table):
  1. DCF-20         operating cash flow (TTM) grown for 20 years, discounted, + cash - debt, / shares
  2. DFCF-20        the same on free cash flow
  3. DNI-20         the same on net income before extraordinary items (EPS without NRI x shares)
  4. DFCF-Terminal  free cash flow for 10 years + a terminal value growing 2.5% forever
  Growth: years 1-5 = projected growth; years 6-10 = half of it (but not below 4%, or below the projected growth when it's
  under 4%); years 11-20 = 4% (or the years 6-10 rate when lower).
Multiple methods (the company's own 10 fiscal years of ratios):
  5. Mean P/S x sales per share     6. Mean P/E without NRI x EPS     7. Mean P/B x book value per share
Growth methods:
  8. PSG: mean P/S x sales per share x (projected growth / the company's own 5-year sales growth)
  9. PEG: EPS x fair P/E, where fair P/E = growth % + dividend yield % (Peter Lynch, PEG = 1)
OptiIQ Value = sum of the 9 values / number of methods that could be calculated. Zero and negative values count.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

LONG_RUN_GROWTH = 0.04   # years 11-20 of the 20-year models
TERMINAL_GROWTH = 0.025  # perpetual growth after year 10 (DFCF-Terminal)
DEFAULT_BETA = 1.0
METHODS = [
    ("dcf20", "Discounted Cash Flow 20-year", "DCF-20"),
    ("dfcf20", "Discounted Free Cash Flow 20-year", "DFCF-20"),
    ("dni20", "Discounted Net Income 20-year", "DNI-20"),
    ("dfcf_terminal", "Discounted Free Cash Flow Terminal", "DFCF-Terminal"),
    ("mean_ps", "Mean Price to Sales (PS) Ratio", "Mean PS"),
    ("mean_pe", "Mean Price to Earnings (PE) Ratio Without NRI", "Mean PE"),
    ("mean_pb", "Mean Price to Book (PB) Ratio", "Mean PB"),
    ("psg", "Price to Sales Growth (PSG) Ratio", "PSG"),
    ("peg", "Price to Earnings Growth (PEG) Ratio Without NRI", "PEG"),
]


def _clamp(x: float, lo: float, hi: float) -> float:
    return min(max(x, lo), hi)


def beta_rate(beta: Optional[float]) -> float:
    """Beta table: <=0.8 -> 5%, 1.0 -> 6%, 1.1 -> 6.5%, 1.2 -> 7% ... 1.5 -> 8.5%, >=1.6 -> 9%."""
    b = round(beta if beta else DEFAULT_BETA, 1)
    return round(_clamp(0.05 + (b - 0.8) * 0.05, 0.05, 0.09), 4)


def _ttm(rows: List[Dict[str, Any]], key: str) -> Optional[float]:
    vals = [r.get(key) for r in rows[-4:]]
    return sum(vals) if len(vals) == 4 and all(v is not None for v in vals) else None


def _consensus_growth(rows: List[Dict[str, Any]], estimates: Optional[List[Dict[str, Any]]]) -> Optional[float]:
    """Analyst consensus revenue for the coming quarters vs the same fiscal quarters a year earlier (seasons cancel out)."""
    by_q = {(r.get("fiscal_year"), r.get("fiscal_quarter")): r.get("revenue") for r in rows}
    est = ya = 0.0
    for e in estimates or []:
        prev = by_q.get((e.get("year", 0) - 1, e.get("quarter")))
        if e.get("revenue_estimate") and prev and prev > 0:
            est, ya = est + e["revenue_estimate"], ya + prev
    return est / ya - 1 if ya else None


def _latest_quarter_yoy(rows: List[Dict[str, Any]], metrics: Dict[str, Any]) -> Optional[float]:
    if rows:
        last = rows[-1]
        prev = next((r.get("revenue") for r in rows if r.get("fiscal_year") == (last.get("fiscal_year") or 0) - 1
                     and r.get("fiscal_quarter") == last.get("fiscal_quarter")), None)
        if last.get("revenue") and prev and prev > 0:
            return last["revenue"] / prev - 1
    q = metrics.get("revenue_growth_q_yoy")
    return q / 100 if q is not None else None


def projected_growth(rows: List[Dict[str, Any]], metrics: Dict[str, Any], estimates) -> tuple:
    """Years 1-5 growth: average of the forward and historical growth rates available, -10% to +30%."""
    c = _consensus_growth(rows, estimates)
    pct = lambda k: metrics[k] / 100 if metrics.get(k) is not None else None
    ins = [("Analyst consensus, coming quarters vs a year ago", c) if c is not None else
           ("Sales, last 12 months vs the 12 before", pct("revenue_growth_ttm")),
           ("Sales, latest quarter vs a year ago", _latest_quarter_yoy(rows, metrics)),
           ("EPS growth, last 5 years (per year)", pct("eps_growth_5y")),
           ("Sales growth, last 5 years (per year)", pct("revenue_growth_5y"))]
    ins = [(k, _clamp(v, -0.5, 1.0)) for k, v in ins if v is not None]
    g1 = _clamp(sum(v for _, v in ins) / len(ins), -0.10, 0.30) if ins else 0.05
    return g1, [{"label": k, "pct": round(v * 100, 1)} for k, v in ins]


def stage_rates(g1: float) -> tuple:
    g2 = max(min(g1, LONG_RUN_GROWTH), g1 / 2)
    return g1, g2, min(LONG_RUN_GROWTH, g2)


def _pv(base: float, rates: List[float], r: float) -> tuple:
    """PV of a cash stream growing at rates[t-1] in year t; returns (pv, last year's amount)."""
    pv, cf = 0.0, base
    for t, g in enumerate(rates, start=1):
        cf *= 1 + g
        pv += cf / (1 + r) ** t
    return pv, cf


def _cash_debt(rows: List[Dict[str, Any]], metrics: Dict[str, Any], shares: float) -> tuple:
    """Latest filing that reports each item (the newest 10-Q often comes without a balance sheet)."""
    cb = next((r for r in reversed(rows) if r.get("cash") is not None), {})
    db = next((r for r in reversed(rows) if r.get("total_debt") is not None), {})
    cash = cb.get("cash_and_investments") if cb.get("cash_and_investments") is not None else cb.get("cash")
    if cash is None:
        cash = (metrics.get("cash_per_share_q") or 0) * shares
    debt = db.get("total_debt")
    if debt is None:
        de, bvps = metrics.get("debt_to_equity_q"), metrics.get("book_value_per_share_q")
        debt = de * bvps * shares if de and bvps and bvps > 0 else 0.0
    return cash, debt


def optiiq_value(price: float, metrics: Dict[str, Any], financials: List[Dict[str, Any]], sector: str = "", ticker: str = "",
                 estimates: Optional[List[Dict[str, Any]]] = None) -> Dict[str, Any]:
    mc = metrics.get("market_cap")
    if not price or not mc:
        return {"available": False, "reason": "Market data unavailable"}
    eps = metrics.get("eps_ttm")
    if (eps or 0) > price:  # P/E below 1: per-share data doesn't match this share price (e.g. share-class mix-up)
        return {"available": False, "reason": "Company data looks inconsistent, so no value is shown"}
    rows = financials or []
    shares = mc / price
    cash, debt = _cash_debt(rows, metrics, shares)
    net_cash_ps = (cash - debt) / shares

    ocf = mc / metrics["pcf_ttm"] if metrics.get("pcf_ttm") else _ttm(rows, "operating_cash_flow")
    if ocf is None and metrics.get("ocf_ps_ttm") is not None:
        ocf = metrics["ocf_ps_ttm"] * shares
    fcf = mc / metrics["pfcf_ttm"] if metrics.get("pfcf_ttm") else _ttm(rows, "free_cash_flow")
    ni = eps * shares if eps is not None else _ttm(rows, "net_income")
    sales_ps, bvps = metrics.get("revenue_ps_ttm"), metrics.get("book_value_per_share_q")
    pe_m, ps_m, pb_m = metrics.get("pe_mean_10y"), metrics.get("ps_mean_10y"), metrics.get("pb_mean_10y")
    yrs = metrics.get("mean_years") or {}

    r = beta_rate(metrics.get("beta"))
    g1, growth_inputs = projected_growth(rows, metrics, estimates)
    g1, g2, g3 = stage_rates(g1)
    rates20 = [g1] * 5 + [g2] * 5 + [g3] * 10
    g_hist = metrics.get("revenue_growth_5y")
    dy = metrics.get("dividend_yield") or 0.0
    b = lambda v: f"${v / 1e9:,.2f}B" if abs(v) >= 1e9 else f"${v / 1e6:,.0f}M"
    stages = f"growing {g1 * 100:.1f}% a year for years 1-5, {g2 * 100:.1f}% for 6-10 and {g3 * 100:.1f}% for 11-20"

    def dcf20(base: Optional[float], what: str):
        if base is None:
            return None, f"No {what} reported"
        pv, _ = _pv(base, rates20, r)
        return (pv + cash - debt) / shares, (f"{what} {b(base)} (last 12 months), {stages}, discounted at {r * 100:.1f}%: "
                                             f"{b(pv)} + cash {b(cash)} − debt {b(debt)}, ÷ {shares / 1e6:,.0f}M shares")

    def dfcf_terminal():
        if fcf is None:
            return None, "No free cash flow reported"
        pv, last = _pv(fcf, rates20[:10], r)
        gt = min(TERMINAL_GROWTH, g2)
        pv_tv = last * (1 + gt) / (r - gt) / (1 + r) ** 10
        return ((pv + pv_tv + cash - debt) / shares,
                f"Free cash flow {b(fcf)} for 10 years ({g1 * 100:.1f}% then {g2 * 100:.1f}%) = {b(pv)}, plus a terminal value growing "
                f"{gt * 100:.1f}% forever = {b(pv_tv)} today, discounted at {r * 100:.1f}%, + cash − debt, ÷ shares")

    def multiple(mean: Optional[float], base: Optional[float], what: str, ratio: str, key: str):
        if mean is None or base is None:
            return None, f"No {ratio} history or {what}"
        return mean * base, f"{yrs.get(key, 10)}-year average {ratio} {mean:.2f} × {what} ${base:,.2f}"

    def psg():
        if ps_m is None or sales_ps is None or g_hist is None:
            return None, "No P/S or 5-year sales growth history"
        gh = max(g_hist / 100, 0.03)
        k = _clamp(g1 / gh, -1.0, 3.0)
        return (ps_m * sales_ps * k,
                f"Average P/S {ps_m:.2f} × sales per share ${sales_ps:,.2f} × projected growth {g1 * 100:.1f}% ÷ its own 5-year "
                f"sales growth {gh * 100:.1f}% (what the market usually pays per point of sales growth)")

    def peg():
        if eps is None:
            return None, "No EPS reported"
        fair_pe = max(g1 * 100 + dy, 0.0)
        return eps * fair_pe, f"EPS ${eps:,.2f} × fair P/E {fair_pe:.1f} (growth {g1 * 100:.1f}% + dividend yield {dy:.1f}%, PEG = 1)"

    calc = {
        "dcf20": dcf20(ocf, "Operating cash flow"),
        "dfcf20": dcf20(fcf, "Free cash flow"),
        "dni20": dcf20(ni, "Net income"),
        "dfcf_terminal": dfcf_terminal(),
        "mean_ps": multiple(ps_m, sales_ps, "sales per share", "P/S", "ps"),
        "mean_pe": multiple(pe_m, eps, "EPS without NRI", "P/E", "pe"),
        "mean_pb": multiple(pb_m, bvps, "book value per share", "P/B", "pb"),
        "psg": psg(),
        "peg": peg(),
    }
    methods = []
    for key, label, short in METHODS:
        v, note = calc[key]
        methods.append({"key": key, "label": label, "short": short, "value": round(v, 2) if v is not None else None,
                        "vs_price_pct": round((v / price - 1) * 100, 1) if v is not None else None, "note": note})
    vals = [m["value"] for m in methods if m["value"] is not None]
    base = {"price": round(price, 2), "model": "nine", "methods": methods, "count": len(vals),
            "method": ("OptiIQ Value = the average of 9 valuation methods: 4 discounted cash-flow / earnings models (20-year and terminal), "
                       "the company's own 10-year average P/S, P/E and P/B, and the PSG and PEG growth ratios. Zero and negative results count."),
            "inputs": {"growth": {"years_1_5": round(g1, 6), "years_6_10": round(g2, 6), "years_11_20": round(g3, 6),
                                  "terminal": min(TERMINAL_GROWTH, g2), "inputs": growth_inputs},
                       "discount_rate": r, "beta": metrics.get("beta"), "cash": round(cash), "debt": round(debt), "shares": round(shares),
                       "net_cash_ps": round(net_cash_ps, 2), "dividend_yield": dy}}
    if not vals:
        return {"available": False, "reason": "Not enough company data for any valuation method", **base}
    avg = sum(vals) / len(vals)
    if avg <= 0:
        return {"available": False, "reason": f"The {len(vals)} methods average −${abs(avg):,.2f}, below zero (losses or negative cash flow)", **base}
    if avg > 10 * price:  # e.g. share-class mix-ups or a broken market cap
        return {"available": False, "reason": "Company data looks inconsistent, so no value is shown", **base}
    out = {"available": True, "value": round(avg, 2), "upside_pct": round((avg / price - 1) * 100, 1), **base}
    if avg > 3 * price or avg < price / 4:
        out["confidence"] = "low"
        out["confidence_note"] = "The methods land far from the market price, so treat this value with caution."
    return out
