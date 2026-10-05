"""回測：事件之後的報酬分布、之後還會再跌多少、和「任意日買進」比較、分批對定期定額。"""
import numpy as np
import pandas as pd

from .model import LEVEL_ORDER, level

HORIZONS = {"r21": 21, "r63": 63, "r126": 126}  # 約 1、3、6 個月
MAE_DAYS = 126
CROSS_LEVELS = [20, 50, 80]
HYSTERESIS = 10  # 分數要先跌回門檻以下 10 分，才算下一次「跨上」
MIN_GAP = 20     # 同一種事件至少隔 20 個交易日
# 分批：跨上 20 / 50 / 80 各投入這檔預算的 20% / 30% / 50%
TRANCHES = [(20, 0.2), (50, 0.3), (80, 0.5)]


def forward_stats(target: pd.Series) -> pd.DataFrame:
    out = pd.DataFrame(index=target.index)
    for k, h in HORIZONS.items():
        out[k] = target.shift(-h) / target - 1
    fut_min = target[::-1].rolling(MAE_DAYS, min_periods=MAE_DAYS).min()[::-1].shift(-1)
    out["mae"] = fut_min / target - 1
    return out


def cross_events(score: pd.Series, th: float) -> list:
    events, armed, last = [], None, -10**9
    for i, s in enumerate(score.to_numpy()):
        if s != s:
            continue
        if armed is None:
            armed = s < th
        if armed and s >= th and i - last >= MIN_GAP:
            events.append(score.index[i])
            armed, last = False, i
        elif not armed and s < th - HYSTERESIS:
            armed = True
    return events


def state_events(state: pd.Series, name: str) -> list:
    hit = (state == name) & (state.shift(1) != name)
    events, last = [], -10**9
    for i in np.flatnonzero(hit.to_numpy()):
        if i - last >= MIN_GAP:
            events.append(state.index[i])
            last = i
    return events


def summarize(label: str, fwd: pd.DataFrame, dates) -> dict:
    sub = fwd.loc[pd.DatetimeIndex(list(dates))]
    row = {"label": label, "n": int(len(sub)), "n6": int(sub["r126"].notna().sum())}
    for k in HORIZONS:
        x = sub[k].dropna()
        row[k] = float(x.median()) if len(x) else None
    x = sub["r126"].dropna()
    row["win126"] = float((x > 0).mean()) if len(x) else None
    m = sub["mae"].dropna()
    row["mae_med"] = float(m.median()) if len(m) else None
    row["mae_p10"] = float(m.quantile(0.1)) if len(m) else None
    if len(sub) < 200:
        row["dates"] = [d.strftime("%Y-%m-%d") for d in sub.index]
    return row


def zone_stats(score: pd.Series) -> dict:
    s = score.dropna()
    if s.empty:  # 歷史太短還沒有分數（新上市 ETF）
        return {"shares": {n: 0.0 for n in LEVEL_ORDER}, "cheap_share": 0.0, "cheap_per_year": 0.0, "longest_gap": None, "years": 0.0}
    lv = s.map(level)
    shares = {name: float((lv == name).mean()) for name in LEVEL_ORDER}
    years = len(s) / 252
    cheap = (s >= 20).to_numpy()
    # 最長連續「沒進便宜區」的期間
    best, cur, best_end = 0, 0, None
    for i, c in enumerate(cheap):
        cur = 0 if c else cur + 1
        if cur > best:
            best, best_end = cur, i
    gap = None
    if best:
        gap = {"days": best, "years": best / 252,
               "from": s.index[best_end - best + 1].strftime("%Y-%m-%d"),
               "to": s.index[best_end].strftime("%Y-%m-%d"),
               "ongoing": bool(best_end == len(s) - 1)}
    return {"shares": shares, "cheap_share": float(cheap.mean()),
            "cheap_per_year": len(cross_events(score, 20)) / years if years else 0,
            "longest_gap": gap, "years": years}


def simulate(target: pd.Series, score: pd.Series) -> dict:
    """每月第一個交易日存入 1 份資金。
    定期定額：當天全部買進。
    左側分批：現金先放著（不計利息），依 TRANCHES 在跨上 20 / 50 / 80 時投入 20% / 30% / 50%
    （換算成「當下現金」的比例：20/100、30/80、50/50）。"""
    s = score.dropna()
    if s.empty:
        return None
    t = target.loc[s.index[0]:]
    month_start = t.index.to_series().groupby(t.index.to_period("M")).first()
    deposit_days = set(month_start.to_numpy())
    buy_frac = {}
    left_share = 1.0
    for th, share in TRANCHES:
        frac, left_share = share / left_share, left_share - share
        for d in cross_events(s, th):
            buy_frac[d] = max(buy_frac.get(d, 0), frac)

    dca_sh = left_sh = cash = deposited = 0.0
    idle_run = longest_idle = 0
    for d, p in t.items():
        if d in deposit_days:
            deposited += 1
            dca_sh += 1 / p
            cash += 1
        if d in buy_frac and cash > 0:
            amt = cash * buy_frac[d]
            left_sh += amt / p
            cash -= amt
        if d in deposit_days:
            idle_run = idle_run + 1 if cash >= 6 else 0
            longest_idle = max(longest_idle, idle_run)
    last = t.iloc[-1]
    dca_v, left_v = dca_sh * last, left_sh * last + cash
    return {
        "deposited": deposited,
        "dca_value": dca_v, "left_value": left_v,
        # 左側平均成本相對定期定額平均成本（負數 = 買得比較便宜）
        "cost_vs_dca": ((deposited - cash) / left_sh) / (deposited / dca_sh) - 1 if left_sh else None,
        "left_cash_end": cash,
        "longest_idle_months": longest_idle,
        "since": t.index[0].strftime("%Y-%m-%d"),
    }


def run(df: pd.DataFrame, target: pd.Series) -> dict:
    """df 為 model.compute 的結果（算分數的標的），target 為實際買進的價格序列。"""
    fwd = forward_stats(target.reindex(df.index))
    valid = df.index[df["score"].notna()]
    score = df["score"]
    rows = [summarize("任意日買進（基準）", fwd, valid)]
    for th in CROSS_LEVELS:
        rows.append(summarize(f"分數跨上 {th}", fwd, cross_events(score, th)))
    rows.append(summarize("狀態變成「轉折確認」", fwd, state_events(df["state"], "轉折確認")))
    tr = df.index[df["trough_event"] & (score >= 20)]
    rows.append(summarize("月線谷底確認（便宜區內）", fwd, tr))
    tr_all = df.index[df["trough_event"] & score.notna()]
    rows.append(summarize("月線谷底確認（不論分數）", fwd, tr_all))
    rows.append(summarize("進入甜蜜點", fwd, state_events(df["sweet"].map({True: "y", False: ""}), "y")))
    heat = df["heat"].where(score.notna(), "")
    rows.append(summarize("進入「過熱」（追高）", fwd, state_events(heat.replace("嚴重過熱", "過熱"), "過熱")))
    rows.append(summarize("進入「嚴重過熱」（追高）", fwd, state_events(heat, "嚴重過熱")))
    return {"events": rows, "zones": zone_stats(score), "sim": simulate(target.reindex(df.index), score)}
