"""回測勝率：「歷史上同樣狀態買進，之後上漲的機率」，0～100；另算買進後通常還會再跌多少。

做法（白話）：
1. 先看這檔自己「任意一天買」在 3 個月、6 個月、1 年後上漲的比例（基準勝率）。
2. 把每天分成幾種狀態（甜蜜點、過熱、各分數級距）。
3. 共通規律：所有標的在某狀態的勝率，平均比各自基準高（或低）幾個百分點。
4. 這檔自己在該狀態的歷史勝率。樣本越多越相信自己的歷史，越少越靠共通規律。
再跌幅度（買進後 6 個月內最低點相對買價，取中位數）用同樣方法合成。
"""
import numpy as np
import pandas as pd

HORIZONS = {"3m": 63, "6m": 126, "1y": 252}
MAE_DAYS = 126
DAYS_PER_SAMPLE = 21   # 相鄰交易日高度重疊，約每 21 天才算一個獨立樣本
PRIOR_SAMPLES = 10     # 自己的樣本達 10 個獨立樣本時，自身歷史與共通規律各占一半
MIN_DAYS = 63          # 某標的在某狀態至少 63 天才拿來算共通規律
MIN_HIST = 252         # 有結果的歷史至少 1 年才估計

STATES = {
    "sweet": "甜蜜點",
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
        [s.isna(), m["sweet"], m["heat"] != "", s >= 50, s >= 20, s >= -10, s >= -66],
        ["", "sweet", "hot", "cheap2", "cheap", "fair", "pricey"], "vexp")
    return pd.Series(key, index=m.index)


def outcomes(target: pd.Series, index) -> pd.DataFrame:
    """每天買進的結果：各期間是否上漲（1/0，未知為 NaN）與之後 6 個月內最大再跌。"""
    t = target.reindex(index)
    out = pd.DataFrame(index=index)
    for k, h in HORIZONS.items():
        r = t.shift(-h) / t - 1
        out[k] = (r > 0).astype(float).where(r.notna())
    fut_min = t[::-1].rolling(MAE_DAYS, min_periods=MAE_DAYS).min()[::-1].shift(-1)
    out["mae"] = fut_min / t - 1
    return out


def _agg(x: pd.Series, col: str):
    return x.median() if col == "mae" else x.mean()


def lifts(pool: list) -> dict:
    """pool：每個一倍標的一組 (狀態, outcomes)。回傳 {狀態: {欄位: 比自身基準多多少, "syms": 標的數}}（各標的等權平均）。"""
    cols = list(HORIZONS) + ["mae"]
    per = {k: {c: [] for c in cols} for k in STATES}
    for st, o in pool:
        for c in cols:
            ok = (st != "") & o[c].notna()
            s, x = st[ok], o[c][ok]
            if len(x) < MIN_HIST:
                continue
            base = _agg(x, c)
            for k in STATES:
                y = x[s == k]
                if len(y) >= MIN_DAYS:
                    per[k][c].append(_agg(y, c) - base)
    return {k: dict({c: float(np.mean(v[c])) if v[c] else 0.0 for c in cols}, syms=len(v["6m"])) for k, v in per.items()}


def estimate(st: pd.Series, o: pd.DataFrame, table: dict) -> dict | None:
    cur = st.iloc[-1]
    if not cur:
        return None
    ok6 = (st != "") & o["6m"].notna()
    if ok6.sum() < MIN_HIST:
        return None
    n_eff = int((ok6 & (st == cur)).sum()) / DAYS_PER_SAMPLE
    k = n_eff / (n_eff + PRIOR_SAMPLES)
    out = {"state": cur, "label": STATES[cur], "own_n": round(n_eff, 1), "own_k": round(k, 2),
           "syms": table.get(cur, {}).get("syms", 0)}
    for c in list(HORIZONS) + ["mae"]:
        ok = (st != "") & o[c].notna()
        x = o[c][ok]
        if len(x) < MIN_HIST:
            out[c] = None
            continue
        base = float(_agg(x, c))
        lift = table.get(cur, {}).get(c, 0.0)
        prior = base + lift
        if c != "mae":
            prior = min(max(prior, 0.01), 0.99)
        y = x[st[ok] == cur]
        own = float(_agg(y, c)) if len(y) else None
        kk = k if own is not None else 0.0
        v = kk * own + (1 - kk) * prior if own is not None else prior
        out[c] = {"p": round(100 * v, 1), "base": round(100 * base, 1), "lift": round(100 * lift, 1),
                  "own": None if own is None else round(100 * own, 1)}
    if out["6m"] is None:
        return None
    out["p"] = out["6m"]["p"]  # 卡片與排序用 6 個月
    # 交叉比對：各期間勝率都高於這檔平常，且再跌幅度不比平常深 → 歷史上相對安穩的買點
    hs = [out[c] for c in HORIZONS if out[c]]
    out["better"] = sum(1 for h in hs if h["p"] > h["base"] + 1)
    out["n_h"] = len(hs)
    out["calm"] = bool(out["mae"] and out["mae"]["p"] >= out["mae"]["base"] - 1)
    return out
