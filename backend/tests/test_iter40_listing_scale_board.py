"""Iteration 40 - foreign listing scale (SKHY, TSM), US listing_scale 1.0, board refill in optiiq_board, quick vs full parity."""
from __future__ import annotations

import os
import time

import pytest
import requests

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")
EMAIL = "lingesa4@gmail.com"
PASSWORD = "Linges1@12"
CASH = ["dcf20", "dfcf20", "dni20", "dfcf_terminal"]


@pytest.fixture(scope="module")
def auth():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": EMAIL, "password": PASSWORD}, timeout=30)
    if r.status_code != 200:
        pytest.skip(f"login failed {r.status_code}")
    return {"Authorization": f"Bearer {r.json()['session_token']}"}


def _quick(auth, tk, retry=True):
    t0 = time.time()
    r = requests.get(f"{BASE_URL}/api/valuation/optiiq/{tk}", headers=auth, timeout=90)
    dt = time.time() - t0
    if retry and r.status_code == 200 and not r.json()["optiiq"].get("available") and "temporarily" in (r.json()["optiiq"].get("reason") or ""):
        time.sleep(60)
        return _quick(auth, tk, retry=False)
    return r, dt


# SKHY: Korean-won per home-market share figures scaled to the US listing
class TestSKHY:
    def test_skhy_quick(self, auth):
        r, dt = _quick(auth, "SKHY")
        assert r.status_code == 200, r.text
        d = r.json()
        o = d["optiiq"]
        print(f"SKHY price={d['price']} dt={dt:.2f}s value={o.get('value')} conf={o.get('confidence')} "
              f"count={o.get('count')} scale={(o.get('inputs') or {}).get('listing_scale')} reason={o.get('reason')}")
        print("methods", [(m["short"], m.get("value"), m.get("status")) for m in o.get("methods") or []])
        assert o.get("available") is True, o
        k = o["inputs"]["listing_scale"]
        assert 0.00005 < k < 0.0003, k
        assert o["count"] >= 8
        assert 300 < o["value"] < 1200, o["value"]
        if o["value"] > 3 * d["price"]:
            assert o["confidence"] == "low"
        pytest.skhy = (d["price"], o["value"])

    def test_skhy_full_matches_quick(self, auth):
        r = requests.post(f"{BASE_URL}/api/screener/stock-analysis", headers=auth, json={"ticker": "SKHY", "purpose": "long"}, timeout=180)
        assert r.status_code == 200, r.text[:300]
        res = r.json()["result"]
        o = res.get("optiiq") or {}
        q, _ = _quick(auth, "SKHY")
        qo = q.json()["optiiq"]
        print(f"full value={o.get('value')} quick={qo.get('value')} full price={res.get('price')} quick price={q.json()['price']}")
        assert o.get("available") is True, o
        assert abs(o["value"] - qo["value"]) <= max(1.0, 0.01 * qo["value"]), (o["value"], qo["value"])
        assert abs(o["inputs"]["listing_scale"] - qo["inputs"]["listing_scale"]) / qo["inputs"]["listing_scale"] < 0.02

    def test_skhy_full_card_in_listing_terms(self, auth):
        """EPS, EPS-DCF scenarios, buy/sell point and 52-week range must be in the US listing's dollars too (not won)."""
        r = requests.post(f"{BASE_URL}/api/screener/stock-analysis", headers=auth, json={"ticker": "SKHY", "purpose": "long"}, timeout=180)
        res = r.json()["result"]
        p = res["price"]
        v = res.get("valuation") or {}
        print("eps", res.get("eps_ttm"), "weighted", v.get("weighted_value"), "buy", res.get("buy_point"), "52w", res.get("fifty_two_week_high"))
        assert (res.get("eps_ttm") or 0) < p
        assert (res.get("buy_point") or 0) < 20 * p
        assert (res.get("fifty_two_week_high") or 0) < 5 * p


# TSM ADR scale (~0.18) and US names scale 1.0
class TestScales:
    def test_tsm_scale(self, auth):
        r, _ = _quick(auth, "TSM")
        assert r.status_code == 200
        o = r.json()["optiiq"]
        k = (o.get("inputs") or {}).get("listing_scale")
        print(f"TSM value={o.get('value')} scale={k} price={r.json()['price']}")
        assert o.get("available") is True
        assert 0.1 < k < 0.3, k

    @pytest.mark.parametrize("tk", ["AAPL", "PLTR", "V", "UBER", "IBKR", "CVNA"])
    def test_us_scale_one(self, auth, tk):
        r, dt = _quick(auth, tk)
        assert r.status_code == 200
        o = r.json()["optiiq"]
        print(f"{tk} dt={dt:.2f}s value={o.get('value')} count={o.get('count')} scale={(o.get('inputs') or {}).get('listing_scale')}")
        assert o.get("available") is True, o
        assert o["inputs"]["listing_scale"] == 1.0


# Regression: JPM bank skip + speed for board names
class TestRegression:
    def test_jpm_skips_cash(self, auth):
        r, _ = _quick(auth, "JPM")
        o = r.json()["optiiq"]
        st = {m["key"]: m for m in o["methods"]}
        assert all(st[k]["value"] is None for k in CASH)
        assert all("skip" in (st[k].get("status") or st[k].get("note") or "").lower() or st[k].get("skipped") for k in CASH), [st[k] for k in CASH]

    @pytest.mark.parametrize("tk", ["AAPL", "PLTR", "JPM"])
    def test_fast(self, auth, tk):
        _quick(auth, tk)
        r, dt = _quick(auth, tk)
        print(f"{tk} warm dt={dt:.2f}s")
        assert dt < 1.5, dt


# Board refill in its own collection
class TestBoard:
    def test_board_counts_and_consistency(self, auth):
        r = requests.get(f"{BASE_URL}/api/valuation/board", headers=auth, timeout=60)
        assert r.status_code == 200
        b = r.json()
        print(f"board stocks={len(b['stocks'])} unrated={len(b['unrated'])} progress={b['progress']}")
        whys = {}
        for u in b["unrated"]:
            whys[u["why"]] = whys.get(u["why"], 0) + 1
        print("unrated reasons", whys)
        listed = {s["t"]: s for s in b["stocks"]}
        for tk in ["PLTR", "UBER", "V", "AAPL", "JPM"]:
            print(tk, "in board" if tk in listed else "NOT in board", listed.get(tk))
        assert b["progress"]["valued"] >= 376  # 376 copied from the legacy board, refill adds the rest over ~30-40 min
        for tk in ["AAPL", "JPM", "PLTR"]:
            if tk in listed:
                q, _ = _quick(auth, tk)
                v = q.json()["optiiq"]["value"]
                assert abs(v - listed[tk]["v"]) <= max(1.0, 0.02 * v), (tk, v, listed[tk]["v"])
