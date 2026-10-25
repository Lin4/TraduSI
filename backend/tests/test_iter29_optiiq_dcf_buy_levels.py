# Iteration 29: OptiIQ DCF (WACC/CAPM, 10y FCF, terminal), excess-return for banks, buy levels + overlay
import os
import time
import pytest
import requests

def _env_url():
    if os.environ.get("EXPO_PUBLIC_BACKEND_URL"):
        return os.environ["EXPO_PUBLIC_BACKEND_URL"]
    for line in open("/app/frontend/.env"):
        if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
            return line.split("=", 1)[1].strip().strip('"')


BASE_URL = _env_url().rstrip("/")
EMAIL, PASSWORD = "trader@optiscreen.app", "TestPass123!"
_cache = {}


@pytest.fixture(scope="module")
def hdr():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": EMAIL, "password": PASSWORD}, timeout=20)
    if r.status_code != 200:
        pytest.skip(f"login failed {r.status_code}")
    return {"Authorization": f"Bearer {r.json()['session_token']}"}


def analyze(hdr, tk):
    if tk in _cache:
        return _cache[tk]
    for attempt in range(2):
        r = requests.post(f"{BASE_URL}/api/screener/stock-analysis", json={"ticker": tk, "purpose": "long"}, headers=hdr, timeout=120)
        assert r.status_code == 200, f"{tk}: {r.status_code} {r.text[:300]}"
        d = r.json()
        d = d.get("result", d)
        o = d.get("optiiq") or {}
        if o.get("available") or attempt == 1:
            break
        if "Market data" in (o.get("reason") or ""):
            time.sleep(60)
    _cache[tk] = d
    return d


def check_dcf(o, tk):
    assert o.get("available") is True, f"{tk} optiiq unavailable: {o}"
    assert o["model"] == "dcf", f"{tk} model={o.get('model')}"
    assert o["value"] > 0
    assert abs(o["upside_pct"] - round((o["value"] / o["price"] - 1) * 100, 1)) <= 0.2
    ys = o["years"]
    assert len(ys) == 10 and all({"year", "t", "fcf", "pv"} <= set(y) for y in ys)
    assert [y["t"] for y in ys] == list(range(1, 11))
    d = o["discount"]
    assert d["risk_free"] == 0.045 and d["mrp"] == 0.06
    assert 0.8 <= d["beta"] <= 1.5
    assert abs(d["cost_of_equity"] - (d["risk_free"] + d["beta"] * d["mrp"])) < 0.0006
    assert abs(d["weight_equity"] + d["weight_debt"] - 1) < 0.0002
    formula = d["cost_of_equity"] * d["weight_equity"] + d["cost_of_debt_after_tax"] * d["weight_debt"]
    assert d["wacc"] >= formula - 0.0006, f"{tk} wacc {d['wacc']} < formula {formula}"
    g = o["growth"]
    assert 0 <= g["stage1"] <= 0.25 and 0.03 <= g["long_term"] <= 0.05
    assert abs(g["stage2"] - max(g["stage1"] / 2, g["long_term"])) < 0.0002
    assert isinstance(g["inputs"], list)
    assert abs(o["pv_cash_flows"] + o["pv_terminal"] - o["value_of_operations"]) <= 2
    assert abs(sum(y["pv"] for y in ys) - o["pv_cash_flows"]) <= 10
    assert abs(o["value_of_operations"] + o["cash"] - o["debt"] - o["equity_value"]) <= 2
    assert abs(o["equity_value"] / o["shares"] - o["value"]) <= max(0.02, o["value"] * 0.001)
    bc = o["beta_check"]
    assert [b["beta"] for b in bc] == [0.75, 1.0, 1.25]
    vals = [b["value"] for b in bc]
    assert all(v for v in vals) and vals[0] >= vals[1] >= vals[2], f"{tk} beta_check {vals}"
    return d


def check_buy(d, tk):
    price = d["price"]
    bl = d["buy_levels"]
    assert 1 <= len(bl) <= 4
    assert [b["label"] for b in bl] == [f"B{i}" for i in range(1, len(bl) + 1)]
    ps = [b["price"] for b in bl]
    assert ps == sorted(ps, reverse=True), f"{tk} not sorted {ps}"
    for b in bl:
        assert b["price"] < price and b["below_price_pct"] < 0
        assert b["strength"] in ("Strong", "Moderate", "Light")
        assert b["reasons"] and all(isinstance(x, str) and x for x in b["reasons"])
        assert isinstance(b.get("signals"), list)
    for a, b in zip(ps, ps[1:]):
        assert a / b - 1 >= 0.029, f"{tk} levels too close {ps}"
    ov = d["buy_overlay"]
    n = len(d["price_history"])
    assert len(ov["sma50"]) == n and len(ov["sma200"]) == n
    assert ov["sma50"][0] is None and ov["sma200"][0] is None
    if ov["fib"]:
        assert len(ov["fib"]["levels"]) == 5 and ov["fib"]["low"] < ov["fib"]["high"]
    assert all(len(r) == 3 and r[2] in ("low", "high") for r in ov["reversals"])
    assert isinstance(d["buy_summary"], str) and d["buy_summary"]


# OptiIQ DCF for non-financials
@pytest.mark.parametrize("tk", ["MSFT", "AAPL", "KO"])
def test_dcf_non_financial(hdr, tk):
    d = analyze(hdr, tk)
    o = d["optiiq"]
    check_dcf(o, tk)
    print(tk, o["value"], o["price"], o["upside_pct"], o["discount"]["wacc"], o["growth"])


# Asset-light financials (payments) use DCF, same magnitude as price
@pytest.mark.parametrize("tk", ["V", "MA"])
def test_payments_dcf(hdr, tk):
    d = analyze(hdr, tk)
    o = d["optiiq"]
    check_dcf(o, tk)
    assert 0.3 <= o["value"] / o["price"] <= 3, f"{tk} value {o['value']} vs price {o['price']}"
    print(tk, o["value"], o["price"], o["upside_pct"])


# Bank uses excess return model
def test_jpm_excess_return(hdr):
    o = analyze(hdr, "JPM")["optiiq"]
    assert o.get("available"), o
    assert o["model"] == "excess_return"
    for k in ("book_value_ps", "roe_used"):
        assert o[k] > 0
    assert o["discount"]["cost_of_equity"] >= 0.08
    vals = [b["value"] for b in o["beta_check"]]
    assert len(vals) == 3 and vals[0] >= vals[1] >= vals[2]
    print("JPM", o["value"], o["price"], o["upside_pct"])


# Buy levels in the long response
@pytest.mark.parametrize("tk", ["MSFT", "AAPL", "KO", "V", "JPM"])
def test_buy_levels(hdr, tk):
    d = analyze(hdr, tk)
    check_buy(d, tk)
    print(tk, [(b["label"], b["price"], b["strength"], b["reasons"]) for b in d["buy_levels"]])


# Valuation board still works, V/MA without absurd premium
def test_valuation_board(hdr):
    r = requests.get(f"{BASE_URL}/api/valuation/board", headers=hdr, timeout=60)
    assert r.status_code == 200, r.text[:300]
    j = r.json()
    assert "buckets" in j or "stocks" in j, list(j)
    text = str(j)
    rows = j.get("stocks") or [s for b in (j.get("buckets") or []) for s in (b.get("stocks") or [])]
    print("board keys", list(j)[:10], "rows", len(rows), "len", len(text))
    for s in rows:
        if s.get("ticker") in ("V", "MA"):
            print(s)


def test_board_requires_auth():
    r = requests.get(f"{BASE_URL}/api/valuation/board", timeout=30)
    assert r.status_code == 401
