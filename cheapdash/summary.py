"""回測報告與 dashboard 共用的摘要函式。"""
import numpy as np
import pandas as pd

from .model import level


def num(x, nd=None):
    if x is None or (isinstance(x, float) and np.isnan(x)):
        return None
    return round(float(x), nd) if nd is not None else float(x)


def cagr(s: pd.Series) -> float:
    yrs = (s.index[-1] - s.index[0]).days / 365.25
    return float((s.iloc[-1] / s.iloc[0]) ** (1 / yrs) - 1)


def max_dd(s: pd.Series) -> float:
    return float((s / s.cummax() - 1).min())


def current(m: pd.DataFrame) -> dict:
    last = m.iloc[-1]
    score = num(last["score"], 1)  # 級距用四捨五入後的分數，和畫面顯示一致
    return {
        "date": m.index[-1].strftime("%Y-%m-%d"),
        "score": score, "level": level(score) if score is not None else "", "state": last["state"],
        "dd52": num(last["dd52"], 4), "dd_ath": num(last["dd_ath"], 4),
        "rsi": num(last["rsi"], 1), "ma_dev": num(last["ma_dev"], 4),
        "sigs": [bool(last[f"s{i}"]) for i in range(1, 6)],
        "trough": bool(last["trough"]), "trough_forming": m.attrs.get("trough_forming", False),
        "s2_forming": m.attrs.get("s2_forming", False),
        "heat": last["heat"],
    }


def lev_info(real: pd.Series, under: pd.Series, x: float, underlying: str) -> dict:
    """槓桿 ETF 自身的資料：回撤、回本所需漲幅、近一年實際 vs 標的×倍數，以及實際 vs 模擬。"""
    u = under.reindex(real.index).ffill()
    sim = (1 + x * u.pct_change().fillna(0)).cumprod()
    one_y = real.index[-1] - pd.Timedelta(days=365)
    r1, u1 = real.loc[one_y:], u.loc[one_y:]
    dd = float(real.iloc[-1] / real.max() - 1)
    return {
        "underlying": underlying, "x": x,
        "since": real.index[0].strftime("%Y-%m-%d"),
        "real_cagr": cagr(real), "sim_cagr": cagr(sim),
        "real_mdd": max_dd(real), "sim_mdd": max_dd(sim),
        "dd_ath": dd, "recover": 1 / (1 + dd) - 1,
        "gap_1y": (float(r1.iloc[-1] / r1.iloc[0] - 1) - x * float(u1.iloc[-1] / u1.iloc[0] - 1))
        if real.index[0] <= one_y else None,
    }


def lev_target(close: pd.Series, x: float) -> pd.Series:
    """用一倍標的的日報酬模擬槓桿 ETF（不含費用與融資成本）。"""
    return (1 + x * close.pct_change().fillna(0)).cumprod()
