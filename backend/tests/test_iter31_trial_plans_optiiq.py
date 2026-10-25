# Iteration 31: Free 7-day trial (everything in Advance) / expired lock, and OptiIQ long-term payload shape
import os
import pytest
import requests

BASE_URL = (os.environ.get("EXPO_PUBLIC_BACKEND_URL") or os.environ.get("EXPO_BACKEND_URL") or
            open("/app/frontend/.env").read().split("EXPO_PUBLIC_BACKEND_URL=")[1].split()[0]).strip().strip('"').rstrip("/")
PW = "TestPass123!"
ADVANCE = {"scans_per_day": 100000, "alerts": 20, "smart_alerts": True, "custom_period": True, "collateral_views": True,
           "ai_explain": True, "backtest": True, "day_lab": False, "voice": False, "daily_push": False, "strategy_tier": 3,
           "ai_chat_per_day": 30, "ai_deep_per_day": 5}


def login(email):
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": PW}, timeout=20)
    if r.status_code != 200:
        pytest.skip(f"login {email} failed {r.status_code} {r.text[:200]}")
    return {"Authorization": f"Bearer {r.json()['session_token']}"}, r.json().get("user", {})


# Billing status: trial user
class TestTrial:
    def test_trial_status(self):
        h, _ = login("trial@optiscreen.app")
        r = requests.get(f"{BASE_URL}/api/billing/status", headers=h, timeout=20)
        assert r.status_code == 200, r.text
        d = r.json()
        acc = d.get("access", d)
        assert acc["tier"] == "trial"
        assert acc["trial_days_left"] == 7
        assert acc["features"] == ADVANCE
        assert acc["prices"] == {"simple": 9.0, "advance": 29.0, "expert": 79.0}

    def test_trial_me_access(self):
        h, _ = login("trial@optiscreen.app")
        r = requests.get(f"{BASE_URL}/api/auth/me", headers=h, timeout=20)
        assert r.status_code == 200
        u = r.json().get("user", r.json())
        assert u["access"]["tier"] == "trial"
        assert u["access"]["features"]["strategy_tier"] == 3


# Billing status: expired user + saved items still readable
class TestExpired:
    def test_expired_status(self):
        h, _ = login("expired@optiscreen.app")
        r = requests.get(f"{BASE_URL}/api/billing/status", headers=h, timeout=20)
        assert r.status_code == 200
        acc = r.json().get("access", r.json())
        assert acc["tier"] == "expired"
        assert acc["trial_days_left"] == 0
        f = acc["features"]
        assert f["scans_per_day"] == 0 and f["alerts"] == 0 and f["strategy_tier"] == 0
        assert not any(v for k, v in f.items() if isinstance(v, bool))
        assert f["ai_chat_per_day"] == 0 and f["ai_deep_per_day"] == 0

    def test_expired_watchlist_readable(self):
        h, _ = login("expired@optiscreen.app")
        r = requests.get(f"{BASE_URL}/api/watchlist", headers=h, timeout=30)
        assert r.status_code == 200
        assert "AAPL" in [i["ticker"] for i in r.json().get("items", [])]

    def test_expired_alerts_readable(self):
        h, _ = login("expired@optiscreen.app")
        r = requests.get(f"{BASE_URL}/api/alerts", headers=h, timeout=30)
        assert r.status_code == 200
        items = r.json().get("items", r.json() if isinstance(r.json(), list) else [])
        assert any(a.get("ticker") == "MSFT" and a.get("kind") == "price_below" and float(a.get("threshold", 0)) == 300 for a in items), items

    def test_expired_chat_locked(self):
        h, _ = login("expired@optiscreen.app")
        r = requests.post(f"{BASE_URL}/api/assistant/chat", json={"message": "hi"}, headers=h, timeout=30)
        assert r.status_code in (402, 403), r.status_code

    # Backend enforcement check (informational): does API block expired users from adding alerts / running screens?
    def test_expired_add_alert_blocked_backend(self):
        h, _ = login("expired@optiscreen.app")
        r = requests.post(f"{BASE_URL}/api/alerts/add", json={"ticker": "TSLA", "kind": "price_below", "threshold": 1}, headers=h, timeout=30)
        if r.status_code == 200:
            # cleanup
            lst = requests.get(f"{BASE_URL}/api/alerts", headers=h, timeout=30).json()
            for a in lst.get("items", []):
                if a.get("ticker") == "TSLA":
                    requests.delete(f"{BASE_URL}/api/alerts/{a.get('id') or a.get('alert_id')}", headers=h, timeout=20)
        assert r.status_code in (402, 403), f"expired user can add alert via API: {r.status_code}"


# OptiIQ long-term payload for advance user
class TestOptiIQ:
    def test_msft_long(self):
        h, _ = login("trader@optiscreen.app")
        r = requests.post(f"{BASE_URL}/api/screener/stock-analysis", json={"ticker": "MSFT", "purpose": "long"}, headers=h, timeout=180)
        assert r.status_code == 200, r.text[:300]
        d = r.json().get("result", r.json())
        o = d.get("optiiq") or {}
        assert o.get("available") is True, o
        assert isinstance(o.get("value"), (int, float)) and o["value"] > 0
        assert isinstance(o.get("upside_pct"), (int, float))
        for k in ("valuation", "buy_point", "sell_point", "buy_levels"):
            assert d.get(k) is not None, f"missing {k}"
        assert isinstance(d["buy_levels"], (list, dict))
        print("OPTIIQ", o.get("value"), o.get("upside_pct"), "buy", d.get("buy_point"), "sell", d.get("sell_point"))
