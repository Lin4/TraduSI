# Iteration 30: retest of iter29 issues - OptiIQ drives intrinsic_value / AI thesis, utilities excess-return,
# low-confidence flag, DCF details (fcf_source, interest addback, floors), board outliers, buy-levels regression
import os
import time
import json
import pytest
import requests
from test_iter29_optiiq_dcf_buy_levels import check_buy, BASE_URL, EMAIL, PASSWORD

_cache = {}
DUMP = "/tmp/iter30_dump.json"


@pytest.fixture(scope="module")
def hdr():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": EMAIL, "password": PASSWORD}, timeout=20)
    if r.status_code != 200:
        pytest.skip(f"login failed {r.status_code}")
    return {"Authorization": f"Bearer {r.json()['session_token']}"}


def analyze(hdr, tk):
    if tk in _cache:
        return _cache[tk]
    d = {}
    for attempt in range(2):
        r = requests.post(f"{BASE_URL}/api/screener/stock-analysis", json={"ticker": tk, "purpose": "long"}, headers=hdr, timeout=150)
        assert r.status_code == 200, f"{tk}: {r.status_code} {r.text[:300]}"
        d = r.json().get("result", {})
        o = d.get("optiiq") or {}
        if o.get("available") or attempt == 1:
            break
        time.sleep(45)
    _cache[tk] = d
    try:
        dump = json.load(open(DUMP)) if os.path.exists(DUMP) else {}
    except Exception:
        dump = {}
    dump[tk] = {k: d.get(k) for k in ("price", "intrinsic_value", "intrinsic_line", "optiiq", "buy_levels", "buy_summary", "ai_summary", "verdict", "confidence")}
    json.dump(dump, open(DUMP, "w"), default=str)
    return d


def check_intrinsic_link(d, tk):
    o = d["optiiq"]
    il = d["intrinsic_line"]
    if o.get("available") and o.get("confidence") != "low":
        assert d["intrinsic_value"] == o["value"], f"{tk} intrinsic_value {d['intrinsic_value']} != optiiq {o['value']}"
        assert il["value"] == o["value"] and il["source"] == "OptiIQ Value", f"{tk} {il}"
    else:
        assert d["intrinsic_value"] is None and il["value"] is None, f"{tk} {il}"
    s = (d.get("ai_summary") or "")
    assert "weighted value" not in s.lower(), f"{tk} thesis still uses old DCF weighted value: {s[:300]}"
    if o.get("available"):
        assert "optiiq" in s.lower(), f"{tk} thesis does not mention OptiIQ Value: {s[:300]}"


def check_dcf_details(o, tk):
    assert o["model"] == "dcf"
    assert o.get("fcf_source"), tk
    assert o["interest_addback"] >= 0
    assert o["start_cf"] > -1e15 and o["steady_cf"] > 0
    g = o["growth"]
    assert isinstance(g["stage2_floored"], bool) and isinstance(g["capped_by_revenue"], bool)
    assert g["stage2_floored"] == (g["stage2"] > g["stage1"] / 2 + 1e-9) or abs(g["stage2"] - g["stage1"] / 2) < 0.0002
    revs = [x["pct"] for x in g["inputs"] if x["label"].startswith("Revenue")]
    if revs:
        revs.sort()
        n = len(revs)
        med = revs[n // 2] if n % 2 else (revs[n // 2 - 1] + revs[n // 2]) / 2
        assert g["stage1"] <= max(med / 100 + 0.05, 0) + 0.0015, f"{tk} stage1 {g['stage1']} > rev median {med}+5"
    dsc = o["discount"]
    assert isinstance(dsc["wacc_floored"], bool) and dsc["wacc_formula"] > 0
    assert dsc["wacc"] >= dsc["wacc_formula"] - 0.0001
    if not dsc["wacc_floored"]:
        assert abs(dsc["wacc"] - dsc["wacc_formula"]) < 0.0002
    ys = o["years"]
    assert len(ys) == 10 and all(isinstance(y["year"], int) and y["year"] > 2000 for y in ys), f"{tk} years {[y['year'] for y in ys]}"
    assert abs(o["pv_cash_flows"] + o["pv_terminal"] - o["value_of_operations"]) <= 2
    assert abs(o["value_of_operations"] + o["cash"] - o["debt"] - o["equity_value"]) <= 2
    assert abs(o["equity_value"] / o["shares"] - o["value"]) <= max(0.02, o["value"] * 0.001)
    if o["start_cf"] == o["steady_cf"]:
        assert "well below steady-state" not in o["cf_note"], f"{tk} cf_note {o['cf_note']}"


def check_conf(o, tk):
    if not o.get("available"):
        return
    r = o["value"] / o["price"]
    if r > 3 or r < 0.25:
        assert o.get("confidence") == "low" and o.get("confidence_note"), f"{tk} ratio {r} not flagged low"
    else:
        assert o.get("confidence") != "low", f"{tk} ratio {r} wrongly flagged low"


# (1) intrinsic_value / intrinsic_line / AI thesis use OptiIQ (MSFT dcf, JPM bank)
@pytest.mark.parametrize("tk", ["MSFT", "JPM"])
def test_intrinsic_is_optiiq(hdr, tk):
    d = analyze(hdr, tk)
    check_intrinsic_link(d, tk)
    print(tk, d["intrinsic_value"], d["optiiq"].get("value"), d.get("verdict"), d.get("ai_summary", "")[:250])


# (2) DCF details for non-financials + payments
@pytest.mark.parametrize("tk", ["MSFT", "V", "MA"])
def test_dcf_details(hdr, tk):
    d = analyze(hdr, tk)
    o = d["optiiq"]
    assert o.get("available"), o
    check_dcf_details(o, tk)
    check_conf(o, tk)
    check_intrinsic_link(d, tk)
    print(tk, o["value"], o["price"], o["fcf_source"], o["interest_addback"], o["start_cf"], o["steady_cf"], o["cf_note"], o["growth"], o["discount"]["wacc"], o["discount"]["wacc_formula"])


# (3) Utilities + banks use excess-return model
@pytest.mark.parametrize("tk,who", [("DUK", "Regulated utilities"), ("CMS", "Regulated utilities"), ("JPM", "Banks")])
def test_excess_return_models(hdr, tk, who):
    d = analyze(hdr, tk)
    o = d["optiiq"]
    assert o.get("available"), o
    assert o["model"] == "excess_return", f"{tk} model {o['model']}"
    assert o["method"].startswith(who), o["method"]
    exp = o["book_value_ps"] * (o["roe_used"] - o["growth_lt"]) / (o["discount"]["cost_of_equity"] - o["growth_lt"])
    assert abs(exp - o["value"]) <= max(0.05, o["value"] * 0.002), f"{tk} {exp} vs {o['value']}"
    check_conf(o, tk)
    check_intrinsic_link(d, tk)
    print(tk, o["value"], o["price"], o["book_value_ps"], o["roe_used"], o["discount"]["cost_of_equity"])


# (4) Buy levels regression + step fallback >= 50% of price
@pytest.mark.parametrize("tk", ["MSFT", "DUK", "JPM", "V"])
def test_buy_levels(hdr, tk):
    d = analyze(hdr, tk)
    check_buy(d, tk)
    for b in d["buy_levels"]:
        if b.get("source") == "step":
            assert b["price"] >= d["price"] * 0.5 - 0.01, f"{tk} step level {b['price']} < 50% of {d['price']}"
    print(tk, [(b["label"], b["price"], b.get("source"), b["strength"]) for b in d["buy_levels"]])


# (5) Board: no bucketed outliers; low-confidence stocks go to unrated with the right reason
def test_board_no_outliers(hdr):
    r = requests.get(f"{BASE_URL}/api/valuation/board", headers=hdr, timeout=90)
    assert r.status_code == 200, r.text[:300]
    j = r.json()
    json.dump(j, open("/tmp/iter30_board.json", "w"), default=str)
    rows = j.get("stocks") or []  # [{t, n, s, p (price), v (value), d (premium %), b (bucket)}]
    assert rows, "no bucketed stocks"
    assert sum(b["count"] for b in j["buckets"]) == len(rows)
    print("board bucketed", len(rows), "unrated", len(j.get("unrated") or []))
    bad = []
    for s in rows:
        p, v, prem = s["p"], s["v"], s["d"]
        assert abs((p / v - 1) * 100 - prem) <= 0.2, f"{s} premium mismatch"
        if prem > 300 or v > 4 * p or v > 3 * p or v < p / 4:
            bad.append((s["t"], p, v, prem))
    assert not bad, f"outliers in buckets: {bad[:20]}"
    far = [u for u in (j.get("unrated") or []) if "far from the price" in (u.get("why") or "")]
    print("far-from-price unrated:", len(far), [u["t"] for u in far[:30]])


# (6) Low-confidence: board 'far from the price' names flagged low live -> intrinsic_line null
@pytest.mark.parametrize("tk", ["INTC"])
def test_low_confidence_live(hdr, tk):
    d = analyze(hdr, tk)
    o = d["optiiq"]
    print(tk, o.get("available"), o.get("model"), o.get("value"), o.get("price"), o.get("confidence"), o.get("reason"))
    check_conf(o, tk)
    check_intrinsic_link(d, tk)
    if o.get("confidence") == "low":
        assert d["intrinsic_line"]["value"] is None and d["intrinsic_value"] is None
