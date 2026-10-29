"""OptiIQ Value = plain average of 9 valuation methods (optiiq.py)."""
import pytest

from optiiq import optiiq_value, beta_rate, stage_rates, METHODS

PRICE = 100.0


def metrics(**kw):
    m = {"market_cap": 100e9, "eps_ttm": 5.0, "beta": 1.0, "pcf_ttm": 20.0, "pfcf_ttm": 25.0,
         "revenue_ps_ttm": 40.0, "book_value_per_share_q": 20.0, "pe_mean_10y": 20.0, "ps_mean_10y": 3.0, "pb_mean_10y": 5.0,
         "mean_years": {"pe": 10, "ps": 10, "pb": 10}, "revenue_growth_ttm": 10.0, "revenue_growth_5y": 10.0, "eps_growth_5y": 10.0,
         "revenue_growth_q_yoy": 10.0, "dividend_yield": 0.0, "cash_per_share_q": 0.0, "debt_to_equity_q": 0.0}
    m.update(kw)
    return m


def by_key(o):
    return {x["key"]: x["value"] for x in o["methods"]}


class TestBetaTable:
    @pytest.mark.parametrize("beta,rate", [(0.5, 0.05), (0.8, 0.05), (1.0, 0.06), (1.1, 0.065), (1.2, 0.07),
                                           (1.5, 0.085), (1.6, 0.09), (2.4, 0.09), (None, 0.06)])
    def test_rates(self, beta, rate):
        assert beta_rate(beta) == pytest.approx(rate)


class TestStages:
    def test_high_growth_halves_then_4(self):
        assert stage_rates(0.2) == pytest.approx((0.2, 0.1, 0.04))

    def test_low_growth(self):
        assert stage_rates(0.06) == pytest.approx((0.06, 0.04, 0.04))
        assert stage_rates(0.02) == pytest.approx((0.02, 0.02, 0.02))
        assert stage_rates(-0.1) == pytest.approx((-0.1, -0.05, -0.05))


class TestNineMethods:
    def test_plain_average_and_each_method(self):
        o = optiiq_value(PRICE, metrics(), [])
        v = by_key(o)
        assert [m["key"] for m in o["methods"]] == [k for k, _, _ in METHODS]
        # growth inputs all 10% -> g 10/5/4, beta 1.0 -> 6%
        r, g = 0.06, [0.10] * 5 + [0.05] * 5 + [0.04] * 10
        f, pv = 1.0, 0.0
        for t, x in enumerate(g, 1):
            f *= 1 + x
            pv += f / (1 + r) ** t
        shares = 1e9
        assert v["dcf20"] == pytest.approx(5e9 * pv / shares, abs=0.01)   # OCF = 100e9 / 20
        assert v["dfcf20"] == pytest.approx(4e9 * pv / shares, abs=0.01)  # FCF = 100e9 / 25
        assert v["dni20"] == pytest.approx(5e9 * pv / shares, abs=0.01)   # NI = EPS x shares
        assert v["mean_ps"] == pytest.approx(120.0)
        assert v["mean_pe"] == pytest.approx(100.0)
        assert v["mean_pb"] == pytest.approx(100.0)
        assert v["psg"] == pytest.approx(120.0)   # 3 x 40 x (10% / 10%)
        assert v["peg"] == pytest.approx(50.0)    # 5 x 10
        assert o["value"] == pytest.approx(sum(v.values()) / 9, abs=0.01)
        assert o["count"] == 9 and o["available"]

    def test_negative_values_count(self):
        o = optiiq_value(PRICE, metrics(pfcf_ttm=-25.0), [])
        v = by_key(o)
        assert v["dfcf20"] < 0 and v["dfcf_terminal"] < 0
        assert o["value"] == pytest.approx(sum(v.values()) / 9, abs=0.01)

    def test_missing_method_is_left_out(self):
        o = optiiq_value(PRICE, metrics(pb_mean_10y=None), [])
        v = by_key(o)
        assert v["mean_pb"] is None and o["count"] == 8
        assert o["value"] == pytest.approx(sum(x for x in v.values() if x is not None) / 8, abs=0.01)

    def test_cash_and_debt_shift_cash_flow_methods(self):
        a = by_key(optiiq_value(PRICE, metrics(), []))
        b = by_key(optiiq_value(PRICE, metrics(cash_per_share_q=10.0), []))
        assert b["dcf20"] - a["dcf20"] == pytest.approx(10.0, abs=0.01)
        assert b["mean_pe"] == a["mean_pe"]

    def test_peg_zero_when_growth_negative(self):
        o = optiiq_value(PRICE, metrics(revenue_growth_ttm=-20.0, revenue_growth_5y=-20.0, eps_growth_5y=-20.0, revenue_growth_q_yoy=-20.0), [])
        assert by_key(o)["peg"] == 0.0
        assert o["inputs"]["growth"]["years_1_5"] == pytest.approx(-0.10)

    def test_average_below_zero_unavailable(self):
        o = optiiq_value(PRICE, metrics(eps_ttm=-5.0, pcf_ttm=-20.0, pfcf_ttm=-10.0, book_value_per_share_q=-10.0, revenue_growth_5y=-5.0,
                                        revenue_growth_ttm=-20.0, eps_growth_5y=-20.0, revenue_growth_q_yoy=-20.0), [])
        assert not o["available"] and len(o["methods"]) == 9
