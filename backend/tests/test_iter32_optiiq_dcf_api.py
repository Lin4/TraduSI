# Iteration 32: API tests -- long-term stock analysis OptiIQ (revenue-driven DCF) + valuation board
import os
import time
import pytest
import requests

BASE_URL = (os.environ.get("EXPO_PUBLIC_BACKEND_URL") or os.environ.get("EXPO_BACKEND_URL") or
            open("/app/frontend/.env").read().split("EXPO_PUBLIC_BACKEND_URL=")[1].split()[0]).strip().strip('"').rstrip("/")
EMAIL, PW = "lingesa4@gmail.com", "Linges1@12"
_cache = {}


@pytest.fixture(scope="module")
def hdr():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": EMAIL, "password": PW}, timeout=30)
    if r.status_code != 200:
        pytest.skip(f"login failed {r.status_code}")
    return {"Authorization": f"Bearer {r.json()['session_token']}"}


def analyze(hdr, tk):
    if tk in _cache:
        return _cache[tk]
    t = time.time()
    r = requests.post(f"{BASE_URL}/api/screener/stock-analysis", json={"ticker": tk, "purpose": "long"}, headers=hdr, timeout=180)
    assert r.status_code == 200, f"{tk} {r.status_code} {r.text[:300]}"
    d = r.json()
    res = d.get("result", d)
    print(f"{tk}: {time.time() - t:.1f}s")
    _cache[tk] = res
    time.sleep(3)
    return res


# Long analysis returns the DCF OptiIQ payload, old valuation data, buy levels
@pytest.mark.parametrize("tk", ["MU", "NVDA", "PLTR", "MSFT"])
def test_long_dcf(hdr, tk):
    res = analyze(hdr, tk)
    o = res["optiiq"]
    print(tk, o.get("available"), o.get("value"), o.get("upside_pct"), o.get("confidence"), o.get("growth", {}).get("year1"),
          o.get("growth", {}).get("fade"), o.get("growth", {}).get("consensus_quarters"), o.get("discount", {}).get("wacc"),
          "earn", res.get("earnings_date"), "line", res.get("intrinsic_line"))
    assert o["available"] is True, o
    assert o["model"] == "dcf"
    assert len(o["years"]) == 10
    assert set(o["scenarios"]) == {"bear", "base", "bull"}
    assert {"year1", "terminal", "fade", "consensus_quarters", "inputs"} <= set(o["growth"])
    assert {"initial", "stable", "reported", "stock_pay_addback"} <= set(o["margin"])
    assert "wacc" in o["discount"] and len(o["beta_check"]) == 3
    assert -0.15 <= o["growth"]["year1"] <= 0.8
    assert o["upside_pct"] == pytest.approx((o["value"] / o["price"] - 1) * 100, abs=0.2)
    if o.get("confidence") == "low":
        assert res["intrinsic_line"]["value"] is None
    else:
        assert res["intrinsic_line"]["value"] == o["value"]
    assert res.get("valuation") and res.get("valuation_inputs")
    assert isinstance(res.get("buy_levels"), list)
    assert "buy_point" in res and "sell_point" in res


def test_jpm_bank_model(hdr):
    o = analyze(hdr, "JPM")["optiiq"]
    print("JPM", o)
    assert o.get("model") == "excess_return", o


# Finnhub earnings estimates + extended quarterly financials (direct module calls)
def test_market_estimates_and_financials():
    import asyncio, sys
    import httpx
    sys.path.insert(0, "/app/backend")
    from dotenv import load_dotenv
    load_dotenv("/app/backend/.env")
    import market

    async def go():
        async with httpx.AsyncClient() as c:
            e = await market.get_earnings(c, "MU")
            f = await market.get_quarterly_financials(c, "MU", 8)
            return e, f
    e, f = asyncio.run(go())
    print("estimates", e.get("estimates"), "date", e.get("date"))
    assert isinstance(e.get("estimates"), list)
    dates = [x["date"] for x in e["estimates"]]
    assert dates == sorted(dates)
    if e["estimates"]:
        assert e["date"] == e["estimates"][0]["date"]
        assert {"year", "quarter", "date", "revenue_estimate"} <= set(e["estimates"][0])
    assert f, "no financials"
    for k in ("fiscal_year", "fiscal_quarter", "operating_income", "dep_amort", "sbc", "receivables", "inventory", "payables", "deferred_revenue"):
        assert k in f[-1], k
    print([(r["label"], r["revenue"], r["operating_income"], r["sbc"]) for r in f])


# Valuation board still returns buckets/stocks/unrated
def test_board(hdr):
    r = requests.get(f"{BASE_URL}/api/valuation/board", headers=hdr, timeout=60)
    assert r.status_code == 200, r.text[:300]
    d = r.json()
    for k in ("buckets", "stocks", "unrated"):
        assert k in d, k
    print("board keys", list(d.keys()), "stocks", len(d["stocks"]), "unrated", len(d["unrated"]) if isinstance(d["unrated"], list) else d["unrated"])
