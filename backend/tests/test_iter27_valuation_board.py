"""Iteration 27 - S&P 500 valuation board, buy-levels in long-term stock-analysis, and price alerts.

Covers:
- GET /api/valuation/board auth + shape + bucket math (progress may be < 503, that's expected).
- Consistency: board stock `v` vs stock-analysis `optiiq.value` for the same ticker.
- POST /api/screener/stock-analysis purpose=long now returns intrinsic_line + buy_levels + price_history.
- POST /api/alerts/add kind=price_below + GET /api/alerts + DELETE cleanup.
"""
from __future__ import annotations

import os
import time
import pytest
import requests

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")
EMAIL = "trader@optiscreen.app"
PASSWORD = "TestPass123!"


# ---------- fixtures ----------
@pytest.fixture(scope="module")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def token(api):
    r = api.post(f"{BASE_URL}/api/auth/login", json={"email": EMAIL, "password": PASSWORD}, timeout=30)
    assert r.status_code == 200, r.text
    tok = r.json().get("session_token") or r.json().get("token")
    assert tok, r.text
    return tok


@pytest.fixture(scope="module")
def auth(token):
    return {"Authorization": f"Bearer {token}"}


# ---------- board ----------
class TestValuationBoard:
    def test_requires_auth(self, api):
        r = api.get(f"{BASE_URL}/api/valuation/board", timeout=20)
        assert r.status_code == 401

    def test_shape_and_bucket_math(self, api, auth):
        r = api.get(f"{BASE_URL}/api/valuation/board", headers=auth, timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        # buckets
        ids = [b["id"] for b in d["buckets"]]
        assert ids == ["very_under", "under", "fair", "over", "very_over"]
        for b in d["buckets"]:
            assert {"id", "label", "range", "count"} <= set(b.keys())
            assert isinstance(b["count"], int) and b["count"] >= 0
        # progress
        assert d["progress"]["total"] == 503
        assert 0 <= d["progress"]["valued"] <= 503
        # sectors (11 GICS)
        assert isinstance(d["sectors"], list)
        assert 10 <= len(d["sectors"]) <= 12
        # stocks fields
        for x in d["stocks"][:5]:
            assert set(x.keys()) >= {"t", "n", "s", "p", "v", "d", "b"}
        # bucket math on each stock
        def expected(dp):
            if dp < -30: return "very_under"
            if dp < -10: return "under"
            if dp <= 10: return "fair"
            if dp <= 30: return "over"
            return "very_over"
        for x in d["stocks"]:
            calc = (x["p"] / x["v"] - 1) * 100
            # d is rounded to 1 decimal; allow tiny tolerance
            assert abs(calc - x["d"]) < 0.5, (x, calc)
            assert x["b"] == expected(x["d"]), x
        # counts match
        counts = {b["id"]: 0 for b in d["buckets"]}
        for x in d["stocks"]:
            counts[x["b"]] += 1
        for b in d["buckets"]:
            assert b["count"] == counts[b["id"]], (b, counts)
        # stash for next tests
        TestValuationBoard.board = d

    def test_board_contains_known_ticker(self, api, auth):
        d = getattr(TestValuationBoard, "board", None) or api.get(f"{BASE_URL}/api/valuation/board", headers=auth, timeout=30).json()
        tickers = {x["t"] for x in d["stocks"]}
        # should contain at least a handful of valued names already
        assert len(tickers) >= 1, "no valued stocks yet"


# ---------- stock-analysis long-term ----------
LONG_TICKERS = ["ABT", "AMZN"]


class TestStockAnalysisLong:
    @pytest.fixture(scope="class")
    def analysis(self, api, auth):
        out = {}
        for tk in LONG_TICKERS:
            r = api.post(f"{BASE_URL}/api/screener/stock-analysis",
                         json={"ticker": tk, "purpose": "long"}, headers=auth, timeout=60)
            out[tk] = (r.status_code, r.json() if r.ok else r.text)
            time.sleep(1)
        return out

    def test_long_returns_intrinsic_line_and_buy_levels(self, analysis):
        for tk, (code, body) in analysis.items():
            assert code == 200, f"{tk} failed: {body}"
            result = body.get("result") or body
            # intrinsic_line
            il = result.get("intrinsic_line")
            assert il and il.get("value"), f"{tk} missing intrinsic_line: {result.keys()}"
            assert il.get("source") in ("OptiIQ Value", "Probability-weighted DCF")
            # buy_levels
            bl = result.get("buy_levels")
            assert isinstance(bl, list) and 1 <= len(bl) <= 4, f"{tk} buy_levels={bl}"
            # labels B1..Bn sorted price DESC
            labels = [x["label"] for x in bl]
            assert labels == [f"B{i+1}" for i in range(len(bl))], labels
            prices = [x["price"] for x in bl]
            assert prices == sorted(prices, reverse=True), prices
            # cap: price < min(current, intrinsic)*0.99
            price_now = result.get("price") or (result.get("quote") or {}).get("price")
            cap = min(price_now, il["value"]) * 0.99 if price_now and il.get("value") else None
            for lv in bl:
                assert lv["below_price_pct"] < 0, lv
                assert lv["source"] in ("history", "step")
                if lv["source"] == "history":
                    assert lv.get("touches", 0) >= 2
                    assert lv.get("last_touch")
                else:
                    assert lv.get("step_pct")
                    assert lv.get("step_from") in ("price", "value")
                if cap:
                    assert lv["price"] < cap + 0.01, (lv, cap)
            # price_history ~500 points (2 years)
            ph = result.get("price_history")
            assert isinstance(ph, list), f"{tk} no price_history"
            assert 300 <= len(ph) <= 800, f"{tk} price_history len={len(ph)}"
            for row in ph[:3] + ph[-3:]:
                assert isinstance(row, list) and len(row) == 2
                assert isinstance(row[0], (int, float)) and row[0] > 1e11  # ms epoch
                assert isinstance(row[1], (int, float))

    def test_consistency_with_board(self, api, auth, analysis):
        board = api.get(f"{BASE_URL}/api/valuation/board", headers=auth, timeout=30).json()
        by_t = {x["t"]: x for x in board["stocks"]}
        checked = 0
        for tk, (code, body) in analysis.items():
            if tk not in by_t:
                continue
            result = body.get("result") or body
            an_v = (result.get("optiiq") or {}).get("value") or (result.get("intrinsic_line") or {}).get("value")
            bd_v = by_t[tk]["v"]
            assert an_v and bd_v
            diff = abs(an_v - bd_v) / bd_v
            assert diff < 0.05, f"{tk} analysis v={an_v} board v={bd_v} diff={diff:.2%}"
            checked += 1
        if not checked:
            pytest.skip("No board overlap with analyzed tickers yet (board still building)")

    def test_non_sp500_long_still_works(self, api, auth):
        # Try several non-S&P names; after-hours Tradier sometimes drops quotes for less liquid names.
        last = None
        for tk in ("TSM", "SHOP", "BABA", "SE", "MELI"):
            r = api.post(f"{BASE_URL}/api/screener/stock-analysis",
                         json={"ticker": tk, "purpose": "long"}, headers=auth, timeout=60)
            last = (tk, r.status_code, r.text[:200])
            if r.status_code == 200:
                body = r.json()
                result = body.get("result") or body
                assert result.get("intrinsic_line") or result.get("optiiq")
                return
            time.sleep(0.5)
        pytest.skip(f"No live quotes available for non-S&P tickers right now (last={last})")


# ---------- price alerts (buy level) ----------
class TestPriceAlerts:
    created_ids: list = []

    def test_create_and_list_buy_level_alert(self, api, auth):
        # Pick a very low threshold so it won't trigger during market hours
        payload = {"ticker": "ABT", "kind": "price_below", "threshold": 1.00, "note": "Buy level B1"}
        r = api.post(f"{BASE_URL}/api/alerts/add", json=payload, headers=auth, timeout=30)
        assert r.status_code in (200, 201), r.text
        body = r.json()
        aid = body.get("alert_id") or (body.get("alert") or {}).get("alert_id") or body.get("id")
        assert aid, body
        TestPriceAlerts.created_ids.append(aid)

        # List
        r2 = api.get(f"{BASE_URL}/api/alerts", headers=auth, timeout=30)
        assert r2.status_code == 200, r2.text
        body = r2.json()
        items = body.get("items") if isinstance(body, dict) else body
        if items is None and isinstance(body, dict):
            items = body.get("alerts", [])
        assert isinstance(items, list)
        match = next((a for a in items if (a.get("alert_id") or a.get("id")) == aid), None)
        assert match, f"created alert {aid} not in list"
        assert match.get("kind") == "price_below"
        assert match.get("ticker") == "ABT"
        assert float(match.get("threshold")) == 1.00
        assert match.get("note") == "Buy level B1"
        assert match.get("active") in (True, 1)

    def test_delete_cleanup(self, api, auth):
        for aid in list(TestPriceAlerts.created_ids):
            r = api.delete(f"{BASE_URL}/api/alerts/{aid}", headers=auth, timeout=30)
            assert r.status_code in (200, 204), r.text
        TestPriceAlerts.created_ids.clear()
        # verify gone
        r2 = api.get(f"{BASE_URL}/api/alerts", headers=auth, timeout=30)
        body = r2.json()
        items = body.get("items") if isinstance(body, dict) else body
        if items is None and isinstance(body, dict):
            items = body.get("alerts", [])
        items = items or []
        remaining = [a for a in items if (a.get("note") == "Buy level B1" and float(a.get("threshold", 0)) == 1.00 and a.get("ticker") == "ABT")]
        assert not remaining
