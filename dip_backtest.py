"""定投點回測：python dip_backtest.py
上升趨勢中的拉回：RSI < 50、MACD 柱在零軸下（綠柱）且開始縮短，可選趨勢過濾。
日線與週線各測幾種版本，和「任意日買進」、「趨勢內任意日買進」比較 3／6 個月報酬。
只讀 data/ 快取，不連網。"""
import json
from pathlib import Path

import numpy as np
import pandas as pd

from cheapdash import backtest
from cheapdash.indicators import closed_bars, ema, macd_hist, rsi, sma
from cheapdash.model import compute

ROOT = Path(__file__).resolve().parent
GAP = 20  # 同一種事件至少隔 20 個交易日（約 1 個月）


def spaced(flags: pd.Series, gap: int = GAP) -> list:
    out, last = [], -10**9
    for i in np.flatnonzero(flags.fillna(False).to_numpy()):
        if i - last >= gap:
            out.append(flags.index[i])
            last = i
    return out


def turn_up(h: pd.Series) -> pd.Series:
    """綠柱開始縮短：柱為負、這根比上一根短、上一根是谷底。"""
    return (h < 0) & (h > h.shift(1)) & (h.shift(1) <= h.shift(2))


def shrink3(h: pd.Series) -> pd.Series:
    return (h < 0) & (h > h.shift(1)) & (h.shift(1) > h.shift(2)) & (h.shift(2) > h.shift(3))


def events(close: pd.Series) -> dict:
    idx = close.index
    ma200 = sma(close, 200)
    up_ma = close > ma200
    r, h = rsi(close), macd_hist(close)

    wk = closed_bars(close, "W-FRI")
    wline = ema(wk, 12) - ema(wk, 26)
    wh, wr = macd_hist(wk), rsi(wk)
    up_wk = (wline > 0).reindex(idx).ffill().fillna(False)   # 週線 DIF > 0，收盤確認後沿用
    trend = {"不過濾": pd.Series(True, idx), "站上MA200": up_ma, "週DIF>0": up_wk, "兩者皆是": up_ma & up_wk}

    ok = ma200.notna()
    ev = {}
    zone = (r < 50) & (h < 0)
    for tn, t in trend.items():
        ev[f"日｜拉回區進入｜{tn}"] = spaced(zone & ~zone.shift(1, fill_value=False) & t & ok)
        ev[f"日｜RSI<50＋綠柱轉縮｜{tn}"] = spaced(zone & turn_up(h) & t & ok)
        ev[f"日｜RSI<50＋綠柱縮3根｜{tn}"] = spaced(zone & shrink3(h) & t & ok)
        wz = (wr < 50) & (wh < 0) & turn_up(wh)
        w_ev = wz.reindex(idx).fillna(False).astype(bool)        # 只在週收盤那天觸發
        ev[f"週｜RSI<50＋綠柱轉縮｜{tn}"] = spaced(w_ev & t & ok, 10)
    ev["基準｜任意日"] = list(idx[ok])
    ev["基準｜站上MA200的任意日"] = list(idx[ok & up_ma])
    ev["基準｜週DIF>0的任意日"] = list(idx[ok & up_wk])
    m = compute(close)
    ev["對照｜分數跨上20"] = backtest.cross_events(m["score"], 20)
    ev["對照｜分數跨上50"] = backtest.cross_events(m["score"], 50)
    return ev, idx[ok]


def main():
    items = json.loads((ROOT / "watchlist.json").read_text(encoding="utf-8"))
    bases = list(dict.fromkeys(it.get("underlying") or it.get("proxy") or it["symbol"] for it in items))
    rows = []
    for b in bases:
        p = ROOT / "data" / f"{b}.csv"
        if not p.exists():
            print("沒有快取，略過", b)
            continue
        close = pd.read_csv(p, index_col=0, parse_dates=True)["Close"].dropna()
        if len(close) < 400:
            continue
        fwd = backtest.forward_stats(close)
        ev, valid = events(close)
        years = len(valid) / 252
        base6 = fwd.loc[valid, "r126"].median()
        base3 = fwd.loc[valid, "r63"].median()
        bwin = (fwd.loc[valid, "r126"].dropna() > 0).mean()
        for name, dates in ev.items():
            sub = fwd.loc[pd.DatetimeIndex(dates)]
            r6, r3 = sub["r126"].dropna(), sub["r63"].dropna()
            rows.append({"base": b, "rule": name, "n": len(dates), "per_year": len(dates) / years if not name.startswith("基準") else np.nan,
                         "n6": len(r6), "ex6": r6.median() - base6 if len(r6) else np.nan,
                         "ex3": r3.median() - base3 if len(r3) else np.nan,
                         "win_ex": (r6 > 0).mean() - bwin if len(r6) else np.nan,
                         "mae": sub["mae"].dropna().median() if len(sub) else np.nan})
    df = pd.DataFrame(rows)
    df.to_csv(ROOT / "dip_backtest.csv", index=False)
    g = df[(df["n6"] >= 3) | df["rule"].str.startswith("基準")].groupby("rule", sort=False).agg(
        標的數=("base", "count"), 每年次數=("per_year", "median"),
        六月超額=("ex6", "median"), 勝過基準=("ex6", lambda x: (x > 0).mean()),
        三月超額=("ex3", "median"), 上漲機率超額=("win_ex", "median"), 之後再跌=("mae", "median"))
    for c in ["六月超額", "三月超額", "上漲機率超額", "之後再跌", "勝過基準"]:
        g[c] = (g[c] * 100).round(1)
    g["每年次數"] = g["每年次數"].round(1)
    pd.set_option("display.width", 220)
    pd.set_option("display.unicode.east_asian_width", True)
    print(g.to_string())


if __name__ == "__main__":
    main()
