import numpy as np
import pandas as pd

from cheapdash import winrate


def _frame(states, wins):
    idx = pd.bdate_range("2010-01-01", periods=len(states))
    return pd.Series(states, idx), pd.Series(wins, idx, dtype=object)


def test_lift_is_relative_to_own_baseline():
    # 前半「便宜」全贏、後半「合理」一半贏：基準 75%，便宜 +25、合理 −25
    st, w = _frame(["cheap"] * 300 + ["fair"] * 300, [True] * 300 + [True, False] * 150)
    t = winrate.lifts([(st, w)])
    assert abs(t["cheap"]["lift"] - 0.25) < 1e-9
    assert abs(t["fair"]["lift"] + 0.25) < 1e-9


def test_estimate_blends_own_history_and_prior():
    st, w = _frame(["cheap"] * 300 + ["fair"] * 300, [True] * 300 + [True, False] * 150)
    w.iloc[-126:] = np.nan  # 最近 6 個月還不知道結果
    e = winrate.estimate(st, w, {"fair": {"lift": 0.0, "syms": 1}})
    assert e["state"] == "fair" and 0 < e["own_k"] < 1
    assert min(e["own"], e["base"]) <= e["p"] <= max(e["own"], e["base"])


def test_no_score_gives_none():
    st, w = _frame([""] * 400, [True] * 400)
    assert winrate.estimate(st, w, {}) is None
