"""權重與門檻校準：python calibrate.py
對每組（回撤、MA200、RSI）權重 × 跨上門檻，算各標的「事件後 6 個月中位報酬 − 任意日」，
看哪些設定在大多數標的、以及附近的設定都穩定勝過基準（不挑單點最佳）。"""
import json
from pathlib import Path

import numpy as np
import pandas as pd

from cheapdash import backtest, data
from cheapdash.model import compute

ROOT = Path(__file__).resolve().parent
WEIGHTS = [(0.6, 0.2, 0.2), (0.7, 0.15, 0.15), (0.8, 0.1, 0.1), (0.5, 0.25, 0.25), (0.4, 0.3, 0.3),
           (1 / 3, 1 / 3, 1 / 3), (0.5, 0.5, 0.0), (0.5, 0.0, 0.5)]
THRESHOLDS = [20, 35, 50, 65, 80]


def main():
    items = json.loads((ROOT / "watchlist.json").read_text(encoding="utf-8"))
    bases = list(dict.fromkeys(it.get("underlying") or it["symbol"] for it in items))
    rows = []
    for b in bases:
        close = data.load(b)["Close"]
        m = compute(close)                      # 只需要 u_dd / u_ma / u_rsi，和權重無關
        fwd = backtest.forward_stats(close)
        valid = m.index[m["score"].notna()]
        base = fwd.loc[valid, "r126"].median()
        base_win = (fwd.loc[valid, "r126"].dropna() > 0).mean()
        for w in WEIGHTS:
            score = 100 * (w[0] * (2 * m["u_dd"] - 1) + w[1] * (2 * m["u_ma"] - 1) + w[2] * (2 * m["u_rsi"] - 1))
            for th in THRESHOLDS:
                ev = backtest.cross_events(score, th)
                r = fwd.loc[pd.DatetimeIndex(ev), "r126"].dropna()
                mae = fwd.loc[pd.DatetimeIndex(ev), "mae"].dropna()
                rows.append({"base": b, "w": "/".join(f"{x:.2f}" for x in w), "th": th, "n": len(r),
                             "excess": (r.median() - base) if len(r) else np.nan,
                             "win_ex": ((r > 0).mean() - base_win) if len(r) else np.nan,
                             "mae": mae.median() if len(mae) else np.nan})
    df = pd.DataFrame(rows)
    df.to_csv(ROOT / "calibration.csv", index=False)
    g = df[df["n"] >= 5].groupby(["w", "th"]).agg(
        標的數=("base", "count"), 中位超額=("excess", "median"), 勝過基準比例=("excess", lambda x: (x > 0).mean()),
        上漲機率超額=("win_ex", "median"), 之後再跌=("mae", "median"), 平均次數=("n", "mean"))
    pd.set_option("display.width", 200)
    print((g.assign(中位超額=lambda x: (x["中位超額"] * 100).round(1), 勝過基準比例=lambda x: (x["勝過基準比例"] * 100).round(0),
                    上漲機率超額=lambda x: (x["上漲機率超額"] * 100).round(1), 之後再跌=lambda x: (x["之後再跌"] * 100).round(1),
                    平均次數=lambda x: x["平均次數"].round(1))).to_string())


if __name__ == "__main__":
    main()
