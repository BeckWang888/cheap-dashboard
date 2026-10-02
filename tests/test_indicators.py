"""指標單元測試：手算案例 + 用 ta 套件交叉驗證（起始方式不同，只比較收斂後的部分）。"""
import numpy as np
import pandas as pd
import ta

from cheapdash.indicators import closed_bars, ema, macd_hist, rsi, sma
from cheapdash.model import past_pct_rank


def prices(n=1500, seed=0):
    rng = np.random.default_rng(seed)
    idx = pd.bdate_range("2015-01-01", periods=n)
    return pd.Series(100 * np.exp(np.cumsum(rng.normal(0.0003, 0.015, n))), idx)


def test_ema_seed_is_sma():
    s = pd.Series([1.0, 2, 3, 4, 5, 6])
    e = ema(s, 3)
    assert np.isnan(e[1]) and e[2] == 2.0
    assert e[3] == 2.0 + 0.5 * (4 - 2.0)


def test_rsi_extremes():
    up = pd.Series(np.arange(1.0, 40))
    assert rsi(up).dropna().eq(100).all()
    down = pd.Series(np.arange(40.0, 1, -1))
    assert rsi(down).dropna().eq(0).all()


def test_rsi_matches_ta():
    s = prices()
    ref = ta.momentum.RSIIndicator(s, 14).rsi()
    np.testing.assert_allclose(rsi(s)[300:], ref[300:], atol=1e-6)


def test_macd_hist_matches_ta():
    s = prices()
    ref = ta.trend.MACD(s, 26, 12, 9).macd_diff()
    np.testing.assert_allclose(macd_hist(s)[400:], ref[400:], atol=1e-6)


def test_sma():
    s = pd.Series([1.0, 2, 3, 4])
    assert sma(s, 2).tolist()[1:] == [1.5, 2.5, 3.5]


def test_closed_bars_week():
    idx = pd.to_datetime(["2026-09-28", "2026-09-29", "2026-10-02", "2026-10-05", "2026-10-06"])
    w = closed_bars(pd.Series([1.0, 2, 3, 4, 5], idx), "W-FRI")
    assert list(w.index.strftime("%m-%d")) == ["10-02", "10-06"]
    assert w.tolist() == [3.0, 5.0]


def test_pct_rank_uses_only_past():
    x = np.array([5.0, 1, 2, 3, 4, 100])
    r = past_pct_rank(x, min_obs=2)
    assert r[1] == 0.0                      # 1 比過去的 5 小
    assert r[4] == 0.75                     # 4 大於 1、2、3，小於 5
    # 未來的 100 不影響前面的結果
    r2 = past_pct_rank(x[:5], min_obs=2)
    np.testing.assert_array_equal(r[:5], r2)


def test_live_bars_mark_unfinished_month_as_forming():
    from cheapdash.model import _bars
    idx = pd.bdate_range("2026-08-03", "2026-10-02")
    s = pd.Series(np.arange(len(idx), dtype=float), idx)
    done, live = _bars(s, "M", pd.Timestamp("2026-10-02 10:00"), closed_today=False)
    assert done.index[-1].strftime("%m-%d") == "09-30" and live.index[-1].strftime("%m-%d") == "10-02"
    # 月底那天收盤後就算確認
    s2 = s.loc[:"2026-09-30"]
    done, live = _bars(s2, "M", pd.Timestamp("2026-09-30 16:30"), closed_today=True)
    assert live is None and done.index[-1].strftime("%m-%d") == "09-30"
    # 回測模式全部視為已收盤
    assert _bars(s, "M", None, True)[1] is None
