"""Iteration 34: OptiIQ seasonal growth/capex, score drivers, one-tap plan alerts, strategy time_exit/invalidation, weekly report."""
import os
import time
from datetime import date, timedelta

import pytest
import requests

BASE_URL = (os.environ.get("EXPO_PUBLIC_BACKEND_URL") or open("/app/frontend/.env").read().split("EXPO_PUBLIC_BACKEND_URL=")[1].split()[0]).strip('"').rstrip("/")
ADMIN = {"email": "lingesa4@gmail.com", "password": "Linges1@12"}
TRADER = {"email": "trader@optiscreen.app", "password": "TestPass123!"}
ALLOWED_GROWTH = {"Consensus, coming quarters vs a year ago", "Last 12 months vs the 12 before", "Latest quarter vs a year ago"}


def _shared_db():
    import sys
    sys.path.insert(0, "/app/backend")
    from dotenv import dotenv_values
    from pymongo import MongoClient
    from atlas import shared_mongo_url
    env = dotenv_values("/app/backend/.env")
    return MongoClient(shared_mongo_url(env))[env["SHARED_DB_NAME"]], env


def _login(creds):
    r = requests.post(f"{BASE_URL}/api/auth/login", json=creds, timeout=20)
    if r.status_code != 200:
        pytest.skip(f"login failed {creds['email']}: {r.status_code}")
    return {"Authorization": f"Bearer {r.json()['session_token']}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def H():
    return _login(ADMIN)


# ---------- OptiIQ DCF: seasonal growth labels + capex history
class TestOptiIQ:
    def test_growth_labels_and_capex(self, H):
        oq, used = None, None
        for tk in ("AAPL", "MSFT", "KO"):
            r = requests.post(f"{BASE_URL}/api/screener/stock-analysis", json={"ticker": tk, "purpose": "long"}, headers=H, timeout=120)
            assert r.status_code == 200, r.text[:300]
            oq = (r.json().get("result") or r.json()).get("optiiq") or {}
            if oq.get("available") is not False and oq.get("model") == "dcf":
                used = tk
                break
            print(f"{tk}: available={oq.get('available')} model={oq.get('model')} reason={oq.get('reason')}")
        if not used:
            pytest.skip("OptiIQ dcf unavailable for AAPL/MSFT/KO (Finnhub budget)")
        print("ticker", used, "value", oq.get("value"))
        labels = [i.get("label") for i in (oq.get("growth") or {}).get("inputs", [])]
        print("growth labels:", labels)
        assert labels, "no growth inputs"
        assert all(l in ALLOWED_GROWTH for l in labels), labels
        assert not any("run-rate" in (l or "").lower() for l in labels)
        rv = oq.get("reinvestment") or {}
        print("capex_rule:", rv.get("capex_rule"), "history:", rv.get("capex_history"))
        assert isinstance(rv.get("capex_rule"), str) and rv["capex_rule"]
        assert isinstance(rv.get("capex_history"), list)
        for h in rv["capex_history"]:
            assert "year" in h and "pct" in h


# ---------- OptiScore drivers
class TestDrivers:
    def test_drivers_sum_to_pillars(self, H):
        r = requests.post(f"{BASE_URL}/api/screener/ticker-options",
                          json={"ticker": "AAPL", "expiration_range": "month", "strategy": "auto", "account_type": "reg_t"},
                          headers=H, timeout=150)
        assert r.status_code == 200, r.text[:300]
        res = r.json().get("result") or r.json()
        assert "score_weights" in res
        d, p = res["drivers"], res["pillars"]
        for k in ("expected_return", "risk", "premium_quality", "user_fit"):
            assert isinstance(d[k], list) and d[k]
            for row in d[k]:
                assert set(("label", "pts", "note")) <= set(row)
            tot = 50 + sum(x["pts"] for x in d[k])
            print(k, p[k], round(tot, 2), [(x["label"], x["pts"]) for x in d[k]])
            assert abs(tot - p[k]) <= 0.6, f"{k}: 50+sum={tot} pillar={p[k]}"


# ---------- One-tap plan alerts
class TestPlanAlerts:
    def test_long_plan_creates_two_linked(self, H):
        r = requests.post(f"{BASE_URL}/api/alerts/plan", json={"ticker": "aapl", "direction": "long", "target": 400, "stop": 300, "label": "Swing plan"}, headers=H, timeout=20)
        assert r.status_code == 200, r.text
        items = r.json()["items"]
        try:
            assert len(items) == 2
            assert len({i["group_id"] for i in items}) == 1 and items[0]["group_id"] == r.json()["group_id"]
            by = {i["note"]: i for i in items}
            assert by["Swing plan target"]["kind"] == "price_above" and by["Swing plan target"]["threshold"] == 400
            assert by["Swing plan stop"]["kind"] == "price_below" and by["Swing plan stop"]["threshold"] == 300
            assert all(i["ticker"] == "AAPL" for i in items)
            lst = requests.get(f"{BASE_URL}/api/alerts", headers=H, timeout=20).json()["items"]
            ids = {a["alert_id"] for a in lst}
            assert all(i["alert_id"] in ids for i in items)
        finally:
            for i in items:
                requests.delete(f"{BASE_URL}/api/alerts/{i['alert_id']}", headers=H, timeout=20)
        lst = requests.get(f"{BASE_URL}/api/alerts", headers=H, timeout=20).json()["items"]
        assert not any(a["alert_id"] in {i["alert_id"] for i in items} for a in lst)

    def test_short_plan_kinds(self, H):
        r = requests.post(f"{BASE_URL}/api/alerts/plan", json={"ticker": "AAPL", "direction": "short", "target": 200, "stop": 300}, headers=H, timeout=20)
        assert r.status_code == 200, r.text
        items = r.json()["items"]
        for i in items:
            requests.delete(f"{BASE_URL}/api/alerts/{i['alert_id']}", headers=H, timeout=20)
        by = {i["note"]: i for i in items}
        assert by["Trade plan target"]["kind"] == "price_below" and by["Trade plan stop"]["kind"] == "price_above"

    @pytest.mark.parametrize("body", [
        {"direction": "long", "target": 300, "stop": 400},
        {"direction": "long", "target": 300, "stop": 300},
        {"direction": "short", "target": 300, "stop": 200},
        {"direction": "short", "target": 300, "stop": 300},
    ])
    def test_invalid_sides_422(self, H, body):
        r = requests.post(f"{BASE_URL}/api/alerts/plan", json={"ticker": "AAPL", **body}, headers=H, timeout=20)
        if r.status_code == 200:
            for i in r.json()["items"]:
                requests.delete(f"{BASE_URL}/api/alerts/{i['alert_id']}", headers=H, timeout=20)
        assert r.status_code == 422, r.text

    def test_limit_403_trial(self):
        """Fresh trial account (limit 20): fill 19 alerts, then a 2-alert plan must be refused with 403."""
        import hmac, hashlib, uuid
        db, env = _shared_db()
        email = f"delivered+t34{uuid.uuid4().hex[:6]}@resend.dev"
        r = requests.post(f"{BASE_URL}/api/auth/register", json={"email": email, "password": "TestPass123!", "name": "TEST_t34"}, timeout=20)
        assert r.status_code == 202, r.text
        dig = hmac.new(env["JWT_SECRET"].encode(), f"{email}:123456".encode(), hashlib.sha256).hexdigest()
        db.email_verifications.update_one({"email": email}, {"$set": {"code_digest": dig}})
        v = requests.post(f"{BASE_URL}/api/auth/register/verify", json={"email": email, "code": "123456"}, timeout=20)
        uid = None
        try:
            assert v.status_code == 200, v.text
            uid = v.json()["user"]["user_id"]
            th = {"Authorization": f"Bearer {v.json()['session_token']}", "Content-Type": "application/json"}
            for k in range(19):
                a = requests.post(f"{BASE_URL}/api/alerts/add", json={"ticker": "AAPL", "kind": "price_above", "threshold": 1000 + k, "note": "TEST_fill"}, headers=th, timeout=20)
                assert a.status_code == 200, a.text
            r = requests.post(f"{BASE_URL}/api/alerts/plan", json={"ticker": "AAPL", "direction": "long", "target": 400, "stop": 300}, headers=th, timeout=20)
            print("limit resp:", r.status_code, r.text[:200])
            assert r.status_code == 403
            # with 18 used (2 free) it is allowed
            first = requests.get(f"{BASE_URL}/api/alerts", headers=th, timeout=20).json()["items"][0]["alert_id"]
            requests.delete(f"{BASE_URL}/api/alerts/{first}", headers=th, timeout=20)
            r2 = requests.post(f"{BASE_URL}/api/alerts/plan", json={"ticker": "AAPL", "direction": "long", "target": 400, "stop": 300}, headers=th, timeout=20)
            assert r2.status_code == 200, r2.text
        finally:
            if uid:
                for col in ("alerts", "user_sessions", "users"):
                    db[col].delete_many({"user_id": uid})
            db.email_verifications.delete_many({"email": email})


# ---------- Strategies: time_exit / invalidation / source
def _next_friday_chain(H):
    r = requests.get(f"{BASE_URL}/api/chain/AAPL/expirations", headers=H, timeout=30)
    if r.status_code == 200:
        ex = r.json().get("expirations") or r.json().get("items") or []
        ex = [e if isinstance(e, str) else e.get("date") for e in ex]
        ex = [e for e in ex if e and e > (date.today() + timedelta(days=10)).isoformat()]
        if ex:
            return ex[0]
    d = date.today() + timedelta(days=21)
    return (d + timedelta(days=(4 - d.weekday()) % 7)).isoformat()


class TestStrategyPlan:
    def _body(self, H, **kw):
        exp = _next_friday_chain(H)
        return {"name": "TEST_plan AAPL", "ticker": "AAPL", "expiration": exp,
                "legs": [{"action": "Buy", "type": "Call", "strike": 250, "qty": 1, "price": 5.0},
                         {"action": "Sell", "type": "Call", "strike": 260, "qty": 1, "price": 2.0}], **kw}

    def test_invalid_time_exit_422(self, H):
        r = requests.post(f"{BASE_URL}/api/strategies", json=self._body(H, time_exit="2026-13-45"), headers=H, timeout=60)
        if r.status_code == 200:
            requests.delete(f"{BASE_URL}/api/strategies/{r.json()['strategy_id']}", headers=H, timeout=20)
        assert r.status_code == 422, r.text[:200]
        r = requests.post(f"{BASE_URL}/api/strategies", json=self._body(H, source="bogus"), headers=H, timeout=60)
        if r.status_code == 200:
            requests.delete(f"{BASE_URL}/api/strategies/{r.json()['strategy_id']}", headers=H, timeout=20)
        assert r.status_code == 422

    def test_time_and_invalid_fire(self, H):
        past = (date.today() - timedelta(days=1)).isoformat()
        r = requests.post(f"{BASE_URL}/api/strategies", json=self._body(H, time_exit=past, invalidation={"below": 99999}, source="trade_plan"), headers=H, timeout=90)
        assert r.status_code == 200, r.text[:300]
        s = r.json()
        sid = s["strategy_id"]
        try:
            assert s["time_exit"] == past and s["invalidation"]["below"] == 99999 and s["source"] == "trade_plan"
            g = requests.get(f"{BASE_URL}/api/strategies", headers=H, timeout=120)
            assert g.status_code == 200
            mine = next(x for x in g.json()["items"] if x["strategy_id"] == sid)
            print("mark:", {k: mine.get("mark", {}).get(k) for k in ("price", "pnl", "error")}, "fired:", mine.get("fired"))
            assert mine["fired"].get("time") is True
            assert mine["fired"].get("invalid") is True
            assert g.json()["new_alerts"] >= 2
            feed = requests.get(f"{BASE_URL}/api/alerts/feed", headers=H, timeout=30).json()["items"]
            kinds = {e["kind"] for e in feed if e.get("strategy_id") == sid}
            print("feed kinds:", kinds)
            assert {"strategy_time", "strategy_invalid"} <= kinds
            # no duplicate fire on the next list
            g2 = requests.get(f"{BASE_URL}/api/strategies", headers=H, timeout=120).json()
            feed2 = requests.get(f"{BASE_URL}/api/alerts/feed", headers=H, timeout=30).json()["items"]
            assert sum(1 for e in feed2 if e.get("strategy_id") == sid) == len([e for e in feed if e.get("strategy_id") == sid])
        finally:
            d = requests.delete(f"{BASE_URL}/api/strategies/{sid}", headers=H, timeout=20)
            assert d.status_code == 200
            # remove the events via mongo (no API)
            try:
                n = _shared_db()[0].alert_events.delete_many({"strategy_id": sid}).deleted_count
                print("deleted events:", n)
            except Exception as ex:
                print("event cleanup failed:", ex)


# ---------- Weekly calibration report
class TestWeekly:
    def test_weekly_shape(self, H):
        r = requests.get(f"{BASE_URL}/api/track-record", headers=H, timeout=90)
        assert r.status_code == 200
        w = r.json()["live"]["weekly"]
        assert set(("weeks", "summary", "settling_next_7d", "note")) <= set(w)
        print("summary:", w["summary"], "next7:", w["settling_next_7d"], "weeks:", [(x["week_of"], x["n"]) for x in w["weeks"]])
        assert w["weeks"], "no weeks"
        total = 0
        for wk in w["weeks"]:
            assert date.fromisoformat(wk["week_of"]).weekday() == 0
            assert date.fromisoformat(wk["week_end"]) == date.fromisoformat(wk["week_of"]) + timedelta(days=4)
            for k in ("n", "wins", "realized", "calibrated_pop", "model_pop", "calibrated_n", "gap", "brier", "pnl"):
                assert k in wk
            assert abs(wk["gap"] - (wk["realized"] - wk["calibrated_pop"])) <= 0.11
            assert abs(wk["realized"] - wk["wins"] / wk["n"] * 100) <= 0.06
            assert 0 <= wk["brier"] <= 1
            total += wk["n"]
        print("total settled in weeks:", total)
        assert isinstance(w["summary"], str)
