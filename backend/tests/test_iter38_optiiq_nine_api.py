"""Iteration 38 - OptiIQ v8 (average of 9 methods) API tests: stock-analysis long, valuation board list + per-stock."""
from __future__ import annotations

import json
import math
import os
import time

import pytest
import requests

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")
EMAIL = "lingesa4@gmail.com"
PASSWORD = "Linges1@12"
KEYS = ["dcf20", "dfcf20", "dni20", "dfcf_terminal", "mean_ps", "mean_pe", "mean_pb", "psg", "peg"]
FALLBACK = "temporarily unavailable"


@pytest.fixture(scope="module")
def auth():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": EMAIL, "password": PASSWORD}, timeout=30)
    if r.status_code != 200:
        pytest.skip(f"login failed {r.status_code} {r.text[:200]}")
    tok = r.json().get("session_token") or r.json().get("token")
    return {"Authorization": f"Bearer {tok}"}


def _no_nan(raw: str):
    assert "NaN" not in raw and "Infinity" not in raw, "NaN/Infinity in JSON"


def _check_optiiq(o: dict, price: float | None = None):
    """9-method structure + average math."""
    assert o.get("model") == "nine", o
    ms = o["methods"]
    assert [m["key"] for m in ms] == KEYS
    for m in ms:
        assert set(["key", "label", "short", "value", "vs_price_pct", "note"]) <= set(m), m
        assert m["value"] is None or isinstance(m["value"], (int, float))
        assert isinstance(m["note"], str) and m["note"]
        if m["value"] is not None:
            assert math.isfinite(m["value"])
            assert abs(m["vs_price_pct"] - (m["value"] / o["price"] - 1) * 100) < 0.2
    vals = [m["value"] for m in ms if m["value"] is not None]
    assert o["count"] == len(vals)
    if o.get("available"):
        avg = sum(vals) / len(vals)
        assert abs(o["value"] - round(avg, 2)) <= 0.05, (o["value"], avg)
        assert abs(o["upside_pct"] - (o["value"] / o["price"] - 1) * 100) <= 0.15
    else:
        assert o.get("reason")
    if price is not None:
        assert abs(o["price"] - round(price, 2)) < 0.01


# ---------- stock-analysis long ----------
def _analyze(auth, tk, tries=2):
    for i in range(tries):
        r = requests.post(f"{BASE_URL}/api/screener/stock-analysis", json={"ticker": tk, "purpose": "long"}, headers=auth, timeout=150)
        assert r.status_code == 200, r.text[:300]
        _no_nan(r.text)
        res = r.json()["result"]
        o = res["optiiq"]
        if FALLBACK in (o.get("reason") or "") and i < tries - 1:
            time.sleep(65)
            continue
        return res
    return res


@pytest.mark.parametrize("tk", ["MSFT", "AAPL", "TSLA", "JPM"])
def test_stock_analysis_long_nine(auth, tk):
    res = _analyze(auth, tk)
    o = res["optiiq"]
    print(tk, "available", o.get("available"), "value", o.get("value"), "count", o.get("count"), "conf", o.get("confidence"),
          "reason", o.get("reason"), [(m["short"], m["value"]) for m in o.get("methods") or []])
    if FALLBACK in (o.get("reason") or ""):
        pytest.skip(f"{tk}: provider rate limited (graceful fallback)")
    _check_optiiq(o)
    exp_iv = o["value"] if o.get("available") and o.get("confidence") != "low" else None
    assert res["intrinsic_value"] == exp_iv


# ---------- valuation board ----------
def test_board_requires_auth():
    assert requests.get(f"{BASE_URL}/api/valuation/board", timeout=30).status_code == 401
    assert requests.get(f"{BASE_URL}/api/valuation/optiiq/AAPL", timeout=30).status_code == 401


@pytest.fixture(scope="module")
def board(auth):
    r = requests.get(f"{BASE_URL}/api/valuation/board", headers=auth, timeout=60)
    assert r.status_code == 200
    _no_nan(r.text)
    return r.json()


def test_board_shape(board):
    assert len(board["buckets"]) == 5
    assert sum(b["count"] for b in board["buckets"]) == len(board["stocks"])
    for x in board["stocks"]:
        assert set("tnspvdb") <= set(x)
        assert x["v"] > 0
        assert abs(x["d"] - round((x["p"] / x["v"] - 1) * 100, 1)) <= 0.11, x
    un = {u["t"] for u in board["unrated"]}
    print("stocks", len(board["stocks"]), "unrated", len(un), sorted(un), "progress", board["progress"])
    assert board["progress"]["total"] == 503


@pytest.mark.parametrize("tk", ["AAPL", "MSFT", "CCI", "BAC"])
def test_board_stock(auth, board, tk):
    r = requests.get(f"{BASE_URL}/api/valuation/optiiq/{tk}", headers=auth, timeout=30)
    assert r.status_code == 200, r.text[:200]
    _no_nan(r.text)
    d = r.json()
    assert {"ticker", "name", "sector", "price", "optiiq"} <= set(d)
    _check_optiiq(d["optiiq"], d["price"])
    row = next((x for x in board["stocks"] if x["t"] == tk), None)
    if row and abs(row["p"] - d["price"]) < 0.005:
        assert abs(row["v"] - d["optiiq"]["value"]) <= 0.02, (row, d["optiiq"]["value"])


def test_quick_unknown_ticker_404(auth):
    r = requests.get(f"{BASE_URL}/api/valuation/optiiq/ZZZZ", headers=auth, timeout=30)
    assert r.status_code == 404


@pytest.mark.parametrize("tk", ["PLTR", "SNOW", "CRWD", "JPM"])
def test_quick_any_ticker(auth, tk):
    """Board names and non-board names both return the 9-method structure quickly."""
    t = time.time()
    r = requests.get(f"{BASE_URL}/api/valuation/optiiq/{tk}", headers=auth, timeout=30)
    assert r.status_code == 200, r.text[:200]
    _no_nan(r.text)
    d = r.json()
    print(tk, round(time.time() - t, 2), "s", d["optiiq"].get("value"), d["optiiq"].get("count"), d["optiiq"].get("reason"))
    if FALLBACK in (d["optiiq"].get("reason") or ""):
        pytest.skip(f"{tk}: provider rate limited")
    _check_optiiq(d["optiiq"], d["price"])


def test_board_all_consistent_sample(auth, board):
    """Every 25th bucketed stock: board v matches per-stock optiiq value at same price."""
    bad = []
    for x in board["stocks"][::25]:
        d = requests.get(f"{BASE_URL}/api/valuation/optiiq/{x['t']}", headers=auth, timeout=30).json()
        o = d["optiiq"]
        if abs(d["price"] - x["p"]) < 0.005 and (not o.get("available") or abs(o["value"] - x["v"]) > 0.02):
            bad.append((x["t"], x["v"], o.get("value")))
    assert not bad, bad
