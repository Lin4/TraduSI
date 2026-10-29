"""Iteration 39 - quick OptiIQ endpoint GET /api/valuation/optiiq/{ticker}, parity with stock-analysis long + board list."""
from __future__ import annotations

import math
import os
import time

import pytest
import requests

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")
EMAIL = "lingesa4@gmail.com"
PASSWORD = "Linges1@12"
KEYS = ["dcf20", "dfcf20", "dni20", "dfcf_terminal", "mean_ps", "mean_pe", "mean_pb", "psg", "peg"]
CASH = KEYS[:4]
FALLBACK = "temporarily unavailable"


@pytest.fixture(scope="module")
def auth():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": EMAIL, "password": PASSWORD}, timeout=30)
    if r.status_code != 200:
        pytest.skip(f"login failed {r.status_code}")
    return {"Authorization": f"Bearer {r.json()['session_token']}"}


def _quick(auth, tk):
    t0 = time.time()
    r = requests.get(f"{BASE_URL}/api/valuation/optiiq/{tk}", headers=auth, timeout=60)
    return r, time.time() - t0


def _check(o):
    assert o.get("model") == "nine", o
    ms = o["methods"]
    assert [m["key"] for m in ms] == KEYS
    vals = [m["value"] for m in ms if m["value"] is not None]
    for v in vals:
        assert math.isfinite(v)
    assert o["count"] == len(vals)
    if o.get("available"):
        assert abs(o["value"] - round(sum(vals) / len(vals), 2)) <= 0.02


# Auth / errors
def test_quick_requires_auth():
    r = requests.get(f"{BASE_URL}/api/valuation/optiiq/AAPL", timeout=30)
    assert r.status_code == 401


def test_quick_unknown_ticker_404(auth):
    r, _ = _quick(auth, "ZZZZ")
    assert r.status_code == 404, r.text


def test_old_board_ticker_endpoint_removed(auth):
    r = requests.get(f"{BASE_URL}/api/valuation/board/AAPL", headers=auth, timeout=30)
    assert r.status_code in (404, 405), r.status_code


# Quick endpoint per ticker (S&P + non-S&P)
@pytest.mark.parametrize("tk", ["PLTR", "AAPL", "MSFT", "V", "TRV", "SHOP", "SNOW", "CRWD", "UBER", "NET"])
def test_quick_ticker(auth, tk):
    r, dt = _quick(auth, tk)
    assert r.status_code == 200, r.text
    assert "NaN" not in r.text and "Infinity" not in r.text
    d = r.json()
    print(f"{tk}: {dt:.2f}s price={d['price']} value={d['optiiq'].get('value')} count={d['optiiq'].get('count')} "
          f"reason={d['optiiq'].get('reason')}")
    assert d["ticker"] == tk and d["price"] > 0 and d["name"]
    assert FALLBACK not in str(d["optiiq"].get("reason") or "")
    assert d["optiiq"].get("available") is True, d["optiiq"]
    _check(d["optiiq"])
    time.sleep(1.5)


def test_quick_jpm_bank_skips_cash_methods(auth):
    r, dt = _quick(auth, "JPM")
    assert r.status_code == 200
    o = r.json()["optiiq"]
    print(f"JPM {dt:.2f}s value={o.get('value')} count={o.get('count')}")
    _check(o)
    assert o.get("bank_or_insurer") is True
    for m in o["methods"]:
        if m["key"] in CASH:
            assert m["value"] is None and m.get("skipped") is True, m


def test_quick_pltr_fast_and_9_methods(auth):
    r, dt = _quick(auth, "PLTR")
    o = r.json()["optiiq"]
    print(f"PLTR {dt:.2f}s value={o.get('value')} count={o['count']}")
    assert o["count"] == 9
    assert dt < 3.0, dt


# Parity with full stock-analysis
@pytest.mark.parametrize("tk", ["PLTR", "SHOP", "JPM"])
def test_full_analysis_parity(auth, tk):
    t0 = time.time()
    r = requests.post(f"{BASE_URL}/api/screener/stock-analysis", headers=auth, json={"ticker": tk, "purpose": "long"}, timeout=120)
    full_dt = time.time() - t0
    assert r.status_code == 200, r.text[:300]
    full = r.json()
    q, _ = _quick(auth, tk)
    qd = q.json()
    fo = full["result"]["optiiq"] if "result" in full else full["optiiq"]
    fprice = (full.get("result") or full)["price"]
    print(f"{tk}: full {full_dt:.1f}s value={fo.get('value')} @ {fprice}; quick value={qd['optiiq'].get('value')} @ {qd['price']}")
    assert fo.get("available") is True
    if abs(round(fprice, 2) - qd["price"]) < 0.005:
        assert abs(fo["value"] - qd["optiiq"]["value"]) <= 0.02
    time.sleep(2)


def test_board_list_matches_quick(auth):
    r = requests.get(f"{BASE_URL}/api/valuation/board", headers=auth, timeout=60)
    assert r.status_code == 200
    data = r.json()
    stocks = data.get("stocks") or data.get("items") or data
    print("board keys", list(data.keys()) if isinstance(data, dict) else type(data), "n", len(stocks))
    by = {s.get("t") or s.get("ticker"): s for s in stocks}
    checked = 0
    for tk in ["AAPL", "JPM", "PLTR"]:
        s = by.get(tk)
        if not s:
            continue
        q, _ = _quick(auth, tk)
        qd = q.json()
        print(tk, "board", s, "quick", qd["price"], qd["optiiq"].get("value"))
        if s.get("p") and abs(s["p"] - qd["price"]) < 0.005 and s.get("v") is not None:
            assert abs(s["v"] - qd["optiiq"]["value"]) <= 0.02
            checked += 1
    print("checked", checked)
