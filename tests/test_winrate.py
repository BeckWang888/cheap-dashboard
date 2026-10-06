import numpy as np
import pandas as pd

from cheapdash import winrate


def _case(n_cheap=300, n_fair=300):
    """前半「便宜」全贏、後半「合理」一半贏。"""
    idx = pd.bdate_range("2010-01-01", periods=n_cheap + n_fair)
    st = pd.Series(["cheap"] * n_cheap + ["fair"] * n_fair, idx)
    win = pd.Series([1.0] * n_cheap + [1.0, 0.0] * (n_fair // 2), idx)
    o = pd.DataFrame({k: win for k in winrate.HORIZONS}, index=idx)
    o["mae"] = np.where(st == "cheap", -0.10, -0.05)
    return st, o


def test_lift_is_relative_to_own_baseline():
    st, o = _case()
    t = winrate.lifts([(st, o)])
    assert abs(t["cheap"]["6m"] - 0.25) < 1e-9
    assert abs(t["fair"]["6m"] + 0.25) < 1e-9
    assert t["cheap"]["mae"] < 0 < t["fair"]["mae"]  # 便宜時買進後再跌較深


def test_estimate_blends_and_cross_checks():
    st, o = _case()
    o.iloc[-126:] = np.nan  # 最近還不知道結果
    t = winrate.lifts([(st, o)])
    e = winrate.estimate(st, o, t)
    assert e["state"] == "fair" and 0 < e["own_k"] < 1
    assert e["p"] == e["6m"]["p"] and e["6m"]["p"] < e["6m"]["base"]
    assert e["better"] == 0 and e["n_h"] == 3


def test_no_score_gives_none():
    idx = pd.bdate_range("2010-01-01", periods=400)
    st = pd.Series([""] * 400, idx)
    o = pd.DataFrame({k: 1.0 for k in list(winrate.HORIZONS) + ["mae"]}, index=idx)
    assert winrate.estimate(st, o, {}) is None
