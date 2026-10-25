import json, sys, requests
from test_iter29_optiiq_dcf_buy_levels import BASE_URL, EMAIL, PASSWORD
t = requests.post(f"{BASE_URL}/api/auth/login", json={"email": EMAIL, "password": PASSWORD}).json()["session_token"]
h = {"Authorization": f"Bearer {t}"}
for tk in sys.argv[1:]:
    d = requests.post(f"{BASE_URL}/api/screener/stock-analysis", json={"ticker": tk, "purpose": "long"}, headers=h, timeout=120).json()
    d = d.get("result", d)
    o = d["optiiq"]
    keep = {k: o.get(k) for k in ("available", "reason", "model", "value", "price", "upside_pct", "fcf_ttm", "start_cf", "steady_cf", "cf_note",
                                  "pv_cash_flows", "pv_terminal", "terminal_share_pct", "value_of_operations", "cash", "debt", "equity_value",
                                  "shares", "book_value_ps", "roe_used", "growth", "discount", "beta_check")}
    keep["years0"] = (o.get("years") or [None])[0]
    print(tk, json.dumps(keep))
    print("  summary:", d["buy_summary"])
    for b in d["buy_levels"]:
        print("  ", b["label"], b["price"], b["below_price_pct"], b["strength"], b["reasons"])
    ov = d["buy_overlay"]
    print("  overlay fib", ov["fib"] and [l["price"] for l in ov["fib"]["levels"]], "rev", len(ov["reversals"]), "hist", len(d["price_history"]))
