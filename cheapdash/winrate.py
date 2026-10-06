"""回測勝率：「歷史上在同樣狀態買進，6 個月後上漲的機率」，0～100。

做法（白話）：
1. 先看這檔自己「任意一天買、6 個月後上漲」的比例（基準勝率）。
2. 把每天分成幾種狀態（甜蜜點、便宜區＋月線谷底、過熱、各分數級距）。
3. 共通規律：所有標的在某狀態的勝率，平均比各自基準高（或低）幾個百分點。
4. 這檔自己在該狀態的歷史勝率。樣本越多越相信自己的歷史，越少越靠共通規律。
"""
import numpy as np
import pandas as pd

HORIZON = 126          # 約 6 個月
DAYS_PER_SAMPLE = 21   # 相鄰交易日高度重疊，約每 21 天才算一個獨立樣本
PRIOR_SAMPLES = 10     # 自己的樣本達 10 個獨立樣本時，自身歷史與共通規律各占一半
MIN_DAYS = 63          # 某標的在某狀態至少 63 天才拿來算共通規律

STATES = {
    "sweet": "甜蜜點",
    "trough": "便宜區＋月線谷底",
    "hot": "過熱",
    "cheap2": "很便宜（50～80）",
    "cheap": "便宜（20～50）",
    "fair": "合理（−10～20）",
    "pricey": "小貴～中貴",
    "vexp": "很貴",
}


def states(m: pd.DataFrame) -> pd.Series:
    s = m["score"]
    key = np.select(
        [s.isna(), m["sweet"], m["trough"] & (s >= 20), m["heat"] != "", s >= 50, s >= 20, s >= -10, s >= -66],
        ["", "sweet", "trough", "hot", "cheap2", "cheap", "fair", "pricey"], "vexp")
    return pd.Series(key, index=m.index)


def wins(target: pd.Series, index) -> pd.Series:
    t = target.reindex(index)
    r = t.shift(-HORIZON) / t - 1
    return (r > 0).where(r.notna())


def lifts(pool: list) -> dict:
    """pool：每個一倍標的一組 (狀態, 勝負)。回傳各狀態「比自身基準多幾個百分點」（各標的等權平均）。"""
    per = {k: [] for k in STATES}
    for st, w in pool:
        ok = (st != "") & w.notna()
        st, w = st[ok], w[ok].astype(float)
        if len(w) < 252:
            continue
        base = w.mean()
        for k in STATES:
            x = w[st == k]
            if len(x) >= MIN_DAYS:
                per[k].append(x.mean() - base)
    return {k: {"lift": float(np.mean(v)) if v else 0.0, "syms": len(v)} for k, v in per.items()}


def estimate(st: pd.Series, w: pd.Series, table: dict) -> dict | None:
    cur = st.iloc[-1]
    if not cur:
        return None
    ok = (st != "") & w.notna()
    hist_st, hist_w = st[ok], w[ok].astype(float)
    if len(hist_w) < 252:
        return None
    base = float(hist_w.mean())
    lift = table.get(cur, {}).get("lift", 0.0)
    prior = min(max(base + lift, 0.01), 0.99)
    own_w = hist_w[hist_st == cur]
    n_eff = len(own_w) / DAYS_PER_SAMPLE
    own = float(own_w.mean()) if len(own_w) else None
    k = n_eff / (n_eff + PRIOR_SAMPLES)
    p = k * own + (1 - k) * prior if own is not None else prior
    return {"p": round(100 * p, 1), "state": cur, "label": STATES[cur], "base": round(100 * base, 1),
            "lift": round(100 * lift, 1), "own": None if own is None else round(100 * own, 1),
            "own_n": round(n_eff, 1), "own_k": round(k, 2), "syms": table.get(cur, {}).get("syms", 0)}
