# Iteration 32: unit tests for engine.optiiq_value -- revenue-driven 10-year DCF (user's template math)
import sys
import pytest

sys.path.insert(0, "/app/backend")
import engine  # noqa: E402
from engine import optiiq_value, TERMINAL_GROWTH, TAX_RATE, RISK_FREE, MRP, DEBT_SPREAD  # noqa: E402

PRICE = 100.0
MC = 100e9  # -> 1e9 shares


def rows(rev_q=(10e9, 10e9, 10e9, 10e9), years=((2024, 4), (2025, 1), (2025, 2), (2025, 3)), oi=2.5e9, da=0.5e9,
         sbc=0.0, capex=0.6e9, extra_prev=None):
    out = []
    if extra_prev:
        out.extend(extra_prev)
    for (fy, fq), r in zip(years, rev_q):
        out.append({"label": f"Q{fq} FY{str(fy)[-2:]}", "fiscal_year": fy, "fiscal_quarter": fq, "end_date": f"{fy}-06-30",
                    "revenue": r, "operating_income": oi, "dep_amort": da, "sbc": sbc, "capex": capex,
                    "net_income": 2e9, "free_cash_flow": 2e9, "cash": 5e9, "cash_and_investments": 10e9, "total_debt": 20e9,
                    "receivables": 4e9, "inventory": 2e9, "payables": 3e9, "deferred_revenue": 1e9})
    return out


def metrics(**kw):
    m = {"market_cap": MC, "eps_ttm": 8.0, "beta": 1.0, "revenue_growth_ttm": 20.0, "operating_margin_ttm": 25.0,
         "operating_margin_5y": 15.0}
    m.update(kw)
    return m


# Core: keys and template math recomputed independently
class TestTemplateMath:
    def test_keys_and_math(self):
        r = rows()
        o = optiiq_value(PRICE, metrics(), r, "Technology", "TEST")
        assert o["available"] is True, o
        assert o["model"] == "dcf"
        for k in ("value", "upside_pct", "growth", "margin", "reinvestment", "discount", "years", "scenarios", "beta_check"):
            assert k in o, k
        assert set(o["growth"]) >= {"year1", "terminal", "fade", "consensus_quarters", "inputs"}
        assert set(o["margin"]) >= {"initial", "stable", "reported", "stock_pay_addback"}
        assert set(o["scenarios"]) == {"bear", "base", "bull"}
        assert len(o["years"]) == 10
        assert len(o["beta_check"]) == 3

        # independent recomputation
        rev = 40e9
        # no estimates, no year-ago quarter: TTM growth 20% only (no seasonal run-rate any more)
        g1 = 0.20
        assert o["growth"]["year1"] == pytest.approx(g1, abs=1e-4)
        fade = max(0.2, min(0.45, 0.2 + 0.5 * max(0, g1 - 0.15)))
        assert o["growth"]["fade"] == pytest.approx(fade, abs=1e-3)
        m0 = 0.25
        m_stable = max((0.25 + 0.15) / 2, 0.6 * 0.25)
        assert o["margin"]["initial"] == pytest.approx(m0, abs=1e-4)
        assert o["margin"]["stable"] == pytest.approx(m_stable, abs=1e-4)
        da_pct = 2e9 / rev
        cx_pct = 2.4e9 / rev
        cx_target = min(cx_pct, 1.1 * da_pct)
        nwc_pct = (4e9 + 2e9 - 3e9 - 1e9) / rev
        assert o["reinvestment"]["nwc_pct_of_revenue_change"] == pytest.approx(nwc_pct, abs=1e-4)
        debt, cash, shares = 20e9, 10e9, 1e9
        wd = debt / (debt + MC)
        ke = RISK_FREE + (0.67 * 1.0 + 0.33) * MRP
        w = max(ke * (1 - wd) + (RISK_FREE + DEBT_SPREAD) * (1 - TAX_RATE) * wd, TERMINAL_GROWTH + 0.035, 0.07)
        assert o["discount"]["wacc"] == pytest.approx(w, abs=1e-4)
        prev, m, cxp, pv_sum = rev, m0, cx_pct, 0.0
        for t in range(1, 11):
            g = TERMINAL_GROWTH + (g1 - TERMINAL_GROWTH) * (1 - fade) ** (t - 1)
            rt = prev * (1 + g)
            if t > 1:
                m += (m_stable - m) * fade
                cxp += (cx_target - cxp) * fade
            fcff = rt * m * (1 - TAX_RATE) + rt * da_pct - rt * cxp - (rt - prev) * nwc_pct
            pv = fcff / (1 + w) ** t
            pv_sum += pv
            y = o["years"][t - 1]
            assert y["growth"] == pytest.approx(g, abs=1e-4)
            assert y["ebit_margin"] == pytest.approx(m, abs=1e-4)
            assert y["fcff"] == pytest.approx(fcff, rel=1e-6)
            assert y["pv"] == pytest.approx(pv, rel=1e-6)
            prev = rt
        tv = fcff * (1 + TERMINAL_GROWTH) / (w - TERMINAL_GROWTH)
        pv_tv = tv / (1 + w) ** 10
        assert o["terminal_value"] == pytest.approx(tv, rel=1e-6)
        assert o["pv_terminal"] == pytest.approx(pv_tv, rel=1e-6)
        per_share = (pv_sum + pv_tv + cash - debt) / shares
        assert o["value"] == pytest.approx(per_share, abs=0.01)
        assert o["upside_pct"] == pytest.approx((per_share / PRICE - 1) * 100, abs=0.1)
        assert o["scenarios"]["base"]["value"] == o["value"]
        assert o["scenarios"]["bear"]["value"] < o["value"] < o["scenarios"]["bull"]["value"]
        assert o["scenarios"]["bear"]["growth_year1"] == pytest.approx(g1 - 0.08, abs=1e-4)
        assert o["scenarios"]["bull"]["wacc"] == pytest.approx(w - 0.005, abs=1e-4)


# Year-1 growth rules (consensus / no consensus / clamp / fade)
class TestYear1Growth:
    def test_with_estimates(self):
        prev_year = rows(rev_q=(8e9, 8e9, 8e9, 8e9), years=((2024, 1), (2024, 2), (2024, 3), (2023, 4)))
        prev_year = sorted(prev_year, key=lambda x: (x["fiscal_year"], x["fiscal_quarter"]))
        r = rows()
        est = [{"year": 2025, "quarter": 4, "revenue_estimate": 12e9}, {"year": 2026, "quarter": 1, "revenue_estimate": 13e9}]
        # rows have Q4 FY24 (10e9) and Q1 FY25 (10e9) -> yoy = 25/20 - 1 = 0.25; run = 12.5*4/40 - 1 = 0.25
        o = optiiq_value(PRICE, metrics(), prev_year + r, "Technology", "TEST", est)
        assert o["available"], o
        assert o["growth"]["year1"] == pytest.approx(0.25, abs=1e-4)
        assert o["growth"]["consensus_quarters"] == ["Q4 FY25", "Q1 FY26"]
        assert o["growth"]["fade"] == pytest.approx(0.25, abs=1e-3)
        assert len(o["growth"]["inputs"]) == 2

    def test_estimates_no_match_uses_ttm_growth(self):
        est = [{"year": 2030, "quarter": 1, "revenue_estimate": 11e9}]
        o = optiiq_value(PRICE, metrics(), rows(), "Technology", "TEST", est)
        assert o["growth"]["year1"] == pytest.approx(0.20, abs=1e-4)
        assert o["growth"]["consensus_quarters"] == []

    def test_seasonal_quarter_not_annualized(self):
        # strong Q4 every year, no real growth: Q4 FY24 = 16e9, Q1-Q3 = 8e9; consensus Q4 FY25 = 16e9 -> 0% growth
        prev = rows(rev_q=(16e9,), years=((2023, 4),))
        r = rows(rev_q=(16e9, 8e9, 8e9, 8e9), years=((2024, 4), (2025, 1), (2025, 2), (2025, 3)))
        prev_q3 = rows(rev_q=(8e9,), years=((2024, 3),))
        est = [{"year": 2025, "quarter": 4, "revenue_estimate": 16e9}]
        o = optiiq_value(PRICE, metrics(revenue_growth_ttm=0.0), prev + prev_q3 + r, "Technology", "TEST", est)
        assert o["growth"]["year1"] == pytest.approx(0.0, abs=1e-4)
        assert [i["label"] for i in o["growth"]["inputs"]] == ["Consensus, coming quarters vs a year ago", "Latest quarter vs a year ago"]

    def test_latest_quarter_from_provider(self):
        o = optiiq_value(PRICE, metrics(revenue_growth_q_yoy=10.0), rows(), "Technology", "TEST")
        assert o["growth"]["year1"] == pytest.approx(0.15, abs=1e-4)  # avg(TTM 20%, latest quarter 10%)


# Capex: toward the company's own history (10-K filings)
class TestCapexHistory:
    def test_history_median_target(self):
        hist = [{"year": 2016 + i, "revenue": 100e9, "capex": c * 1e9} for i, c in enumerate((4, 5, 6, 7, 8))]
        o = optiiq_value(PRICE, metrics(), rows(capex=3e9), "Technology", "TEST", None, hist)
        assert o["reinvestment"]["capex_pct"] == pytest.approx(0.30, abs=1e-4)
        assert o["reinvestment"]["capex_target_pct"] == pytest.approx(0.06, abs=1e-4)
        assert len(o["reinvestment"]["capex_history"]) == 5
        assert "5-year median" in o["reinvestment"]["capex_rule"]

    def test_history_can_raise_capex(self):
        hist = [{"year": 2018 + i, "revenue": 10e9, "capex": 1.2e9} for i in range(4)]
        o = optiiq_value(PRICE, metrics(), rows(), "Technology", "TEST", None, hist)
        assert o["reinvestment"]["capex_target_pct"] == pytest.approx(0.12, abs=1e-4)
        assert o["years"][-1]["fcff"] < optiiq_value(PRICE, metrics(), rows(), "Technology", "TEST")["years"][-1]["fcff"]

    def test_short_history_falls_back(self):
        hist = [{"year": 2024, "revenue": 10e9, "capex": 1e9}, {"year": 2025, "revenue": 10e9, "capex": 1e9}]
        o = optiiq_value(PRICE, metrics(), rows(capex=3e9), "Technology", "TEST", None, hist)
        assert o["reinvestment"]["capex_target_pct"] == pytest.approx(1.1 * 0.05, abs=1e-4)
        assert len(o["reinvestment"]["capex_history"]) == 2

    def test_clamp_high_and_fade_cap(self):
        o = optiiq_value(PRICE, metrics(revenue_growth_ttm=300.0), rows(rev_q=(5e9, 8e9, 12e9, 25e9)), "Technology", "TEST")
        if o.get("available"):
            assert o["growth"]["year1"] == pytest.approx(0.8, abs=1e-4)
            assert o["growth"]["fade"] == pytest.approx(0.45, abs=1e-3)
        else:
            assert "inconsistent" in o["reason"] or "positive" in o["reason"]

    def test_clamp_low(self):
        o = optiiq_value(PRICE, metrics(revenue_growth_ttm=-60.0), rows(rev_q=(12e9, 12e9, 12e9, 4e9)), "Technology", "TEST")
        assert o["growth"]["year1"] == pytest.approx(-0.15, abs=1e-4)
        assert o["growth"]["fade"] == pytest.approx(0.2, abs=1e-3)


# Edge cases
class TestEdgeCases:
    def test_negative_margin_unavailable(self):
        o = optiiq_value(PRICE, metrics(operating_margin_ttm=-10.0, operating_margin_5y=-5.0), rows(sbc=0.0), "Technology", "TEST")
        assert o["available"] is False
        assert o["reason"].startswith("Operating margin isn't positive yet")

    def test_one_off_charge_starts_halfway_to_history(self):
        # TTM margin -4% after a one-off charge, 5-year average 18%: start margin = (-4% + 18%) / 2 = 7%
        o = optiiq_value(PRICE, metrics(operating_margin_ttm=-4.0, operating_margin_5y=18.0), rows(sbc=0.0), "Industrials", "TEST")
        assert o["available"] is True
        assert o["margin"]["initial"] == pytest.approx(0.07, abs=1e-4)

    def test_sbc_addback_rescues_margin(self):
        # -5% reported + 10% SBC -> +5% initial margin -> model runs
        o = optiiq_value(PRICE, metrics(operating_margin_ttm=-5.0), rows(sbc=1e9), "Technology", "TEST")
        assert o.get("margin", {}).get("initial") == pytest.approx(0.05, abs=1e-4), o

    def test_bank_excess_return(self):
        m = metrics(book_value_per_share_q=60.0, roe_ttm=15.0)
        o = optiiq_value(PRICE, m, rows(), "Financials", "JPM")
        assert o["available"] and o["model"] == "excess_return"

    def test_utility_excess_return(self):
        m = metrics(book_value_per_share_q=60.0, roe_ttm=10.0)
        o = optiiq_value(PRICE, m, rows(), "Utilities", "DUK")
        assert o["model"] == "excess_return"

    def test_value_gt_10x_unavailable(self):
        o = optiiq_value(5.0, metrics(market_cap=5e9), rows(), "Technology", "TEST")
        assert o["available"] is False and "inconsistent" in o["reason"]

    def test_low_confidence(self):
        # price 30 -> shares 3.33e9 using same market cap scaling: build so value ~3-10x
        o = optiiq_value(25.0, metrics(market_cap=25e9, eps_ttm=2.0), rows(), "Technology", "TEST")
        if o.get("available"):
            ratio = o["value"] / 25.0
            if ratio > 3 or ratio < 0.25:
                assert o.get("confidence") == "low"
        o2 = optiiq_value(PRICE, metrics(), rows(), "Technology", "TEST")
        r2 = o2["value"] / PRICE
        assert (o2.get("confidence") == "low") == (r2 > 3 or r2 < 0.25)

    def test_non_consecutive_quarters_fallback(self):
        r = rows(years=((2024, 1), (2025, 1), (2025, 2), (2025, 3)))
        o = optiiq_value(PRICE, metrics(revenue_ps_ttm=50.0), r, "Technology", "TEST")
        assert o["revenue_source"] == "revenue per share (TTM) x shares"
        assert o["revenue_ttm"] == pytest.approx(50e9, rel=1e-6)
