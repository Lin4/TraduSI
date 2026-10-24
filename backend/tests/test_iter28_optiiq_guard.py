# Iteration 28: OptiIQ sanity guard (BRK.B inconsistent) + valuation board exclusion
import os
import pytest
import requests

BASE_URL = os.environ.get("EXPO_BACKEND_URL").rstrip("/")


@pytest.fixture(scope="module")
def client():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": "trader@optiscreen.app", "password": "TestPass123!"}, timeout=30)
    if r.status_code != 200:
        pytest.skip(f"login failed {r.status_code}")
    tok = r.json().get("session_token") or r.json().get("token")
    s.headers.update({"Authorization": f"Bearer {tok}"})
    return s


def _optiiq(client, ticker):
    r = client.post(f"{BASE_URL}/api/screener/stock-analysis", json={"ticker": ticker, "purpose": "long"}, timeout=120)
    assert r.status_code == 200, r.text[:300]
    d = r.json()
    res = d.get("result", d)
    return res.get("optiiq")


# OptiIQ guard: BRK.B unavailable
def test_brkb_optiiq_unavailable(client):
    o = _optiiq(client, "BRK.B")
    assert o is not None
    assert o["available"] is False, o
    assert o["reason"] == "Company data looks inconsistent, so no value is shown"


# OptiIQ: AAPL / MSFT still available
@pytest.mark.parametrize("t", ["AAPL", "MSFT"])
def test_optiiq_available(client, t):
    o = _optiiq(client, t)
    assert o and o["available"] is True, o
    assert isinstance(o["value"], (int, float)) and o["value"] > 0
    assert 0.05 < o["value"] / o["price"] < 20


# Valuation board excludes BRK.B / SKYD from stocks
def test_board_excludes_inconsistent(client):
    r = client.get(f"{BASE_URL}/api/valuation/board", timeout=60)
    assert r.status_code == 200
    d = r.json()
    syms = {s.get("ticker") or s.get("symbol") for s in d.get("stocks", [])}
    assert len(syms) > 0
    assert "BRK.B" not in syms and "SKYD" not in syms
    unrated = d.get("unrated", [])
    unrated_syms = {(u.get("ticker") or u.get("symbol")) if isinstance(u, dict) else u for u in unrated}
    print("unrated has BRK.B:", "BRK.B" in unrated_syms, "SKYD:", "SKYD" in unrated_syms, "stocks:", len(syms))
